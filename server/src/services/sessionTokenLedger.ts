import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {codexHome} from './paths.js';
import {subagentMetadata} from './subagentThreads.js';
import {readTokenSnapshot,type TokenSnapshot} from './codexTokenUsage.js';
import {readCodexThreadUsage} from './codexSessions.js';
import {threadAgent} from './agentProtocol.js';

const fields=['input','cached','output','reasoning','total'] as const;
type Counts=Record<typeof fields[number],number|null>;
type UsageRow=Counts&{thread_id:string;updated_at:string};
type Child={threadId:string;parentThreadId:string;name:string;agent:string};
const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export function usageCounts(value:any):Counts{
  const result=Object.fromEntries(fields.map(key=>[key,count(value?.[key])])) as Counts;
  result.total??=result.input!==null&&result.output!==null?result.input+result.output:null;
  return result;
}
function sum(rows:Counts[]):Counts{
  return Object.fromEntries(fields.map(key=>{
    const values=rows.map(row=>row[key]).filter((value):value is number=>value!==null);
    if(key!=='total'&&values.length!==rows.length)return [key,null];
    return [key,values.length?values.reduce((a,b)=>a+b,0):null];
  })) as Counts;
}

// Accounting is independent of sidebar/history retention. Each thread owns one
// cumulative snapshot; descendants are selected once, never summed as subtrees.
export class SessionTokenLedger{
  constructor(private db:DatabaseSync){
    db.exec(`CREATE TABLE IF NOT EXISTS session_usage_relations(
      thread_id TEXT PRIMARY KEY,parent_id TEXT NOT NULL,name TEXT NOT NULL,agent TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS session_usage_parent ON session_usage_relations(parent_id);
      CREATE TABLE IF NOT EXISTS session_usage_tokens(
      thread_id TEXT PRIMARY KEY,input REAL,cached REAL,output REAL,reasoning REAL,total REAL,updated_at TEXT NOT NULL);`);
  }
  relate(threadId:string,parentId:string,name='子代理',agent='codex'){
    if(!threadId||!parentId||threadId===parentId)return;
    this.db.prepare(`INSERT INTO session_usage_relations VALUES(?,?,?,?)
      ON CONFLICT(thread_id) DO UPDATE SET name=excluded.name,agent=excluded.agent
      WHERE parent_id=excluded.parent_id AND (name<>excluded.name OR agent<>excluded.agent)`).run(threadId,parentId,name||'子代理',agent);
  }
  relateMany(children:Child[]){
    if(!children.length)return;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const child of children)this.relate(child.threadId,child.parentThreadId,child.name,child.agent);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  observeThread(thread:{id:string;title?:string;subagent?:{parentThreadId?:string}}){
    if(thread.subagent?.parentThreadId)this.relate(thread.id,thread.subagent.parentThreadId,thread.title,threadAgent(thread.id));
  }
  record(threadId:string,tokens:any,updatedAt:string){
    const values=usageCounts(tokens);
    if(!fields.some(key=>values[key]!==null))return;
    // Replayed or older file snapshots cannot roll the ledger back. Missing
    // fields preserve a previously reported value instead of turning it to zero.
    this.db.prepare(`INSERT INTO session_usage_tokens VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(thread_id) DO UPDATE SET
      input=COALESCE(excluded.input,input),cached=COALESCE(excluded.cached,cached),
      output=COALESCE(excluded.output,output),reasoning=COALESCE(excluded.reasoning,reasoning),
      total=COALESCE(excluded.total,total),updated_at=excluded.updated_at
      WHERE excluded.updated_at>=updated_at AND (updated_at<>excluded.updated_at OR
      ${fields.map(key=>`COALESCE(excluded.${key},${key}) IS NOT ${key}`).join(' OR ')})`).run(threadId,...fields.map(key=>values[key]),updatedAt);
  }
  recordSnapshot(threadId:string,snapshot:TokenSnapshot){
    const total=snapshot.info.total_token_usage;
    if(total)this.record(threadId,{input:total.input_tokens,cached:total.cached_input_tokens,output:total.output_tokens,
      reasoning:total.reasoning_output_tokens,total:total.total_tokens},snapshot.updatedAt);
  }
  descendants(threadId:string):Child[]{
    return this.db.prepare(`WITH RECURSIVE family(id) AS(
      SELECT thread_id FROM session_usage_relations WHERE parent_id=?
      UNION SELECT r.thread_id FROM session_usage_relations r JOIN family f ON r.parent_id=f.id)
      SELECT r.thread_id AS threadId,r.parent_id AS parentThreadId,r.name,r.agent
      FROM session_usage_relations r JOIN family f ON r.thread_id=f.id WHERE r.thread_id<>? ORDER BY r.thread_id`).all(threadId,threadId) as Child[];
  }
  ancestors(threadId:string):string[]{
    return (this.db.prepare(`WITH RECURSIVE parents(id) AS(
      SELECT parent_id FROM session_usage_relations WHERE thread_id=?
      UNION SELECT r.parent_id FROM session_usage_relations r JOIN parents p ON r.thread_id=p.id)
      SELECT id FROM parents WHERE id<>?`).all(threadId,threadId) as {id:string}[]).map(row=>row.id);
  }
  combine(threadId:string,current:any){
    if(current)this.record(threadId,current,current.updatedAt||new Date().toISOString());
    const saved=this.db.prepare('SELECT * FROM session_usage_tokens WHERE thread_id=?').get(threadId) as UsageRow|undefined;
    const self=saved?usageCounts(saved):usageCounts(current),children=this.descendants(threadId);
    if(!children.length)return current?{...current,...self}:saved?{...self,updatedAt:saved.updated_at}:null;
    const read=this.db.prepare('SELECT * FROM session_usage_tokens WHERE thread_id=?');
    const threads=children.map(child=>{
      const row=read.get(child.threadId) as UsageRow|undefined;
      return {...child,...usageCounts(row),updatedAt:row?.updated_at||null};
    });
    const subagents={...sum(threads),count:threads.length,knownCount:threads.filter(row=>row.total!==null).length,threads};
    return {...current,...sum([self,...threads]),self,subagents,
      partial:self.total===null||subagents.knownCount<subagents.count};
  }
}

