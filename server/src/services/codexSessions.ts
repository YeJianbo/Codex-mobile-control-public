import {mobileDeferredActivityTypes} from './mobileActivityDetails.js';
import { createReadStream, promises as fs } from "node:fs";
import {isMainThread} from 'node:worker_threads';
import {historyWorkerCall} from './historyWorkers.js';
import {HistoryOffsetIndex} from './historyOffsets.js';
import os from "node:os";
import path from "node:path";
import type { GatewayEvent, PendingApproval, ThreadRecord } from "../types.js";
import {desktopSidebar} from './desktopSidebar.js';
import {subagentMetadata} from './subagentThreads.js';
import {delegatedMessage,subagentNotificationEvent} from './messageSource.js';
import {summarizeFileChanges,confirmedToolChanges} from './fileChanges.js';
import {deferMobileActivityDetails,isVisibleMobileThreadEvent} from './mobileActivityDetails.js';
import {readTokenSnapshot} from './codexTokenUsage.js';
import {canonicalRollout,rolloutChunks,compressedRolloutTail} from './rolloutReader.js';
import {deepseekNativeSessions} from './deepseekNativeSessions.js';
import {zcodeNativeSessions} from './zcodeNativeSessions.js';
import {compactionSummary,foldCompactionSummaries} from './contextCompaction.js';
import {resolveHistoryImage,isHistoryClipboardImage} from './historyImages.js';

type CodexSessionIndexEntry = {
  id?: string;
  thread_name?: string;
  updated_at?: string;
};

type CodexSessionMeta = {
  source?:unknown;
  agent_nickname?:string;
  agent_role?:string;
  agent_path?:string;
  id?: string;
  timestamp?: string;
  cwd?: string;
};

const MAX_INDEXED_THREADS = 300;

export async function listThreadsWithCodexHistory(storedThreads: ThreadRecord[], refresh = false, activeIds:string[]=[],nativeAgents:readonly ('deepseek'|'zcode')[]=['deepseek','zcode']): Promise<ThreadRecord[]> {
  storedThreads=storedThreads.filter(thread=>!thread.ephemeral);
  if (refresh) fileInventories.delete(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'));
  const desktop=await desktopSidebar();
  const [indexedThreads,nativeDeepSeek,nativeZcode]=await Promise.all([
    listCodexIndexedThreads(desktop.threads,new Set(desktop.archived)),
    nativeAgents.includes('deepseek')?deepseekNativeSessions.list():Promise.resolve([]),
    nativeAgents.includes('zcode')?zcodeNativeSessions.list():Promise.resolve([]),
  ]);
  indexedThreads.push(...nativeDeepSeek.map(session=>session.thread));
  indexedThreads.push(...nativeZcode.map(session=>session.thread));
  const active=new Set(activeIds);
  const pinned=new Map<string,number>();
  desktop.pinned.forEach((id,index)=>{if(!pinned.has(id))pinned.set(id,index+1);});
  // Keep the same first-match title and pin order without scanning either
  // source again for every desktop conversation.
  const indexedById=new Map<string,ThreadRecord>();
  for(const thread of indexedThreads)if(!indexedById.has(thread.id))indexedById.set(thread.id,thread);
  const merged = new Map<string, ThreadRecord>();

  for (const thread of indexedThreads) {
    merged.set(thread.id, thread);
  }
  for (const thread of storedThreads) {
    const indexed = merged.get(thread.id);
    if(thread.id.startsWith('deepseek-')&&!indexed&&!active.has(thread.id)&&deepseekNativeSessions.isAliasedThread(thread.id))continue;
    if(thread.id.startsWith('zcode-')&&!indexed&&!active.has(thread.id)&&zcodeNativeSessions.isAliasedThread(thread.id))continue;
    merged.set(thread.id, {
      ...thread,
      ...(/^(deepseek|zcode)-/.test(thread.id)&&indexed?{status:active.has(thread.id)?thread.status:indexed.status}:{}),
      subagent:thread.subagent??indexed?.subagent,
      projectPath: thread.projectPath || indexed?.projectPath,
      title: /^(deepseek|zcode)-/.test(thread.id)&&indexed?indexed.title:meaningfulStoredTitle(thread.title) ? thread.title : indexed?.title ?? thread.title,
      createdAt: thread.id.startsWith('zcode-')&&indexed?indexed.createdAt:thread.createdAt || indexed?.createdAt || thread.updatedAt,
      updatedAt: thread.id.startsWith('zcode-')&&indexed&&!active.has(thread.id)?indexed.updatedAt:latestIso(thread.updatedAt, indexed?.updatedAt),
    });
  }
  for(const row of desktop.threads) {
    const existing=merged.get(row.id);
    const subagent=subagentMetadata(row)??existing?.subagent;
    const empty=row.has_user_event===0&&Number(row.tokens_used||0)===0&&!row.first_user_message?.trim()&&!row.name?.trim()&&!row.title?.trim()&&!subagent;
    // A thread/start placeholder is not an openable conversation yet. Remove
    // it from every merged source, while retaining active creation and user pins.
    if(empty&&!active.has(row.id)&&!pinned.has(row.id)&&!(!desktop.pinsAuthoritative&&row.is_pinned)){
      merged.delete(row.id);continue;
    }
    const recency=Number(row.recency_at_ms||row.updated_at_ms||row.created_at_ms);
    merged.set(row.id,{
      id:row.id,title:row.name?.trim() || (subagent?(subagent.task||subagent.nickname||subagent.role||'子代理'):indexedById.get(row.id)?.title || row.title?.trim().slice(0,160) || (meaningfulStoredTitle(existing?.title??'')?existing?.title:undefined) || row.first_user_message?.trim().slice(0,100)) || '未命名会话',
      ...(subagent?{subagent}:{}),
      projectPath:row.cwd,status:existing?.status||'idle',
      ...(existing?.source?{source:existing.source}:{}),
      createdAt:new Date(Number(row.created_at_ms)||recency).toISOString(),updatedAt:new Date(recency).toISOString(),
      pinnedIndex:pinned.get(row.id)??(!desktop.pinsAuthoritative&&row.is_pinned?desktop.pinned.length+Number(row.section_position||0)+1:undefined),
    });
  }
  for(const [id,thread] of merged){
    if(pinned.has(id))thread.pinnedIndex=pinned.get(id);
    else if(desktop.pinsAuthoritative&&!/^(claude|antigravity|grok|deepseek|hermes|opencode|zcode|pi|acp)-/.test(id))delete thread.pinnedIndex;
  }
  for(const id of desktop.archived)merged.delete(id);
  if(desktop.threadsLoaded){
    const present=new Set(desktop.threads.map(row=>row.id));
    for(const [id,thread] of merged){
      // The desktop database is authoritative once read successfully. Allow a
      // new turn time to reach the index, but never revive a deleted old row.
      if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)&&!present.has(id)&&!active.has(id)&&thread.source!=='localCodex'&&Date.now()-Date.parse(thread.createdAt||thread.updatedAt)>120000)merged.delete(id);
    }
  }

  return [...merged.values()].map(thread=>({...thread,title:visibleThreadTitle(thread.title)})).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function visibleThreadTitle(input:string):string {
  const text=input.trim();
  if(/^<heartbeat\b/i.test(text)) {
    const instructions=/<instructions>\s*([^<]+)/i.exec(text)?.[1]?.trim().split('\n')[0];
    return instructions?.slice(0,100)||'定时任务';
  }
  return isInjectedContext(text)?'未命名会话':text;
}

export async function listCodexSessionProjectPaths(): Promise<string[]> {
  const threads = await listCodexIndexedThreads();
  threads.push(...(await deepseekNativeSessions.list()).map(session=>session.thread));
  threads.push(...(await zcodeNativeSessions.list()).map(session=>session.thread));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const thread of threads) {
    const projectPath = thread.projectPath?.trim();
    if (!projectPath) {
      continue;
    }
    const key = path.resolve(projectPath).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(path.resolve(projectPath));
    }
  }
  return result;
}

