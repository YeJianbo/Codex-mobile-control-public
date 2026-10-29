import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isMainThread} from 'node:worker_threads';
import {historyWorkerCall} from './historyWorkers.js';
import {zcodeHome} from './zcodeAccount.js';
import type {GatewayEvent,ThreadRecord} from '../types.js';
import type {StateStore} from './stateStore.js';
import type {EventHub} from './eventHub.js';
import {isZcodeRecoveryInput} from './zcodeRecovery.js';
import {zcodeToolText} from './zcodeStream.js';
import {stripSessionInstructionPrefix} from './agentInstructions.js';

type NativeRow=Record<string,any>;
export type ZcodeNativeSession={sessionId:string;revision:string;thread:ThreadRecord;model?:string;effort?:string;completedAt:number;tokens?:Record<string,number|null>};
const nativeFile=()=>path.join(process.env.ZCODE_STORAGE_DIR||path.join(zcodeHome(),'cli'),'db','db.sqlite');
const json=(value:string)=>JSON.parse(value);
const visible=(value:any)=>value.semantics?.uiVisibility!=='hidden'&&value.visibility!=='model-only'&&value.metadata?.visibility!=='model-only'&&!value.synthetic;
const modelKey=(value:any)=>value?.providerId&&value?.modelId?`zcode::${encodeURIComponent(value.providerId)}/${encodeURIComponent(value.modelId)}`:undefined;
const iso=(value:number)=>new Date(value).toISOString();
const discardedAttempt=(message:any)=>typeof message.finish==='string'&&message.finish.endsWith('_discarded');
const terminalMessage=(message:any)=>message.time?.completed&&message.finish&&message.finish!=='tool-calls'&&!discardedAttempt(message);

/** Convert a native snapshot; IDs stay stable while ZCode updates a streaming part. */
export function zcodeEvents(threadId:string,session:NativeRow,messages:NativeRow[],parts:NativeRow[]):GatewayEvent[]{
  const result:GatewayEvent[]=[],byMessage=new Map<string,NativeRow[]>();
  for(const part of parts){const group=byMessage.get(part.message_id)||[];group.push(part);byMessage.set(part.message_id,group);}
  const turns=new Set<string>();let currentTurn='',lastAt=session.time_created;
  const turnAliases=new Map<string,string>();
  let pendingEnd:{key:string;at:number;status:string}|undefined;
  const event=(type:string,key:string,at:number,extra:Record<string,unknown>={})=>{
    result.push({type,threadId,turnId:currentTurn,eventId:`zcode-history:${session.id}:${key}`,createdAt:iso(at),...extra} as GatewayEvent);
  };
  const flushEnd=()=>{if(pendingEnd)event('turn.completed',pendingEnd.key,pendingEnd.at,{status:pendingEnd.status});pendingEnd=undefined;};
  for(const row of messages){
    const message=json(row.data);if(!visible(message)||message.semantics?.kind==='timeline_event')continue;
    const at=message.time?.created||row.time_created;
    const nativeTurn=message.anchor?.turnId||(message.role==='user'?row.id:currentTurn)||row.id;
    if(isZcodeRecoveryInput(message)&&currentTurn){turnAliases.set(nativeTurn,currentTurn);pendingEnd=undefined;continue;}
    const nextTurn=turnAliases.get(nativeTurn)||nativeTurn;
    if(nextTurn!==currentTurn){flushEnd();currentTurn=nextTurn;}
    const content:Array<NativeRow&{value:any}>=(byMessage.get(row.id)||[]).map(part=>({...part,value:json(part.data)}));
    if(message.role==='user'){
      const text=stripSessionInstructionPrefix(content.filter(part=>part.value.type==='text'&&!part.value.synthetic&&!part.value.ignored).map(part=>part.value.text||'').join('\n'));
      const attachments=content.filter(part=>part.value.type==='file'&&part.value.url?.startsWith('file:')).map(part=>({name:part.value.filename||'附件',path:decodeURIComponent(new URL(part.value.url).pathname).replace(/^\/([A-Za-z]:)/,'$1')}));
      if(!text&&!attachments.length)continue;
      if(!turns.has(currentTurn)){turns.add(currentTurn);event('turn.started',currentTurn+':start',at);}
      event('user.message',row.id,at,{itemId:row.id,text,...(attachments.length?{attachments}:{})});
    }else if(message.role==='assistant'){
      if(discardedAttempt(message))continue;
      pendingEnd=undefined;
      for(const part of content){
        const value=part.value,itemId=value.type==='tool'?(value.callID||value.toolCallId||part.id):part.id,partAt=part.time_created;
        if(value.type==='text'&&value.text)event('message.delta',part.id,partAt,{itemId,text:value.text,textComplete:true});
        if(value.type==='reasoning'&&value.text)event('reasoning.summary',part.id,partAt,{itemId,text:value.text});
        if(value.type==='tool'){
          const state=value.state||{},detail=typeof state.input==='string'?state.input:JSON.stringify(state.input??{});
          event('tool.started',part.id+':start',partAt,{itemId,title:state.title||value.tool||'执行工具',detail});
          if(state.output||state.error)event('tool.output',part.id+':output',part.time_updated,{itemId,text:zcodeToolText(state.output||state.error)});
          if(state.status==='completed'||state.status==='error')event('tool.completed',part.id+':end',state.time?.end||part.time_updated,{itemId,status:state.status==='error'?'error':'ok'});
        }
      }
      if(terminalMessage(message))pendingEnd={key:row.id+':end',at:message.time.completed,status:message.error?'error':'completed'};
    }
    lastAt=Math.max(lastAt,row.time_updated);
  }
  flushEnd();
  const last=result.at(-1);
  if(currentTurn&&['completed','interrupted','error'].includes(session.status)&&last?.type!=='turn.completed')event('turn.completed',currentTurn+':end',Math.max(lastAt,session.time_updated),{status:session.status});
  return result;
}