export class CodexSubagentUsage{
  private paths=new Map<string,string>();
  private discoveryAt=0;
  private reads=new Map<string,Promise<void>>();
  constructor(private ledger:SessionTokenLedger){}
  discover(force=false){
    if(!force&&Date.now()-this.discoveryAt<5000)return;
    let db:DatabaseSync|undefined;
    try{
      db=new DatabaseSync(path.join(codexHome(),'state_5.sqlite'),{readOnly:true});
      const columns=new Set((db.prepare('PRAGMA table_info(threads)').all() as {name:string}[]).map(row=>row.name));
      const select=['id','source','rollout_path','name','title','agent_nickname','agent_role','agent_path','thread_source'].filter(key=>columns.has(key));
      // Include archived rows. tokens_used alone has no input/output breakdown
      // and is not a substitute for the native token_count snapshot.
      const rows=db.prepare(`SELECT ${select.join(',')} FROM threads WHERE source LIKE '%subagent%'`).all() as Record<string,any>[];
      const children:Child[]=[];
      for(const row of rows){
        const parent=subagentMetadata(row)?.parentThreadId;if(!parent)continue;
        children.push({threadId:row.id,parentThreadId:parent,name:row.agent_nickname||row.name||row.title||'子代理',agent:'codex'});
        if(row.rollout_path)this.paths.set(row.id,row.rollout_path);
      }
      this.ledger.relateMany(children);
      this.discoveryAt=Date.now();
    }catch(error){
      // Tests and older installations may not have the desktop index. Durable
      // relations and live notifications still provide their known family.
      if(!['ENOENT','ERR_SQLITE_ERROR'].includes((error as NodeJS.ErrnoException).code||''))throw error;
    }finally{db?.close();}
  }
  async capture(threadId:string,force=false){
    const pending=this.reads.get(threadId);if(pending)return pending;
    const reading=(async()=>{
      this.discover(force);
      const ids=[threadId,...this.ledger.descendants(threadId).filter(row=>row.agent==='codex').map(row=>row.threadId)];
      for(let offset=0;offset<ids.length;offset+=4)await Promise.all(ids.slice(offset,offset+4).map(async id=>{
        const file=this.paths.get(id);
        const snapshot=(file?await readTokenSnapshot(file).catch(()=>null):null)||await readCodexThreadUsage(id).catch(()=>null);
        if(snapshot)this.ledger.recordSnapshot(id,snapshot);
      }));
    })().finally(()=>this.reads.delete(threadId));
    this.reads.set(threadId,reading);return reading;
  }
}