type HistoryCache = {file:string;size:number;mtime:number;line:number;tail:string;limit:number;turns?:number;omittedThrough:number;events:GatewayEvent[];transcript:GatewayEvent[];fallback:GatewayEvent[];hasResponse:boolean;lifecycle?:GatewayEvent;usage?:{info:Record<string,unknown>;updatedAt:string}};
const historyCache=new Map<string,HistoryCache>();
const historyReads=new Map<string,Promise<GatewayEvent[]>>();
const completionCache=new Map<string,{size:number;mtime:number;completedAt:number|undefined}>();
export async function invalidateCodexHistory(threadId:string):Promise<void>{
  if(isMainThread)return historyWorkerCall('invalidateCodexHistory',[threadId]);
  await Promise.allSettled([...historyReads].filter(([key])=>key.startsWith(threadId+':')).map(([,read])=>read));
  for(const file of historyCache.keys())if(path.basename(file).includes(threadId))historyCache.delete(file);
  for(const file of completionCache.keys())if(path.basename(file).includes(threadId))completionCache.delete(file);
}
// Completion identity comes from lifecycle timestamps, never title/sidebar updates.
export async function readCodexThreadCompletion(threadId:string):Promise<number> {
  if(threadId.startsWith('zcode-')){
    return (await zcodeNativeSessions.list()).find(session=>session.thread.id===threadId)?.completedAt||0;
  }
  if(threadId.startsWith('deepseek-')){
    const session=await deepseekNativeSessions.read(threadId);
    const latest=session?.events.slice().reverse().find(event=>event.type==='turn.started'||event.type==='turn.completed');
    return latest?.type==='turn.completed'&&latest.status==='completed'?Date.parse(latest.createdAt||'')||0:0;
  }
  const files=await findSessionFiles(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),threadId);
  for(const file of files.slice(-2).reverse()){
    const stat=await fs.stat(file),cached=completionCache.get(file);
    if(cached&&cached.size===stat.size&&cached.mtime===stat.mtimeMs){if(cached.completedAt!==undefined)return cached.completedAt;continue;}
    let completedAt:number|undefined;
    if(file.endsWith('.jsonl.zst')){
      const text=(await compressedRolloutTail(file)).buffer.toString('utf8');
      for(const line of text.split('\n').reverse()){
        completedAt=completionFromLine(line);if(completedAt!==undefined)break;
      }
    }else completedAt=await readLatestCompletion(file,stat.size);
    completionCache.set(file,{size:stat.size,mtime:stat.mtimeMs,completedAt});
    if(completionCache.size>600)completionCache.delete(completionCache.keys().next().value!);
    if(completedAt!==undefined)return completedAt;
  }
  return 0;
}
function completionFromLine(line:string):number|undefined{
  if(!line.includes('event_msg')||!/"(?:task_started|task_complete|task_completed|turn_aborted)"/.test(line))return;
  try{
    const row=JSON.parse(line),type=row.payload?.type;
    if(row.type==='event_msg'&&['task_started','task_complete','task_completed','turn_aborted'].includes(type))return type==='task_complete'||type==='task_completed'?Date.parse(row.timestamp)||0:0;
  }catch{}
}
async function readLatestCompletion(file:string,size:number):Promise<number|undefined>{
  const handle=await fs.open(file,'r');
  const start=Math.max(0,size-2*1024*1024);
  let end=size,sawNewline=false;
  const tail:Buffer[]=[];
  try{
    while(end>start){
      const position=Math.max(start,end-64*1024),buffer=Buffer.alloc(end-position);
      const {bytesRead}=await handle.read(buffer,0,buffer.length,position);
      let lineEnd=bytesRead;
      while(lineEnd>0){
        const newline=buffer.lastIndexOf(10,lineEnd-1);if(newline<0)break;
        sawNewline=true;
        const part=buffer.subarray(newline+1,lineEnd);
        // Keep partial lines as bytes until complete, including split UTF-8.
        const line=(tail.length?Buffer.concat([part,...tail]):part).toString('utf8');tail.length=0;
        const completedAt=completionFromLine(line);if(completedAt!==undefined)return completedAt;
        lineEnd=newline;
      }
      if(lineEnd)tail.unshift(buffer.subarray(0,lineEnd));
      end=position;
    }
    // Match the existing window rule: discard its partial leading line, except
    // at the start of the file or when the window contains no newline at all.
    if(start===0||!sawNewline)return completionFromLine(Buffer.concat(tail).toString('utf8'));
  }finally{await handle.close();}
}
// Search only recent text; a cold search must not parse entire multi-gigabyte rollouts.
export async function readRecentSearchEvents(threadId:string,signal?:AbortSignal):Promise<GatewayEvent[]> {
  if(threadId.startsWith('zcode-'))return (await zcodeNativeSessions.read(threadId))?.events.filter(event=>event.type==='user.message'||event.type==='message.delta').slice(-200)||[];
  if(isMainThread&&!threadId.startsWith('deepseek-'))return historyWorkerCall('readRecentSearchEvents',[threadId],'interactive',signal);
  if(threadId.startsWith('deepseek-'))return (await deepseekNativeSessions.read(threadId))?.events.filter(event=>event.type==='user.message'||event.type==='message.delta').slice(-200)||[];
  const files=await findSessionFiles(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),threadId);
  const events:GatewayEvent[]=[];
  for(const file of files.slice(-2)){
    if(file.endsWith('.jsonl.zst')){
      const tail=await compressedRolloutTail(file);
      for(const line of tail.buffer.toString('utf8').split('\n')){
        if(line.length>256*1024)continue;const event=eventFromCodexSessionLine(line,threadId);
        if(event?.type==='user.message'||event?.type==='message.delta')events.push(event);
      }
      continue;
    }
    const handle=await fs.open(file,'r');
    try{
      const {size}=await handle.stat(),start=Math.max(0,size-2*1024*1024);
      const buffer=Buffer.alloc(size-start);
      const {bytesRead}=await handle.read(buffer,0,buffer.length,start);
      const lines=buffer.subarray(0,bytesRead).toString('utf8').split('\n');
      if(start)lines.shift();
      for(const line of lines){
        if(line.length>256*1024)continue;
        const event=eventFromCodexSessionLine(line,threadId);
        if(event?.type==='user.message'||event?.type==='message.delta')events.push(event);
      }
    }finally{await handle.close();}
  }
  return events;
}
export async function readCodexThreadUsage(threadId:string){
  const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  const files=[...await findSessionFiles(home,threadId),
    ...(await listSessionFiles(path.join(home,'archived_sessions'))).filter(file=>path.basename(file).includes(threadId))];
  const snapshots=await Promise.all(files.map(file=>readTokenSnapshot(file).catch(()=>null)));
  return snapshots.filter(value=>value!==null).sort((a,b)=>Date.parse(b.observedAt||b.updatedAt)-Date.parse(a.observedAt||a.updatedAt))[0]??null;
}
export function readCodexThreadEvents(threadId:string, count?:number,priority:'interactive'|'background'='interactive',signal?:AbortSignal):Promise<GatewayEvent[]> {
  if(threadId.startsWith('zcode-'))return zcodeNativeSessions.read(threadId).then(session=>count?session?.events.slice(-count)||[]:session?.events||[]);
  if(isMainThread&&!threadId.startsWith('deepseek-'))return historyWorkerCall('readCodexThreadEvents',[threadId,count],priority,signal);
  if(threadId.startsWith('deepseek-'))return deepseekNativeSessions.read(threadId).then(session=>count?session?.events.slice(-count)||[]:session?.events||[]);
  const key=threadId+':'+(count??'default');
  const pending=historyReads.get(key);if(pending)return pending;
  const read=readHistory(threadId,count).finally(()=>historyReads.delete(key));historyReads.set(key,read);return read;
}
// Async questions live within the latest turn. Expand only when the retained
// window omitted that turn's beginning, including after multiple steer messages.
export async function readCodexQuestionEvents(threadId:string):Promise<GatewayEvent[]> {
  if(isMainThread&&!/^(deepseek|zcode)-/.test(threadId))return historyWorkerCall('readCodexQuestionEvents',[threadId],'background');
  if(/^(deepseek|zcode)-/.test(threadId))return readCodexThreadEvents(threadId);
  const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  const files=await findSessionFiles(home,threadId);
  const latestFile=files.at(-1);
  if(!latestFile)return [];
  if(latestFile.endsWith('.jsonl.zst'))return readCodexThreadEvents(threadId);
  for(let turns=1;turns<=1024;turns*=2){
    const events=await readHistoryFile(latestFile,threadId,Math.max(600,turns*4),turns+1);
    const start=events.slice().reverse().find(event=>event.type==='turn.started');
    if(start?.eventId){
      const prefix=`history:${threadId}:${path.basename(canonicalRollout(latestFile))}:`;
      const line=Number(start.eventId.slice(prefix.length)),cache=historyCache.get(latestFile);
      if(start.eventId.startsWith(prefix)&&cache&&Number.isSafeInteger(line)&&line>cache.omittedThrough)return events;
    }
    if(events.filter(event=>event.type==='user.message').length<turns+1)break;
  }
  return readCodexThreadEvents(threadId);
}
export function selectConversationTurns(events:GatewayEvent[],turns:number):GatewayEvent[] {
  let remaining=turns;
  for(let i=events.length-1;i>=0;i--)if(events[i].type==='user.message'&&--remaining===0)return events.slice(i);
  return events;
}
export async function readCodexConversationPreview(threadId:string,turns:number,signal?:AbortSignal):Promise<GatewayEvent[]>{
  // Resolve ZCode's gateway-to-native session alias on the main thread. The
  // native transcript itself is still read by the history worker.
  if(isMainThread&&!threadId.startsWith('zcode-'))return historyWorkerCall('readCodexConversationPreview',[threadId,turns],'interactive',signal);
  return confirmedToolChanges((await readCodexConversationEvents(threadId,turns)).filter(isVisibleMobileThreadEvent)).map(event=>deferMobileActivityDetails(event) as GatewayEvent);
}

