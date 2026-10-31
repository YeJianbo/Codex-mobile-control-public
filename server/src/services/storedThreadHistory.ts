import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {isMainThread} from 'node:worker_threads';
import type {GatewayEvent} from '../types.js';
import {appHome} from './paths.js';
import {ParsedEventHistory} from './parsedEventHistory.js';
import {historyWorkerCall} from './historyWorkers.js';
import {deferMobileActivityDetails,deferLiveActivityDetails,isVisibleMobileThreadEvent} from './mobileActivityDetails.js';
import {confirmedToolChanges} from './fileChanges.js';

let reader:{file:string;db:DatabaseSync;history:ParsedEventHistory;prefixes:Map<string,number>}|undefined;

/** Full disk windows are read and parsed only on the existing history workers. */
export async function readStoredThreadEvents(threadId:string,deferred:boolean|'live'=false,signal?:AbortSignal):Promise<GatewayEvent[]>{
  if(isMainThread)return historyWorkerCall('readStoredThreadEvents',[threadId,deferred],'interactive',signal);
  const file=path.join(appHome(),'state.sqlite');
  if(reader?.file!==file){
    reader?.db.close();
    const db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA busy_timeout=1000');
    reader={file,db,history:new ParsedEventHistory(db),prefixes:new Map()};
  }
  const {db,history,prefixes}=reader;
  const table=/^(antigravity|claude|grok|deepseek|hermes|opencode|zcode|pi|acp)-/.test(threadId)?'agent_history':'codex_live_events';
  const prefix=(db.prepare(`SELECT seq FROM ${table} WHERE thread_id=? ORDER BY seq LIMIT 1`).get(threadId) as {seq:number}|undefined)?.seq??0;
  if(prefixes.get(threadId)!==prefix)history.invalidate(table,threadId);
  else history.markDirty(table,threadId);
  prefixes.delete(threadId);prefixes.set(threadId,prefix);
  if(prefixes.size>128)prefixes.delete(prefixes.keys().next().value!);
  const events=history.read(table,threadId);
  return deferred?confirmedToolChanges(events.filter(isVisibleMobileThreadEvent)).map(event=>(deferred==='live'?deferLiveActivityDetails(event):deferMobileActivityDetails(event)) as GatewayEvent):events;
}