export class ZcodeNativeSessions {
  private db?:DatabaseSync;
  private file='';
  private version=-1;
  private rows:NativeRow[]=[];
  private aliases:()=>Map<string,string>=()=>new Map();
  setAliases(aliases:()=>Map<string,string>){this.aliases=aliases;}
  isAliasedThread(id:string){return [...this.aliases().values()].includes(id);}
  close(){this.db?.close();this.db=undefined;this.version=-1;}
  private database(){
    const file=nativeFile();
    if(this.file!==file){this.close();this.file=file;}
    if(!this.db&&fs.existsSync(file)){this.db=new DatabaseSync(file,{readOnly:true});this.db.exec('PRAGMA busy_timeout=100');}
    return this.db;
  }
  indexRows():NativeRow[]{
    const db=this.database();if(!db)return [];
    const version=(db.prepare('PRAGMA data_version').get() as any).data_version;
    if(version!==this.version){
      this.rows=db.prepare(`SELECT s.*,t.status target_status,t.active_run_last_seen_at,
        (SELECT MAX(time_updated) FROM part WHERE message_id=(SELECT id FROM message WHERE session_id=s.id ORDER BY sequence DESC,time_created DESC,id DESC LIMIT 1)) part_updated,
        (SELECT data FROM message WHERE session_id=s.id AND coalesce(json_extract(data,'$.synthetic'),0)=0 AND coalesce(json_extract(data,'$.semantics.uiVisibility'),'visible')<>'hidden' ORDER BY sequence DESC,time_created DESC,id DESC LIMIT 1) last_message,
        (SELECT data FROM message WHERE session_id=s.id AND json_extract(data,'$.role')='user' AND coalesce(json_extract(data,'$.synthetic'),0)=0 AND coalesce(json_extract(data,'$.semantics.uiVisibility'),'visible')<>'hidden' ORDER BY sequence DESC,time_created DESC,id DESC LIMIT 1) user_message,
        (SELECT MAX(time_updated) FROM message WHERE session_id=s.id) message_updated
        FROM session s LEFT JOIN session_target t ON t.session_id=s.id
        WHERE ((s.parent_id IS NULL AND s.task_type IN ('interactive','fork')) OR (s.parent_id IS NOT NULL AND s.task_type='subagent_child')) AND s.time_deleted IS NULL AND s.time_archived IS NULL
        AND EXISTS(SELECT 1 FROM message WHERE session_id=s.id AND json_extract(data,'$.role')='user' AND coalesce(json_extract(data,'$.synthetic'),0)=0)
        ORDER BY s.time_updated DESC`).all();
      const usage=new Map((db.prepare(`SELECT session_id,SUM(input_tokens) input,SUM(output_tokens) output,SUM(cache_read_input_tokens) cached,
        SUM(reasoning_tokens) reasoning,SUM(input_tokens+output_tokens) total FROM model_usage GROUP BY session_id`).all() as NativeRow[]).map(row=>[row.session_id,row]));
      for(const row of this.rows){const counts=usage.get(row.id);if(counts){const {session_id,...tokens}=counts;row.native_tokens=tokens;}}
      this.version=version;
    }
    return this.rows;
  }
  async list():Promise<ZcodeNativeSession[]>{
    const rows=isMainThread?await historyWorkerCall<NativeRow[]>('readZcodeNativeIndex',[],'background'):this.indexRows();
    const aliases=this.aliases();
    return rows.map(row=>{
      const last=row.last_message?json(row.last_message):{},user=row.user_message?json(row.user_message):{},updated=Math.max(row.time_updated,row.part_updated||0,row.message_updated||0);
      // last_outcome can still describe the previous turn during a new stream.
      const streaming=last.role==='assistant'&&!last.time?.completed&&Date.now()-updated<120000;
      const active=streaming||row.target_status==='active'&&Date.now()-(row.active_run_last_seen_at||0)<120000;
      const status:ThreadRecord['status']=active?'running':row.last_outcome==='error'?'error':row.last_outcome==='interrupted'?'interrupted':row.last_outcome==='completed'||terminalMessage(last)?'completed':'idle';
      return {sessionId:row.id,revision:`${updated}:${row.last_outcome}:${status}:${row.title}`,tokens:row.native_tokens,model:modelKey(last.role==='user'?last.modelSelection:last)||modelKey(user.modelSelection),effort:user.modelSelection?.options?.reasoningLevel,
        completedAt:status==='completed'?last.time?.completed||0:0,
        thread:{id:aliases.get(row.id)||'zcode-'+row.id,projectPath:row.directory,title:row.title||'新会话',status,createdAt:iso(row.time_created),updatedAt:iso(updated),
          ...(row.task_type==='subagent_child'?{subagent:{parentThreadId:aliases.get(row.parent_id)||'zcode-'+row.parent_id,role:user.agent||'subagent'}}:{})}};
    });
  }
  async read(id:string):Promise<(ZcodeNativeSession&{events:GatewayEvent[]})|null>{
    if(!id.startsWith('zcode-'))return null;
    const session=(await this.list()).find(session=>session.thread.id===id);if(!session)return null;
    const events=isMainThread?await historyWorkerCall<GatewayEvent[]>('readZcodeNativeEvents',[session.sessionId,id,session.thread.status]):await readZcodeNativeEvents(session.sessionId,id,session.thread.status);
    return {...session,events};
  }
}