export function readCodexConversationEvents(threadId:string,turns:number,signal?:AbortSignal):Promise<GatewayEvent[]> {
  if(threadId.startsWith('zcode-'))return zcodeNativeSessions.read(threadId).then(session=>selectConversationTurns(session?.events||[],turns+1));
  if(isMainThread&&!threadId.startsWith('deepseek-'))return historyWorkerCall('readCodexConversationEvents',[threadId,turns],'interactive',signal);
  if(threadId.startsWith('deepseek-'))return deepseekNativeSessions.read(threadId).then(session=>selectConversationTurns(session?.events||[],turns+1));
  const key=threadId+':turns:'+turns;
  const pending=historyReads.get(key);if(pending)return pending;
  const read=(async()=>{
    const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
    const files=await findSessionFiles(home,threadId);
    const result:GatewayEvent[]=[];
    for(const file of files.slice().reverse()){
      // Tool traffic does not determine how many visible exchanges a page contains.
      let limit=Math.max(600,turns*4),events:GatewayEvent[]=[];
      while(true){
        events=await readHistoryFile(file,threadId,limit,turns+1);
        const omitted=historyCache.get(file)?.omittedThrough??0;
        const first=selectConversationTurns(events,turns+1)[0];
        const firstLine=Number(first?.eventId?.split(':').at(-1))||0;
        if(!omitted||(events.filter(event=>event.type==='user.message').length>=turns+1&&firstLine>omitted)||limit>=32768)break;
        limit*=2;
      }
      result.unshift(...events);
      if(result.filter(event=>event.type==='user.message').length>=turns+1)break;
    }
    return result;
  })().finally(()=>historyReads.delete(key));
  historyReads.set(key,read);return read;
}
async function readCodexThreadLineById(threadId:string,eventId:string):Promise<string|null> {
  const prefix=`history:${threadId}:`;
  if(!eventId.startsWith(prefix))return null;
  const rest=eventId.slice(prefix.length),separator=rest.lastIndexOf(':');
  if(separator<1)return null;
  const filename=rest.slice(0,separator),lineNumber=Number(rest.slice(separator+1));
  if(!Number.isSafeInteger(lineNumber)||lineNumber<1)return null;
  const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  const file=(await findSessionFiles(home,threadId)).find(candidate=>path.basename(canonicalRollout(candidate))===filename);
  if(!file)return null;
  return (await readHistoryLines(file,[lineNumber])).get(lineNumber)??null;
}
export async function readCodexThreadEventById(threadId:string,eventId:string,signal?:AbortSignal):Promise<GatewayEvent|null> {
  if(threadId.startsWith('zcode-'))return (await zcodeNativeSessions.read(threadId))?.events.find(event=>event.eventId===eventId&&event.type==='user.message')??null;
  if(signal?.aborted)throw new DOMException('历史读取已取消','AbortError');
  if(isMainThread)return historyWorkerCall('readCodexThreadEventById',[threadId,eventId],'interactive',signal);
  const line=await readCodexThreadLineById(threadId,eventId);
  const event=line?eventFromCodexSessionLine(line,threadId):null;
  return event?.type==='user.message'?{...event,eventId}:null;
}
export async function readCodexOutputEventById(threadId:string,eventId:string,signal?:AbortSignal):Promise<GatewayEvent|null> {
  if(threadId.startsWith('zcode-'))return (await zcodeNativeSessions.read(threadId))?.events.find(event=>event.eventId===eventId&&event.type==='message.delta')??null;
  if(signal?.aborted)throw new DOMException('历史读取已取消','AbortError');
  if(isMainThread)return historyWorkerCall('readCodexOutputEventById',[threadId,eventId],'interactive',signal);
  const line=await readCodexThreadLineById(threadId,eventId);
  const event=line?eventFromCodexSessionLine(line,threadId):null;
  return event?.type==='message.delta'?{...event,eventId}:null;
}
export async function readCodexOutputSourceEventById(threadId:string,eventId:string,signal?:AbortSignal):Promise<GatewayEvent|null>{
  if(threadId.startsWith('zcode-'))return (await zcodeNativeSessions.read(threadId))?.events.find(event=>event.eventId===eventId)??null;
  if(signal?.aborted)throw new DOMException('历史读取已取消','AbortError');
  if(isMainThread)return historyWorkerCall('readCodexOutputSourceEventById',[threadId,eventId],'interactive',signal);
  for(const cached of historyCache.values()){
    if(!path.basename(cached.file).includes(threadId))continue;
    const event=[...cached.events,...cached.transcript,...cached.fallback].find(event=>event.eventId===eventId);
    if(event&&(event.type==='message.delta'||mobileDeferredActivityTypes.has(event.type)))return event;
  }
  const line=await readCodexThreadLineById(threadId,eventId);if(!line)return null;
  let row:any;try{row=JSON.parse(line);}catch{return null;}
  const event=eventFromCodexSessionLine(line,threadId,row);
  if(event?.type==='message.delta')return {...event,eventId};
  return event&&mobileDeferredActivityTypes.has(event.type)?{...event,eventId,createdAt:row.timestamp,itemId:('itemId' in event?event.itemId:undefined)??row.payload?.id??'history:'+eventId.split(':').at(-1)} as GatewayEvent:null;
}
export async function readCodexActivityEventById(threadId:string,eventId:string):Promise<GatewayEvent|null> {
  return (await readCodexActivityEventsByIds(threadId,[eventId]))[0]??null;
}
export async function readCodexActivityEventsByIds(threadId:string,eventIds:string[],signal?:AbortSignal):Promise<(GatewayEvent|null)[]> {
  if(threadId.startsWith('zcode-')){const events=new Map((await zcodeNativeSessions.read(threadId))?.events.map(event=>[event.eventId,event]));return eventIds.map(id=>events.get(id)??null);}
  if(signal?.aborted)throw new DOMException('历史读取已取消','AbortError');
  if(!eventIds.length)return [];
  if(isMainThread)return historyWorkerCall('readCodexActivityEventsByIds',[threadId,eventIds],'interactive',signal);
  const wanted=new Set(eventIds),found=new Map<string,GatewayEvent>();
  for(const cached of historyCache.values()){
    if(!path.basename(cached.file).includes(threadId))continue;
    for(const event of cached.events)if(event.eventId&&wanted.has(event.eventId)&&mobileDeferredActivityTypes.has(event.type))found.set(event.eventId,event);
  }
  const prefix=`history:${threadId}:`,requests=new Map<string,Map<number,string[]>>();
  for(const eventId of wanted){
    if(found.has(eventId)||!eventId.startsWith(prefix))continue;
    const rest=eventId.slice(prefix.length),separator=rest.lastIndexOf(':'),filename=rest.slice(0,separator),line=Number(rest.slice(separator+1));
    if(separator<1||!Number.isSafeInteger(line)||line<1)continue;
    let lines=requests.get(filename);if(!lines){lines=new Map();requests.set(filename,lines);}lines.set(line,[...(lines.get(line)??[]),eventId]);
  }
  if(requests.size){
    const files=await findSessionFiles(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),threadId);
    for(const file of files){
      const lines=requests.get(path.basename(canonicalRollout(file)));if(!lines)continue;
      const selected=await readHistoryLines(file,[...lines.keys()]);
      for(const [lineNumber,line] of selected){
        let row:any;try{row=JSON.parse(line);}catch{continue;}
        const event=eventFromCodexSessionLine(line,threadId,row);if(!event||!mobileDeferredActivityTypes.has(event.type))continue;
        for(const eventId of lines.get(lineNumber)!)found.set(eventId,{...event,eventId,createdAt:row.timestamp,itemId:('itemId' in event?event.itemId:undefined)??row.payload?.id??'history:'+lineNumber} as GatewayEvent);
      }
    }
  }
  return eventIds.map(id=>found.get(id)??null);
}
async function readHistoryLines(file:string,lines:number[]):Promise<Map<number,string>>{
  const wanted=new Set(lines),first=Math.min(...lines),last=Math.max(...lines),result=new Map<number,string>();
  const stat=await fs.stat(file);if(!stat.size)return result;
  const compressed=file.endsWith('.jsonl.zst'),offsets=compressed?undefined:await HistoryOffsetIndex.open(file,stat);
  const start=offsets?.beforeLine(first)??{offset:0,line:0};
  const stream=compressed?rolloutChunks(file,{signal:AbortSignal.timeout(15000)}):createReadStream(file,{start:start.offset,end:stat.size-1,highWaterMark:256*1024,signal:AbortSignal.timeout(15000)});
  let current=start.line,position=start.offset,size=0,parts:Buffer[]=[];
  const append=(part:Buffer)=>{size+=part.length;if(size>32*1024*1024)throw Error('历史消息过大');parts.push(part);};
  try{
    for await(const chunk of stream){
      let begin=0,done=false;
      for(let end=chunk.indexOf(10);end>=0;end=chunk.indexOf(10,begin)){
        if(wanted.has(current+1)){append(chunk.subarray(begin,end));result.set(current+1,Buffer.concat(parts,size).toString('utf8'));}
        current++;parts=[];size=0;begin=end+1;
        if(current>=last){done=true;break;}
      }
      if(done)break;
      if(wanted.has(current+1))append(chunk.subarray(begin));
      position+=chunk.length;offsets?.record(position,current);
    }
    if(wanted.has(current+1)&&size)result.set(current+1,Buffer.concat(parts,size).toString('utf8'));
  }finally{
    if('destroy' in stream)stream.destroy();else await stream.return(undefined);
    await offsets?.save();
  }
  return result;
}
export {mobileDeferredActivityTypes,deferMobileActivityDetails,type DeferredActivityEvent} from './mobileActivityDetails.js';
type EmbeddedHistoryImage={bytes:Buffer;mime:string};
type HistoryImageSource={file?:{absolutePath:string;size:number};embedded?:EmbeddedHistoryImage};
function embeddedImageBuffer(image:{bytes:Uint8Array;mime:string}|null):EmbeddedHistoryImage|null{
  return image?{mime:image.mime,bytes:Buffer.isBuffer(image.bytes)?image.bytes:Buffer.from(image.bytes.buffer,image.bytes.byteOffset,image.bytes.byteLength)}:null;
}
function embeddedImageFromRow(row:any,imageIndex:number):EmbeddedHistoryImage|null{
  if(row?.type!=='response_item'||row.payload?.type!=='message'||row.payload?.role!=='user')return null;
  const url=visibleEmbeddedImages(row.payload)[imageIndex]?.url;
  if(!url)return null;
  const match=/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z\d+/=]+)$/.exec(url);
  if(!match||match[2].length>28*1024*1024)return null;
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>20*1024*1024)return null;
  return {bytes,mime:`image/${match[1]}`};
}
export async function readCodexThreadEmbeddedImage(threadId:string,eventId:string,imageIndex:number,signal?:AbortSignal):Promise<EmbeddedHistoryImage|null> {
  if(signal?.aborted)throw new DOMException('历史读取已取消','AbortError');
  if(isMainThread)return embeddedImageBuffer(await historyWorkerCall<EmbeddedHistoryImage|null>('readCodexThreadEmbeddedImage',[threadId,eventId,imageIndex],'interactive',signal));
  const line=await readCodexThreadLineById(threadId,eventId);
  if(!line)return null;
  try{return embeddedImageFromRow(JSON.parse(line),imageIndex);}catch{return null;}
}
export async function readCodexHistoryImageSource(threadId:string,eventId:string,index:number,projectPaths:string[],signal?:AbortSignal):Promise<HistoryImageSource|null>{
  if(signal?.aborted)throw new DOMException('历史读取已取消','AbortError');
  if(isMainThread){
    const source=await historyWorkerCall<HistoryImageSource|null>('readCodexHistoryImageSource',[threadId,eventId,index,projectPaths],'interactive',signal);
    return source?.embedded?{...source,embedded:embeddedImageBuffer(source.embedded)!}:source;
  }
  const line=await readCodexThreadLineById(threadId,eventId);if(!line)return null;
  let row:any;try{row=JSON.parse(line);}catch{return null;}
  const event=eventFromCodexSessionLine(line,threadId,row);
  if(event?.type!=='user.message')return null;
  const attachment=event.attachments?.[index];if(!attachment)return null;
  const embeddedIndex=/^history-embedded-image:(\d+)\.(?:png|jpeg|webp|gif)$/.exec(attachment.path)?.[1];
  if(embeddedIndex!==undefined){
    const embedded=embeddedImageFromRow(row,Number(embeddedIndex));return embedded?{embedded}:null;
  }
  const file=await resolveHistoryImage(attachment.path,projectPaths);if(file)return {file};
  if(!isHistoryClipboardImage(attachment.path))return null;
  const imageIndex=event.attachments!.slice(0,index).filter(item=>/\.(png|jpe?g|webp|gif)$/i.test(item.path)).length;
  const embedded=embeddedImageFromRow(row,imageIndex);return embedded?{embedded}:null;
}
async function readHistory(threadId:string,count?:number):Promise<GatewayEvent[]> {
  const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  const files=await findSessionFiles(home,threadId);
  const result:GatewayEvent[]=[];
  for(const file of files.slice().reverse()){
    const required=(count??0)+1;
    result.unshift(...await readHistoryFile(file,threadId,Math.max(600,2**Math.ceil(Math.log2(required)))));
    if(count===undefined?result.filter(event=>event.type==='user.message'||event.type==='message.delta').length>=200:result.length>=count+1&&conversationPageStart(result,count)>0)break;
  }
  return count===undefined?selectConversationWindow(result):result.slice(Math.max(0,conversationPageStart(result,count)-1));
}

