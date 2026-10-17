import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {zstdDecompressSync} from 'node:zlib';
import {watch} from 'chokidar';
import type {GatewayEvent,ThreadRecord} from '../types.js';
import type {StateStore} from './stateStore.js';
import type {EventHub} from './eventHub.js';

type NativeSession={sessionId:string;file:string;revision:string;thread:ThreadRecord;events:GatewayEvent[];model?:string;effort?:string};
const nativeHome=()=>process.env.DSH_HOME||path.join(os.homedir(),'.dsh');

// Harness appends independent Zstandard frames. A one-shot decoder stops at
// the first frame; an incomplete final frame belongs to the active writer.
export function deepseekLogBody(raw:Buffer):Buffer {
  const parts:Buffer[]=[];let offset=0,total=0;
  while(offset<raw.length){
    const start=offset;if(raw.length-offset<5)break;
    if(raw.readUInt32LE(offset)!==0xfd2fb528)throw Error('Invalid DeepSeek Zstandard frame');
    offset+=4;const descriptor=raw[offset++];
    if(descriptor&24)throw Error('Invalid DeepSeek Zstandard descriptor');
    const flag=descriptor>>>6,single=!!(descriptor&32),dict=descriptor&3;
    offset+=(single?0:1)+(dict===3?4:dict)+(flag===0?(single?1:0):1<<flag);
    if(offset>raw.length)break;
    let complete=false;
    while(offset+3<=raw.length){
      const block=raw.readUIntLE(offset,3);offset+=3;
      const type=(block>>>1)&3;if(type===3)throw Error('Invalid DeepSeek Zstandard block');
      offset+=type===1?1:block>>>3;
      if(offset>raw.length)break;
      if(block&1){complete=true;break;}
    }
    if(!complete)break;
    if(descriptor&4)offset+=4;
    if(offset>raw.length)break;
    const body=zstdDecompressSync(raw.subarray(start,offset),{maxOutputLength:128*1024*1024-total});
    total+=body.length;parts.push(body);
  }
  return Buffer.concat(parts);
}

const iso=(value:unknown,fallback:number)=>new Date(typeof value==='number'&&Number.isFinite(value)?value:fallback).toISOString();
const messageText=(message:any)=>typeof message?.content==='string'?message.content:
  (Array.isArray(message?.content)?message.content:[]).filter((block:any)=>block.type==='text'&&typeof block.text==='string').map((block:any)=>block.text).join('');

export function deepseekSessionFromRows(rows:any[],file:string,revision:string,modified:number):NativeSession|null {
  const header=rows[0];
  if(header?.type!=='session'||header.version!==4||typeof header.id!=='string'||typeof header.cwd!=='string'||!header.cwd||header.delegationDepth>0||header.origin==='subagent'||header.parentSession)return null;
  const id='deepseek-'+header.id,createdAt=iso(header.createdAt,modified);
  const events:GatewayEvent[]=[],messages=new Map<string,number>();
  let title='',firstText='',turnId='',model:string|undefined,effort:string|undefined,status:ThreadRecord['status']='idle';
  for(const row of rows.slice(1)){
    const data=row.data||{},at=iso(row.time,modified);
    const base={threadId:id,createdAt:at,eventId:`deepseek-history:${header.id}:${row.seq}:${row.type}`};
    if(row.type==='session/title'&&typeof data.title==='string')title=data.title;
    if(row.type==='request/header'){
      const config=data.header?.config;
      if(typeof config?.provider==='string'&&typeof config.model==='string')model='deepseek::'+JSON.stringify([config.provider,config.model]);
      if(typeof config?.reasoningEffort==='string')effort=config.reasoningEffort;
    }
    if(row.type==='turn/start'){
      turnId=`deepseek-turn:${header.id}:${data.turn}`;status='running';
      events.push({...base,type:'turn.started',turnId});
    }else if(row.type==='turn/end'){
      const kind=data.reason?.kind;
      status=kind==='completed'?'completed':['error','failed'].includes(kind)?'error':'interrupted';
      events.push({...base,type:'turn.completed',turnId,status});
    }else if(row.type==='user/message'||row.type==='assistant/message'){
      const message=row.type==='user/message'?data:data.message;
      if(row.type==='user/message'&&message?.source?.kind&&message.source.kind!=='user')continue;
      const text=messageText(message);if(!text)continue;
      const itemId=message.id||`${header.id}:${row.seq}`;
      const event:GatewayEvent=row.type==='user/message'?{...base,type:'user.message',turnId,itemId,text}:
        {...base,type:'message.delta',turnId,itemId,text,textComplete:true};
      const key=row.type+':'+itemId,previous=messages.get(key);
      if(previous===undefined){messages.set(key,events.length);events.push(event);}else events[previous]=event;
      if(row.type==='user/message'&&!firstText)firstText=text;
      if(row.type==='assistant/message'&&typeof message.source?.provider==='string'&&typeof message.source.model==='string')
        model='deepseek::'+JSON.stringify([message.source.provider,message.source.model]);
    }
  }
  // Catalog probes create empty sessions; they are not conversations.
  if(!events.some(event=>event.type==='user.message'))return null;
  const updated=rows.reduce((latest,row)=>Math.max(latest,Number(row.time)||0),Number(header.createdAt)||0);
  return {sessionId:header.id,file,revision,model,effort,events,thread:{id,projectPath:header.cwd,title:title||firstText.slice(0,100)||'新会话',status,createdAt,updatedAt:iso(updated,modified)}};
}