// Large transcripts are decoded on the existing history workers, never the gateway event loop.
export async function readZcodeNativeEvents(sessionId:string,id:string,status:string):Promise<GatewayEvent[]>{
  const file=nativeFile();if(!fs.existsSync(file))return [];
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    db.exec('PRAGMA busy_timeout=100; BEGIN');
    const session=db.prepare('SELECT * FROM session WHERE id=? AND time_deleted IS NULL').get(sessionId);
    if(!session)return [];
    return zcodeEvents(id,{...session,status},db.prepare('SELECT * FROM message WHERE session_id=? ORDER BY sequence,time_created,id').all(sessionId),db.prepare('SELECT * FROM part WHERE session_id=? ORDER BY message_id,sequence,time_created,id').all(sessionId));
  }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
}

export const zcodeNativeSessions=new ZcodeNativeSessions();
export async function readZcodeNativeIndex(){return zcodeNativeSessions.indexRows();}

export async function watchZcodeSessions(store:StateStore,hub:EventHub,owned:(id:string)=>boolean){
  zcodeNativeSessions.setAliases(()=>new Map(store.threads.filter(thread=>thread.id.startsWith('zcode-')).flatMap(thread=>{
    const session=store.readAgentMeta(thread.id)?.session;return typeof session==='string'?[[session,thread.id]]:[];
  })));
  let previous=new Map<string,ZcodeNativeSession>(),running=false,closed=false;
  const synchronize=async()=>{
    if(running||closed)return;running=true;
    try{
      const current=new Map((await zcodeNativeSessions.list()).map(session=>[session.sessionId,session]));
      for(const [nativeId,session] of current){
        const old=previous.get(nativeId),id=session.thread.id;
        // Accounting survives gateway dismissal and native history cleanup.
        store.sessionUsage?.observeThread(session.thread);
        if(session.tokens)store.sessionUsage?.record(id,session.tokens,session.thread.updatedAt);
        if(old?.revision===session.revision||owned(id)||store.isThreadHidden(id))continue;
        const meta=store.readAgentMeta(id)||{};
        store.writeAgentMeta(id,{...meta,session:nativeId,model:session.model||meta.model,effort:session.effort||meta.effort});
        await store.upsertThread(session.thread);
        hub.publish({type:'thread.history.changed',threadId:id},false);
        hub.publish({type:'usage.updated',threadId:id},false);
        if(old?.thread.status==='running'&&['completed','interrupted','error'].includes(session.thread.status))hub.publish({type:'turn.completed',threadId:id,status:session.thread.status,createdAt:session.thread.updatedAt},false);
      }
      for(const [nativeId,session] of previous)if(!current.has(nativeId)&&!owned(session.thread.id))hub.publish({type:'thread.history.changed',threadId:session.thread.id},false);
      previous=current;
    }catch(error){console.warn('ZCode session synchronization failed:',(error as Error).message);}
    finally{running=false;}
  };
  await synchronize();const timer=setInterval(()=>void synchronize(),1000);timer.unref();
  return async()=>{closed=true;clearInterval(timer);zcodeNativeSessions.close();};
}