function conversationPageStart(events:GatewayEvent[],count:number):number {
  let start=Math.max(0,events.length-count);
  // Retain the last completed exchange even while a newer turn is still running.
  let completed=-1;
  for(let i=events.length-1;i>=0;i--)if(events[i].type==='turn.completed'){completed=i;break;}
  if(completed>=0)start=Math.min(start,completed);
  for(let i=start;i>=0;i--)if(events[i]?.type==='user.message')return i;
  return start;
}
export function selectConversationPage(events:GatewayEvent[],count:number):GatewayEvent[] {
  return events.slice(conversationPageStart(events,count));
}

export function selectConversationWindow(events:GatewayEvent[]):GatewayEvent[] {
  const messages=events.filter(event=>event.type==='user.message'||event.type==='message.delta');
  let start=Math.max(0,messages.length-80);
  // The default window can end inside hundreds of deltas for one item. Include
  // that item's first fragment as well, rather than returning a suffix as a reply.
  const first=messages[start];
  if(first?.type==='message.delta'&&first.itemId)while(start>0){
    const prior=messages[start-1];
    if(prior.type!=='message.delta'||prior.itemId!==first.itemId)break;
    start--;
  }
  const dialogue=messages.slice(start);
  const activity=events.filter(event=>event.type!=='user.message'&&event.type!=='message.delta'&&event.type!=='tool.output'&&event.type!=='warning').slice(-80);
  const output=events.filter(event=>event.type==='tool.output'||event.type==='warning').slice(-30);
  const attention=events.filter(event=>event.type==='approval.requested'||event.type==='error').slice(-10);
  const lifecycle=events.filter(event=>event.type==='turn.started'||event.type==='turn.completed').at(-1);
  const latestStart=events.filter(event=>event.type==='turn.started').at(-1);
  const included=new Set([...dialogue,...activity,...output,...attention,...(lifecycle?[lifecycle]:[]),...(latestStart?[latestStart]:[])]);
  return events.filter(event=>included.has(event));
}