export class DeepSeekNativeSessions {
  private files=new Map<string,{revision:string;session:NativeSession|null}>();
  private sessions=new Map<string,NativeSession>();
  private aliases:()=>Map<string,string>=()=>new Map();
  private reading?:Promise<void>;
  private scannedAt=0;
  constructor(private root=path.join(nativeHome(),'sessions')){}
  setAliases(aliases:()=>Map<string,string>){this.aliases=aliases;}
  invalidate(){this.scannedAt=0;}
  private materialize(session:NativeSession,aliases:Map<string,string>):NativeSession {
    const id=aliases.get(session.sessionId)||session.thread.id;
    return id===session.thread.id?session:{...session,thread:{...session.thread,id},events:session.events.map(event=>({...event,threadId:id}))};
  }
  async list():Promise<NativeSession[]> {
    if(Date.now()-this.scannedAt>=1000){
      this.reading??=this.scan().finally(()=>{this.reading=undefined;});
      await this.reading;
    }
    const aliases=this.aliases();return [...this.sessions.values()].map(session=>this.materialize(session,aliases));
  }
  async read(threadId:string):Promise<NativeSession|null>{
    if(!threadId.startsWith('deepseek-'))return null;
    return (await this.list()).find(session=>session.thread.id===threadId)||null;
  }
  isAliasedThread(threadId:string){return [...this.aliases().values()].includes(threadId);}
  private async directories(directory:string){
    try{return (await fs.readdir(directory,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>path.join(directory,entry.name));}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  }
  private async scanDirectory(directory:string,present:Set<string>):Promise<NativeSession|null>{
    const names:string[]=await fs.readdir(directory).catch(()=>[]);
    const name=['session.v4.jsonl.zstd','session.v4.jsonl'].find(name=>names.includes(name));
    if(!name)return null;
    const file=path.join(directory,name);present.add(file);
    try{
      const stat=await fs.stat(file),revision=`${stat.size}:${stat.mtimeMs}`;
      let cached=this.files.get(file);
      if(cached?.revision!==revision){
        const raw=await fs.readFile(file),body=name.endsWith('.zstd')?deepseekLogBody(raw):raw;
        const rows=body.toString('utf8').split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
        const session=deepseekSessionFromRows(rows,file,revision,stat.mtimeMs);
        cached={revision,session};this.files.set(file,cached);
      }
      return cached.session;
    }catch(error){
      // Preserve the last complete snapshot during native atomic writes.
      console.warn('DeepSeek session read failed:',path.basename(directory),(error as Error).message);
      return this.files.get(file)?.session??null;
    }
  }
  private async scan(){
    const present=new Set<string>(),sessions=new Map<string,NativeSession>();
    const concurrency=8,workspaces=await this.directories(this.root),directories:string[]=[];
    for(let index=0;index<workspaces.length;index+=concurrency){
      directories.push(...(await Promise.all(workspaces.slice(index,index+concurrency).map(workspace=>this.directories(workspace)))).flat());
    }
    const snapshots:Array<NativeSession|null>=new Array(directories.length);let cursor=0;
    await Promise.all(Array.from({length:Math.min(concurrency,directories.length)},async()=>{
      while(cursor<directories.length){const index=cursor++;snapshots[index]=await this.scanDirectory(directories[index]!,present);}
    }));
    // Read completion order must not change which file wins for a duplicate ID.
    for(const session of snapshots)if(session)sessions.set(session.sessionId,session);
    for(const file of this.files.keys())if(!present.has(file))this.files.delete(file);
    this.sessions=sessions;this.scannedAt=Date.now();
  }
}

export const deepseekNativeSessions=new DeepSeekNativeSessions();

export async function watchDeepSeekSessions(store:StateStore,hub:EventHub,owned:(id:string)=>boolean){
  deepseekNativeSessions.setAliases(()=>new Map(store.threads.filter(thread=>thread.id.startsWith('deepseek-')).flatMap(thread=>{
    const session=store.readAgentMeta(thread.id)?.session;return typeof session==='string'?[[session,thread.id]]:[];
  })));
  let previous=new Map((await deepseekNativeSessions.list()).map(session=>[session.sessionId,session]));
  const watcher=watch(path.join(nativeHome(),'sessions'),{ignoreInitial:true,depth:3,awaitWriteFinish:{stabilityThreshold:250,pollInterval:100}});
  let timer:NodeJS.Timeout|undefined,running=false,pending=false,closed=false;
  const synchronize=async()=>{
    if(running){pending=true;return;}
    running=true;
    try{
      do{
        pending=false;deepseekNativeSessions.invalidate();
        const current=new Map((await deepseekNativeSessions.list()).map(session=>[session.sessionId,session]));
        for(const [nativeId,session] of current){
          const old=previous.get(nativeId),id=session.thread.id;
          if(old?.revision===session.revision||owned(id))continue;
          hub.publish({type:'thread.history.changed',threadId:id},false);
          if(old?.thread.status==='running'&&session.thread.status!=='running'){
            const completed=session.events.slice().reverse().find(event=>event.type==='turn.completed');
            if(completed?.type==='turn.completed')hub.publish(completed,false);
          }
        }
        for(const [nativeId,session] of previous)if(!current.has(nativeId))hub.publish({type:'thread.history.changed',threadId:session.thread.id},false);
        previous=current;
      }while(pending&&!closed);
    }catch(error){console.warn('DeepSeek session synchronization failed:',(error as Error).message);}
    finally{running=false;}
  };
  watcher.on('all',(_event,file)=>{
    if(closed||!/^session\.v4\.jsonl(?:\.zstd)?$/.test(path.basename(file)))return;
    deepseekNativeSessions.invalidate();clearTimeout(timer);timer=setTimeout(()=>void synchronize(),300);
  });
  watcher.on('error',error=>console.warn('DeepSeek session watcher failed:',String(error)));
  await new Promise<void>(resolve=>watcher.once('ready',resolve));
  await synchronize();
  return async()=>{closed=true;clearTimeout(timer);await watcher.close();};
}