const fileReads=new Map<string,Promise<GatewayEvent[]>>();
function historyTimeSlice(){
  let deadline=performance.now()+8;
  return ()=>performance.now()<deadline?null:new Promise<void>(resolve=>setImmediate(()=>{deadline=performance.now()+8;resolve();}));
}
const tailParses=new WeakMap<HistoryCache,{text:string;row:any;event:GatewayEvent|null}>();
function ignoredHistoryLine(line:string):boolean{
  // Native bookkeeping duplicates tool output, images and model context. These
  // types never produce timeline events; avoid decoding their large payloads.
  // Match only the canonical leading keys, falling back to JSON for other orderings.
  const header=line.slice(0,400);
  return /^\s*\{\s*(?:"timestamp"\s*:\s*"[^"\\]*"\s*,\s*)?"type"\s*:\s*"(?:world_state|turn_context|token_usage_record|session_meta|model|item_completed|custom_tool_call|custom_tool_call_output)"\s*[,}]/.test(header)||
    /^\s*\{\s*(?:"timestamp"\s*:\s*"[^"\\]*"\s*,\s*)?"type"\s*:\s*"event_msg"\s*,\s*"payload"\s*:\s*\{\s*"type"\s*:\s*"(?:item_completed|thread_settings_applied|thread_goal_updated)"\s*[,}]/.test(header);
}
async function readHistoryFile(file:string,threadId:string,limit:number,turns?:number):Promise<GatewayEvent[]> {
  if(file.endsWith('.jsonl.zst')){
    const checkpoint=historyTimeSlice();
    const tail=await compressedRolloutTail(file),lines=tail.buffer.toString('utf8').split('\n');lines.pop();
    const events:GatewayEvent[]=[],transcript:GatewayEvent[]=[],fallback:GatewayEvent[]=[];
    let hasResponse=false,lifecycle:GatewayEvent|undefined;
    for(let i=0;i<lines.length;i++){
      const pause=checkpoint();if(pause)await pause;
      if(ignoredHistoryLine(lines[i]))continue;
      let row:any;try{row=JSON.parse(lines[i]);}catch{continue;}
      const event=eventFromCodexSessionLine(lines[i],threadId,row);if(!event)continue;
      const identified={...event,eventId:'history:'+threadId+':'+path.basename(canonicalRollout(file))+':'+(tail.startLine+i+1),createdAt:row.timestamp,itemId:('itemId' in event?event.itemId:undefined)??row.payload?.id??'history:'+(tail.startLine+i+1)};
      if(event.type==='turn.started'||event.type==='turn.completed')lifecycle=identified;
      const message=['user.message','message.delta'].includes(event.type);
      if(message&&row.type==='response_item')hasResponse=true;
      (message?(row.type==='response_item'?transcript:fallback):events).push(identified);
    }
    const result=[...events,...(hasResponse?transcript:fallback)].sort((a,b)=>Number(a.eventId?.split(':').at(-1))-Number(b.eventId?.split(':').at(-1))).slice(-limit);
    if(lifecycle&&!result.includes(lifecycle))result.unshift(lifecycle);
    historyCache.set(file,{file,size:(await fs.stat(file)).size,mtime:0,line:tail.totalLines,tail:'',limit,omittedThrough:tail.startLine,events:[],transcript:[],fallback:[],hasResponse,lifecycle});
    if(historyCache.size>24)historyCache.delete(historyCache.keys().next().value!);
    return foldCompactionSummaries(result);
  }
  // History and approval requests may arrive together and share the append cursor.
  while(fileReads.has(file))await fileReads.get(file);
  const pending=readHistoryFileExclusive(file,threadId,limit,turns);
  fileReads.set(file,pending);
  try{return await pending;}finally{fileReads.delete(file);}
}
async function readHistoryFileExclusive(file:string,threadId:string,limit:number,turns?:number):Promise<GatewayEvent[]> {
  const checkpoint=historyTimeSlice();
  const stat=await fs.stat(file).catch(()=>null);if(!stat)return [];
  let cached=historyCache.get(file);
  if(!cached||cached.file!==file||stat.size<cached.size||(stat.size===cached.size&&stat.mtimeMs!==cached.mtime)||cached.limit<limit||(turns??0)>(cached.turns??0)) {
    cached={file,size:0,mtime:0,line:0,tail:'',limit:turns?Math.max(limit,32768):limit,turns,omittedThrough:0,events:[],transcript:[],fallback:[],hasResponse:false};historyCache.set(file,cached);
    if(stat.size>8*1024*1024){
      const handle=await fs.open(file,'r');
      try{
        let window=8*1024*1024,start=0,tailHasLifecycle=false;
        while(true){
          const offset=Math.max(0,stat.size-window),buffer=Buffer.alloc(stat.size-offset);
          await handle.read(buffer,0,buffer.length,offset);
          const boundary=offset?buffer.indexOf(10)+1:0;
          start=offset+boundary;
          let found=0,responseUsers=0,fallbackUsers=0,hasResponse=false,fallbackStart=start;
          // Probe byte boundaries instead of decoding each expanding window.
          // Only candidate messages need JSON; tool/image bodies stay as bytes.
          let end=buffer.length;
          if(end>boundary&&buffer[end-1]===10)end--;
          while(end>=boundary){
            const pause=checkpoint();if(pause)await pause;
            const begin=Math.max(boundary,(end?buffer.lastIndexOf(10,end-1):-1)+1);
            const header=buffer.subarray(begin,Math.min(end,begin+400)).toString('utf8');
            const line=()=>buffer.subarray(begin,end).toString('utf8');
            if(!tailHasLifecycle&&/"(?:task_started|task_complete|task_completed|turn_aborted)"/.test(header)){
              const event=eventFromCodexSessionLine(line(),threadId);
              tailHasLifecycle=event?.type==='turn.started'||event?.type==='turn.completed';
            }
            if(turns){
              // Skip tool bodies during probes; classify user messages fully
              // so hidden desktop page events do not count as visible turns.
              const response=/"type"\s*:\s*"response_item"/.test(header);
              if(response&&/"type"\s*:\s*"message"/.test(header))hasResponse=true;
              if(response&&/"role"\s*:\s*"user"/.test(header)&&eventFromCodexSessionLine(line(),threadId)?.type==='user.message')responseUsers++;
              else if(!response&&/"type"\s*:\s*"user_message"/.test(header)&&eventFromCodexSessionLine(line(),threadId)?.type==='user.message'){
                fallbackUsers++;if(fallbackUsers===turns)fallbackStart=offset+begin;
              }
              if(responseUsers>=turns){start=offset+begin;break;}
            }else if(eventFromCodexSessionLine(line(),threadId)&&++found>=limit)break;
            if(begin===boundary)break;
            end=begin-1;
          }
          if(turns&&!hasResponse&&fallbackUsers>=turns)start=fallbackStart;
          if(!offset||(turns?(hasResponse?responseUsers:fallbackUsers)>=turns:found>=limit))break;
          window*=2;
        }
        // Count bytes only in the skipped prefix to retain stable history IDs.
        if(start){
          const offsets=tailHasLifecycle?await HistoryOffsetIndex.open(file,stat):undefined;
          const known=offsets?.before(start)??{offset:0,line:0};
          cached.line=known.line;
          let position=known.offset;
          let head=Buffer.alloc(0),longLine=false;
          if(position<start)for await(const chunk of createReadStream(file,{start:position,end:start-1,highWaterMark:1024*1024})){
            if(tailHasLifecycle){
              // The retained tail supersedes every older lifecycle event. The
              // skipped prefix only needs a byte scan to keep stable line IDs.
              const pause=checkpoint();if(pause)await pause;
              for(let at=chunk.indexOf(10);at!==-1;at=chunk.indexOf(10,at+1))cached.line++;
              position+=chunk.length;offsets?.record(position,cached.line);
              continue;
            }
            let begin=0;
            for(let p=chunk.indexOf(10);p!==-1;p=chunk.indexOf(10,p+1)){
              const pause=checkpoint();if(pause)await pause;
              cached.line++;
              if(!longLine&&head.length+p-begin<16384){
                const line=Buffer.concat([head,chunk.subarray(begin,p)]).toString('utf8');
                if(/"(?:task_started|task_complete|task_completed|turn_aborted)"/.test(line)){
                  const event=eventFromCodexSessionLine(line,threadId);
                  if(event&&(event.type==='turn.started'||event.type==='turn.completed'))cached.lifecycle={...event,eventId:'history:'+threadId+':'+path.basename(file)+':'+cached.line,createdAt:JSON.parse(line).timestamp};
                }
              }
              head=Buffer.alloc(0);longLine=false;begin=p+1;
            }
            if(head.length+chunk.length-begin<16384&&!longLine)head=Buffer.concat([head,chunk.subarray(begin)]);
            else{head=Buffer.alloc(0);longLine=true;}
          }
          await offsets?.save();
          cached.size=start;
          cached.omittedThrough=cached.line;
        }
      }finally{await handle.close();}
    }
    if(historyCache.size>24)historyCache.delete(historyCache.keys().next().value!);
  }
  if(stat.size>cached.size){
    const stream=createReadStream(file,{start:cached.size,end:stat.size-1,encoding:'utf8',highWaterMark:1024*1024});
    // Keep long unfinished lines in chunks, avoiding repeated scans/copies of
    // the entire image/tool payload each time another stream chunk arrives.
    let fragments=cached.tail?[cached.tail]:[];
    for await(const chunk of stream){
      const pause=checkpoint();if(pause)await pause;
      const lines=(chunk as string).split('\n');
      if(lines.length===1){fragments.push(lines[0]);continue;}
      lines[0]=fragments.length?fragments.join('')+lines[0]:lines[0];
      fragments=[lines.pop()||''];
      for(const line of lines){cached.line++;
        const pause=checkpoint();if(pause)await pause;
        if(ignoredHistoryLine(line))continue;
        let row:any;try{row=JSON.parse(line);}catch{continue;}
        if(row.type==='event_msg'&&row.payload?.type==='token_count'&&row.payload.info)cached.usage={info:row.payload.info,updatedAt:row.timestamp};
        const event=eventFromCodexSessionLine(line,threadId,row);if(!event)continue;
        const identified={...event,eventId:'history:'+threadId+':'+path.basename(file)+':'+cached.line,createdAt:row.timestamp,itemId:('itemId' in event?event.itemId:undefined)??row.payload?.id??'history:'+cached.line};
        if(row.type==='response_item'&&['user.message','message.delta'].includes(event.type))cached.hasResponse=true;
        if(event.type==='turn.started'||event.type==='turn.completed')cached.lifecycle=identified;
        const isMessage=['user.message','message.delta'].includes(event.type);
        const target=isMessage?(row.type==='response_item'?cached.transcript:cached.fallback):cached.events;
        target.push(identified);if(target.length>cached.limit){const removed=target.shift();cached.omittedThrough=Math.max(cached.omittedThrough,Number(removed?.eventId?.split(':').at(-1))||0);}
        if(cached.turns&&event.type==='user.message'&&(row.type==='response_item'||!cached.hasResponse)){
          const first=selectConversationTurns(cached.hasResponse?cached.transcript:cached.fallback,cached.turns)[0];
          const firstLine=Number(first?.eventId?.split(':').at(-1))||0;
          const currentStart=cached.events.slice().reverse().find(event=>event.type==='turn.started');
          const startLine=Number(currentStart?.eventId?.split(':').at(-1))||firstLine;
          const keepFrom=Math.min(firstLine,startLine);
          if(keepFrom>cached.omittedThrough){
            const keep=(event:GatewayEvent)=>Number(event.eventId?.split(':').at(-1))>=keepFrom;
            cached.events=cached.events.filter(keep);cached.transcript=cached.transcript.filter(keep);cached.fallback=cached.fallback.filter(keep);
            cached.omittedThrough=keepFrom-1;
          }
        }
      }
    }
    cached.tail=fragments.join('');
    cached.size=stat.size;cached.mtime=stat.mtimeMs;
  }
  const result=[...cached.events,...(cached.hasResponse?cached.transcript:cached.fallback)].sort((a,b)=>Number(a.eventId?.split(':').pop())-Number(b.eventId?.split(':').pop()));
  // A long-running turn can produce more than the visible history window.
  if(cached.lifecycle&&!result.some(e=>e.eventId===cached.lifecycle?.eventId))result.unshift(cached.lifecycle);
  let parsedTail=tailParses.get(cached);
  if(!parsedTail||parsedTail.text!==cached.tail){
    let row:any;try{row=JSON.parse(cached.tail);}catch{}
    parsedTail={text:cached.tail,row,event:row?eventFromCodexSessionLine(cached.tail,threadId,row):null};tailParses.set(cached,parsedTail);
  }
  const tailEvent=parsedTail.event;
  if(tailEvent){
    const row=parsedTail.row;
    if(row.type==='response_item'||!cached.hasResponse||!['user.message','message.delta'].includes(tailEvent.type))result.push({...tailEvent,eventId:'history:'+threadId+':'+path.basename(file)+':'+(cached.line+1),createdAt:row.timestamp});
  }
  return foldCompactionSummaries(result);
}

async function listCodexIndexedThreads(knownThreads:any[]=[],archived:ReadonlySet<string>=new Set()): Promise<ThreadRecord[]> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const indexPath = path.join(codexHome, "session_index.jsonl");
  let content = "";
  try {
    content = await fs.readFile(indexPath, "utf8");
  } catch {
    return [];
  }

  const entries = latestIndexEntries(content)
    .sort((a, b) => normalizeIso(b.updated_at).localeCompare(normalizeIso(a.updated_at)))
    .slice(0, MAX_INDEXED_THREADS).filter(entry=>!entry.id||!archived.has(entry.id));
  const ids = new Set(entries.map((entry) => entry.id?.trim()).filter((id): id is string => Boolean(id)));
  // The desktop index already supplies these fields. Reopening hundreds of
  // rollout headers for every sidebar page delays even LAN requests.
  const metaById=new Map<string,CodexSessionMeta>(knownThreads.filter(row=>ids.has(row.id)).map(row=>[row.id,{
    ...row,timestamp:new Date(Number(row.created_at_ms||row.updated_at_ms||0)).toISOString(),
  }]));
  for(const [id,meta] of await readSessionMetadata(codexHome,new Set([...ids].filter(id=>!metaById.has(id)))))metaById.set(id,meta);

  return entries
    .filter((entry): entry is CodexSessionIndexEntry & { id: string } => Boolean(entry.id))
    .map((entry) => {
      const meta = metaById.get(entry.id);
      const updatedAt = normalizeIso(entry.updated_at || meta?.timestamp);
      return {
        id: entry.id,
        projectPath: meta?.cwd,
        ...(meta?{subagent:subagentMetadata(meta as Record<string,unknown>)}:{}),
        title: (entry.thread_name || "").trim() || "Codex 历史会话",
        status: "idle",
        createdAt: normalizeIso(meta?.timestamp || updatedAt),
        updatedAt,
      };
    });
}

export function latestIndexEntries(content: string): CodexSessionIndexEntry[] {
  const byId = new Map<string, CodexSessionIndexEntry>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const entry = JSON.parse(trimmed) as CodexSessionIndexEntry;
      const id = entry.id?.trim();
      if (!id) {
        continue;
      }
      const existing = byId.get(id);
      if (!existing || normalizeIso(entry.updated_at).localeCompare(normalizeIso(existing.updated_at)) >= 0) {
        byId.set(id, entry);
      }
    } catch {
      // Ignore malformed rows left by partial writes.
    }
  }
  return [...byId.values()];
}

async function readSessionMetadata(codexHome: string, ids: Set<string>): Promise<Map<string, CodexSessionMeta>> {
  const result = new Map<string, CodexSessionMeta>();
  if (ids.size === 0) {
    return result;
  }
  const files = await listSessionFiles(path.join(codexHome, "sessions"));
  for (const file of files) {
    if (result.size >= ids.size) {
      break;
    }
    const id = [...ids].find((candidate) => file.includes(candidate));
    if (!id || result.has(id)) {
      continue;
    }
    const meta = await readSessionMetaLine(file);
    if (meta) {
      result.set(id, meta);
    }
  }
  return result;
}

async function findSessionFiles(codexHome: string, threadId: string): Promise<string[]> {
  const files = await listSessionFiles(path.join(codexHome, "sessions"));
  const matches = files.filter((file) => path.basename(file).includes(threadId));
  if (!matches.length) return [];
  // A resumed desktop thread can have several rollout files with the same
  // thread id. Directory traversal starts at the oldest one.
  const dated = await Promise.all(matches.map(async file => ({file, mtime:(await fs.stat(file).catch(()=>null))?.mtimeMs ?? 0})));
  return dated.sort((a,b)=>a.mtime-b.mtime).map(row=>row.file);
}

const fileInventories = new Map<string, { expires: number; result: Promise<string[]> }>();

async function listSessionFiles(root: string): Promise<string[]> {
  const cached = fileInventories.get(root);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = scanSessionFiles(root);
  fileInventories.set(root, { expires: Date.now() + 5000, result });
  return result;
}

async function scanSessionFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && /\.jsonl(?:\.zst)?$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  const unique=new Map<string,string>();
  for(const file of files){const key=canonicalRollout(file);if(!unique.has(key)||!file.endsWith('.zst'))unique.set(key,file);}
  return [...unique.values()];
}

async function readSessionMetaLine(file: string): Promise<CodexSessionMeta | null> {
  try {
    if(file.endsWith('.jsonl.zst')){
      let first='';for await(const chunk of rolloutChunks(file,{signal:AbortSignal.timeout(5000)})){
        first+=chunk.toString('utf8');if(first.includes('\n')||first.length>=512*1024)break;
      }
      const row=JSON.parse(first.split('\n',1)[0]);return row.type==='session_meta'?row.payload:null;
    }
    const handle = await fs.open(file, "r");
    try {
      const buffer = Buffer.alloc(512 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/, 1)[0];
      const parsed = JSON.parse(firstLine) as { type?: string; payload?: CodexSessionMeta };
      if (parsed.type === "session_meta" && parsed.payload) {
        return parsed.payload;
      }
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeIso(value?: string): string {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date(0).toISOString();
}

function latestIso(left: string, right?: string): string {
  return normalizeIso(left).localeCompare(normalizeIso(right)) >= 0 ? normalizeIso(left) : normalizeIso(right);
}

function meaningfulStoredTitle(title: string): boolean {
  const normalized = title.trim();
  return normalized !== "" && normalized !== "新对话" && normalized !== "未命名会话" && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(normalized) && !normalized.startsWith("对话 · ");
}

function eventFromCodexSessionLine(line: string, threadId: string, parsedRow?:unknown): GatewayEvent | null {
  if(parsedRow===undefined&&ignoredHistoryLine(line))return null;
  let row: unknown=parsedRow;
  try {
    if(row===undefined)row = JSON.parse(line);
  } catch {
    return null;
  }
  const record = readRecord(row);
  const type = readString(record?.type);
  const payload = readRecord(record?.payload);
  if (!payload) {
    return null;
  }
  if(type==='compacted')return {type:'context.compaction',threadId,title:'上下文已自动压缩',text:compactionSummary(payload.message),status:'ok'};

  if (type === "event_msg" && readString(payload.type) === "user_message") {
    const notification=subagentNotificationEvent(payload.message,threadId);if(notification)return notification;
    const delegated=delegatedMessage(payload.message);
    if(delegated)return {type:'user.message',threadId,...delegated,userVisible:true};
    const reply=desktopQuestionReply(readString(payload.message)??'');
    if(reply)return {type:'user.message',threadId,text:reply.text,questionReplyId:reply.callId,questionReplies:reply.replies,userVisible:true};
    const text = visibleLegacyUserText(readString(payload.message) ?? "");
    return text ? { type: "user.message", threadId, ...splitDesktopAttachments(text), userVisible: true } : null;
  }

  if (type === "event_msg" && readString(payload.type) === "agent_message") {
    const text = readString(payload.message)?.trim();
    if (text && isInjectedContext(text)) {
      return null;
    }
    return text ? { type: "message.delta", threadId, text, textComplete:true } : null;
  }

  if(type==='event_msg') {
    const kind=readString(payload.type);
    if(kind==='task_started') return {type:'turn.started',threadId,turnId:readString(payload.turn_id)};
    if(kind==='task_complete'||kind==='task_completed'||kind==='turn_aborted') return {type:'turn.completed',threadId,turnId:readString(payload.turn_id),status:kind==='turn_aborted'?'interrupted':'completed'};
    if(kind==='context_compacted'||kind==='context_compaction') return {type:'context.compaction',threadId,title:'压缩上下文',status:'ok'};
    if(kind==='context_compaction_started'||kind==='compaction_started')return {type:'context.compaction',threadId,title:'正在压缩上下文',status:'running'};
    if(kind==='exec_command_begin') return {type:'tool.started',threadId,itemId:readString(payload.call_id),title:'执行命令',detail:Array.isArray(payload.command)?payload.command.join(' '):readString(payload.command)};
    if(kind==='exec_command_end') return {type:'tool.completed',threadId,itemId:readString(payload.call_id),status:payload.exit_code===0?'ok':'error',detail:readString(payload.aggregated_output)?.slice(-12000)};
  }

  if (type !== "response_item") {
    return null;
  }
  if(['function_call','custom_tool_call'].includes(String(payload.type))){
    const name=readString(payload.name)||'执行工具';
    if(name.split(/[.:/]/).at(-1)==='request_user_input_async')return desktopAsyncQuestionEvent(threadId,payload)??null;
    const raw=readString(payload.arguments)||readString(payload.input)||'';
    const activity=historyToolPresentation(name,raw);
    return {type:'tool.started',threadId,itemId:readString(payload.call_id),...activity};
  }
  if(['function_call_output','custom_tool_call_output'].includes(String(payload.type))){
    const notification=subagentNotificationEvent(payload.output,threadId);if(notification)return notification;
    const delegated=delegatedMessage(payload.output);
    if(delegated)return {type:'user.message',threadId,...delegated,userVisible:true};
    return {type:'tool.completed',threadId,itemId:readString(payload.call_id),status:'ok',detail:(readString(payload.output)||'').slice(-12000)};
  }
  if(readString(payload.type)==='reasoning') {
    const summary=Array.isArray(payload.summary)?payload.summary.map(item=>readString(readRecord(item)?.text)||'').join('\n'):'';
    return summary?{type:'reasoning.summary',threadId,text:summary}:null;
  }
  if (readString(payload.type) !== "message") {
    return null;
  }
  const role = readString(payload.role);
  if (role !== 'user' && role !== 'assistant') return null;
  if(readString(payload.channel)==='analysis' || readString(payload.phase)==='analysis')return null;
  const notification=role==='user'?subagentNotificationEvent(contentText(payload.content),threadId):undefined;
  if(notification)return notification;
  const delegated=role==='user'?delegatedMessage(contentText(payload.content)):undefined;
  if(delegated)return {type:'user.message',threadId,...delegated,userVisible:true};
  const reply=role==='user'?desktopQuestionReply(contentText(payload.content)):null;
  if(reply)return {type:'user.message',threadId,text:reply.text,questionReplyId:reply.callId,questionReplies:reply.replies,userVisible:true};
  const text = role === 'user' ? visibleUserContent(payload) : contentText(payload.content).trim();
  if (role === "user") {
    const embedded=visibleEmbeddedImages(payload);
    if(!text&&!embedded.length)return null;
    const request = splitDesktopAttachments(text);
    const pathImages=request.attachments?.filter(file=>/\.(png|jpe?g|webp|gif)$/i.test(file.path)).length??0;
    const remaining=embedded.slice(pathImages).map((image,index)=>({
      name:`图片 ${pathImages+index+1}`,path:`history-embedded-image:${pathImages+index}.${image.mime}`,
    }));
    const attachments=[...(request.attachments??[]),...remaining];
    return { type: "user.message", threadId, ...request,
      ...(attachments.length?{attachments}:{}),userVisible: true };
  }
  if (!text || isInjectedContext(text)) return null;
  if (role === "assistant") {
    return { type: "message.delta", threadId, text, textComplete:true };
  }
  return null;
}

export function historyToolPresentation(name:string,raw:string):{title:string;detail:string} {
  let command='';
  let patch='';
  const wrapper=/^(functions\.)?exec$/.test(name);
  if(/apply_patch/.test(name)&&raw.trimStart().startsWith('*** Begin Patch'))patch=raw;
  if(wrapper){
    const call=/tools\.apply_patch\(\s*("(?:\\.|[^"\\])*")\s*\)/s.exec(raw);
    if(call)try{patch=JSON.parse(call[1]);}catch{}
  }
  const imagePaths:string[]=[];
  const literal=(value:string):string=>value[0]==='"'?JSON.parse(value):value.slice(1,-1).replace(/\\'/g,"'").replace(/\\\\/g,'\\');
  try{const args=JSON.parse(raw);if(/view_image|imageview/i.test(name)&&typeof args.path==='string')imagePaths.push(args.path);}catch{}
  for(const match of raw.matchAll(/tools\.view_image\s*\(\s*\{\s*path\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)){
    try{imagePaths.push(literal(match[1]));}catch{}
  }
  try {
    const args=JSON.parse(raw);
    command=typeof args.cmd==='string'?args.cmd:typeof args.command==='string'?args.command:'';
    if(/apply_patch|edit_file|write_file/i.test(name)) {
      patch=[args.patch,args.input,args.content].find((value:unknown)=>typeof value==='string'&&value.includes('*** Begin Patch'))??patch;
    }
    if(wrapper&&typeof args.code==='string'){
      const call=/tools\.apply_patch\(\s*("(?:\\.|[^"\\])*")\s*\)/s.exec(args.code);
      if(call)patch=JSON.parse(call[1]);
    }
  }catch{}
  if(wrapper){
    const commands=[...raw.matchAll(/\bcmd\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)].flatMap(match=>{
      try{return [match[1][0]==='"'?JSON.parse(match[1]):match[1].slice(1,-1).replace(/\\'/g,"'").replace(/\\n/g,'\n')];}catch{return [];}
    });
    if(commands.length)command=commands.join('\n\n');
  }
  const title=command?(imagePaths.length?'运行命令 · 查看图片':'运行命令'):/view_image|imageview/i.test(name)||wrapper&&/tools\.view_image\s*\(/.test(raw)?'查看图片':
    /apply_patch|edit_file|write_file/i.test(name)||wrapper&&/tools\.apply_patch\s*\(/.test(raw)?'编辑文件':
    command?'运行命令':wrapper?'执行工具':name;
  const previews=[...new Set(imagePaths)].filter(p=>!/[<>\r\n]/.test(p)).map(p=>`![查看图片](<${p.replaceAll('\\','/')}>)`).join('\n');
  const visiblePatch=patch.length>200000?patch.slice(0,200000)+'\n…（补丁过长，仅显示前 20 万字符）':patch;
  return {title,detail:[visiblePatch||command.slice(0,12000)||(!previews?raw.slice(0,12000):''),previews].filter(Boolean).join('\n\n')};
}

export function desktopAsyncQuestionEvent(threadId:string,item:Record<string,unknown>|undefined):Extract<GatewayEvent,{type:'approval.requested'}>|undefined {
  if(!item)return;
  const name=readString(item.tool)||readString(item.name)||'';
  if(name.split(/[.:/]/).at(-1)!=='request_user_input_async')return;
  const callId=readString(item.call_id)||readString(item.callId)||readString(item.id);
  const input=item.arguments??item.input;
  const detail=desktopQuestionDetail(typeof input==='string'?input:JSON.stringify(input??{}));
  if(callId&&detail)return {type:'approval.requested',threadId,approvalId:`desktop-question:${callId}`,approvalType:'question',
    eventId:`desktop-question:${callId}`,title:'需要你的回答',detail};
}

function desktopQuestionDetail(input:string):string|null {
  try{
    const data=JSON.parse(input);
    if(!Array.isArray(data.questions)||data.questions.length<1||data.questions.length>3)return null;
    const questions=data.questions.map((item:unknown,index:number)=>{
      const row=readRecord(item);
      const title=readString(row?.title)||readString(row?.question);
      if(!title)return null;
      const options=Array.isArray(row?.options)?row.options.map((value:unknown)=>typeof value==='string'?{label:value}:readRecord(value)).filter(Boolean):[];
      return {id:String(index),question:title,options};
    });
    return questions.every(Boolean)?JSON.stringify({questions}):null;
  }catch{return null;}
}

export function formatDesktopQuestionReply(approvalId:string,detail:string,answers:Record<string,{answers:string[]}>):string {
  const callId=approvalId.slice('desktop-question:'.length);
  if(!approvalId.startsWith('desktop-question:')||!callId)throw new Error('无效的问题编号');
  const questions=JSON.parse(detail).questions as {id:string;question:string}[];
  if(!questions.length||Object.keys(answers).length!==questions.length||questions.some(item=>!answers[item.id]?.answers[0]?.trim()))throw new Error('请回答所有问题');
  const rows=questions.map(item=>({questionItemId:JSON.stringify(['request_user_input_async',callId,Number(item.id)]),question:item.question,answer:answers[item.id].answers[0].trim()}));
  return `<send_user_message_question_reply>\n${JSON.stringify(rows)}\n</send_user_message_question_reply>`;
}

function desktopQuestionReply(input:string):{callId:string;text:string;replies?:{question:string;answer:string}[]}|null {
  const match=/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/i.exec(input.trim());
  if(!match)return null;
  try{
    const rows=JSON.parse(match[1]);
    if(!Array.isArray(rows)||!rows.length)return null;
    const first=readRecord(rows[0]);
    const identity=JSON.parse(readString(first?.questionItemId)||'');
    const callId=Array.isArray(identity)&&identity[0]==='request_user_input_async'?readString(identity[1]):undefined;
    const answers=rows.map((row:unknown)=>readString(readRecord(row)?.answer)).filter((answer):answer is string=>!!answer);
    const replies=rows.map((value:unknown)=>{const row=readRecord(value);return {question:readString(row?.question)||'',answer:readString(row?.answer)||''};});
    return callId&&answers.length?{callId,text:answers.join('\n'),...(replies.every(row=>row.question.trim()&&row.answer.trim())?{replies}:{})}:null;
  }catch{return null;}
}

export function pendingDesktopQuestions(threadId:string,events:GatewayEvent[],storedEvents:GatewayEvent[]=[],resolvedApprovalIds:string[]=[]):PendingApproval[] {
  const resolved=new Set(resolvedApprovalIds);
  const open=new Map<string,Extract<GatewayEvent,{type:'approval.requested'}>>();
  for(const event of events){
    // A new turn supersedes old asynchronous prompts. Steering within a turn does not.
    if(event.type==='turn.started')open.clear();
    if(event.type==='approval.requested'&&event.approvalType==='question'&&event.approvalId?.startsWith('desktop-question:'))open.set(event.approvalId,event);
    if(event.type==='user.message'){
      if(event.questionReplyId)open.delete(`desktop-question:${event.questionReplyId}`);
    }
    if(event.type==='approval.resolved')open.delete(event.approvalId);
  }
  for(const event of storedEvents)if(event.type==='approval.resolved'&&!event.approvalId.startsWith('desktop-question:'))resolved.add(event.approvalId);
  return [...open.values()].filter(event=>!resolved.has(event.approvalId!))
    .map(event=>({id:event.approvalId!,rpcId:event.approvalId!,method:'desktop/request_user_input_async',threadId,approvalType:'question' as const,title:event.title,detail:event.detail,status:'pending' as const,createdAt:event.createdAt||new Date().toISOString()}));
}

export function splitDesktopAttachments(text: string): {text:string;attachments?:{name:string;path:string}[]} {
  const wrapper=/^# Files mentioned by the user:\s*\n([\s\S]*?)\n## My request(?: for Codex)?:[ \t]*(?:\r?\n)?([\s\S]*)$/i.exec(text.trim());
  const attachments=wrapper?[...wrapper[1].matchAll(/^## (.+?): ([^\r\n]+)$/gm)].map(match=>({name:match[1],path:match[2]})):[];
  let message=wrapper?wrapper[2]:text;
  message=message.replace(/<image\s+name=(?:\[([^\]\r\n]+)\]|"([^"\r\n]+)")\s+path="([^"\r\n]+)"\s*>\s*(?:<\/image>)?/gi,(_whole,_bracket:string,_quoted:string,file:string)=>{
    attachments.push({name:_bracket||_quoted||path.basename(file),path:file});
    return '';
  }).trim();
  message=stripAmbientBrowserContext(message);
  const seen=new Set<string>();
  const unique=attachments.filter(file=>{const key=file.path.replace(/\\/g,'/').toLowerCase();if(seen.has(key))return false;seen.add(key);return true});
  return unique.length?{text:message,attachments:unique}:{text:message};
}

function stripAmbientBrowserContext(input:string):string {
  let removed=false;
  let text=input.replace(/<in-app-browser-context source="ambient-ui-state">([\s\S]*?)<\/in-app-browser-context>\s*/gi,(whole,body:string)=>{
    if(!body.includes('This block is automatically supplied ambient UI state'))return whole;
    removed=true;return '';
  }).trim();
  if(removed)text=text.replace(/^## My request(?: for Codex)?:\s*/i,'');
  return text.trim();
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      const record = readRecord(item);
      return readString(record?.text) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function isInjectedContext(text: string): boolean {
  return text.includes("<codex_internal_context") ||
    text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("<permissions instructions>") ||
    text.startsWith("<app-context>") ||
    text.startsWith("<collaboration_mode>") ||
    text.startsWith("<skills_instructions>") ||
    text.startsWith("<plugins_instructions>");
}

function isInternalContentKind(kind: string): boolean {
  return kind.endsWith('.instructions') || kind === 'plugins.recommendations' ||
    kind === 'environments.environment_context' || kind === 'additional_content.codex_apps_open_page';
}

export function visibleUserContent(payload: Record<string, unknown>): string {
  const content = Array.isArray(payload.content) ? payload.content : [];
  const metadata = readRecord(payload.internal_chat_message_metadata_passthrough);
  const kinds = Array.isArray(metadata?.content_item_kinds) ? metadata.content_item_kinds : [];
  // Desktop labels each content item, including user-role instruction/context
  // items. Use that provenance before inspecting text that a user may quote.
  if (kinds.length === content.length && kinds.every(kind => typeof kind === 'string')) {
    return content.map((item, index) => {
      const kind = kinds[index] as string;
      const text = readString(readRecord(item)?.text) ?? '';
      if (isInternalContentKind(kind)) return '';
      return kind.startsWith('user.') ? visibleDesktopUserText(text) : visibleLegacyUserText(text);
    }).filter(Boolean).join('\n').trim();
  }
  if (kinds.length && kinds.every(kind => typeof kind === 'string' && isInternalContentKind(kind))) return '';
  return visibleLegacyUserText(contentText(content));
}

function visibleEmbeddedImages(payload:Record<string,unknown>):Array<{url:string;mime:string}> {
  const content=Array.isArray(payload.content)?payload.content:[];
  const metadata=readRecord(payload.internal_chat_message_metadata_passthrough);
  const kinds=Array.isArray(metadata?.content_item_kinds)?metadata.content_item_kinds:[];
  if(kinds.length&&(kinds.length!==content.length||!kinds.every(kind=>typeof kind==='string')))return [];
  return content.flatMap((item,index)=>{
    const part=readRecord(item);
    if(readString(part?.type)!=='input_image'||kinds.length&&!(kinds[index] as string).startsWith('user.'))return [];
    const url=readString(part?.image_url);
    const mime=url&&/^data:image\/(png|jpeg|webp|gif);base64,/.exec(url)?.[1];
    return url&&mime?[{url,mime}]:[];
  });
}

function visibleDesktopUserText(input: string): string {
  const text = input.trim().replace(/^<cmc-session-instructions>\s*[\s\S]*?<\/cmc-session-instructions>\s*/i,'');
  // Desktop records an interruption notice as a user-role item. It is a
  // control marker, not a message composed by the user.
  if (/^<turn_aborted>\s*The user interrupted the previous turn on purpose\.[\s\S]*?<\/turn_aborted>\s*$/i.test(text)) return '';
  return text;
}

function visibleLegacyUserText(input: string): string {
  let text = visibleDesktopUserText(input);
  const pageEvent=/^<external_codex_apps_open_page>\s*([\s\S]*?)\s*<\/external_codex_apps_open_page>\s*$/i.exec(text);
  if(pageEvent){
    try{
      const page=readRecord(JSON.parse(pageEvent[1]));
      if(page&&Object.keys(page).length===1&&'page_id' in page&&(page.page_id===null||typeof page.page_id==='string'))return '';
    }catch{}
  }
  let removed = false;
  // Older rollouts have no content provenance. Remove complete, known context
  // wrappers from the prefix while retaining a real request that follows them.
  const tags = ['recommended_plugins','environment_context','codex_internal_context',
    'app-context','collaboration_mode','skills_instructions','plugins_instructions',
    'in-app-browser-context','multi_agent_role','multi_agent_mode'];
  for (;;) {
    const agents = /^# AGENTS\.md instructions[^\n]*\r?\n\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/i.exec(text);
    const context = new RegExp('^<(' + tags.join('|') + ')(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>\\s*', 'i').exec(text);
    const permissions = /^<permissions instructions>[\s\S]*?<\/permissions instructions>\s*/i.exec(text);
    const match = agents ?? context ?? permissions;
    if (!match) break;
    removed = true;
    text = text.slice(match[0].length).trimStart();
  }
  if (removed) text = text.replace(/^## My request:\s*/i, '');
  if (isInjectedContext(text) || /^<recommended_plugins\b/i.test(text)) return '';
  return text.trim();
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
