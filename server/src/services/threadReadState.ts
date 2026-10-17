import fs from 'node:fs/promises';
import {watch} from 'node:fs';
import path from 'node:path';
import {codexHome} from './paths.js';
import {readCodexThreadCompletion} from './codexSessions.js';
import type {StateStore} from './stateStore.js';
import type {ThreadRecord} from '../types.js';

export function desktopUnreadThreads(state:Record<string,unknown>):Set<string> {
  const read=state['electron-thread-read-state-v1'] as {version?:number;unreadByIdentity?:Record<string,Record<string,unknown>>}|undefined;
  if(read){
    if(read.version!==1||!read.unreadByIdentity)return new Set();
    const identities=Object.values(read.unreadByIdentity);
    // Account and host keys are opaque. Only an unambiguous local scope is usable.
    if(identities.length!==1)return new Set();
    const local=Object.entries(identities[0]).filter(([host])=>host.startsWith('local:'));
    return local.length===1?stringSet(local[0][1]):new Set();
  }
  const legacy=state['unread-thread-ids-by-host-v1'] as Record<string,unknown>|undefined;
  return stringSet(legacy?.local);
}
function stringSet(value:unknown):Set<string>{return new Set(Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[]);}

// Watch the directory because Desktop replaces this file during atomic saves.
// Only read-state changes invalidate the sidebar; other desktop settings do not.
export function watchDesktopReadState(changed:()=>void,home=codexHome()):()=>void {
  const name='.codex-global-state.json';
  let revision:string|undefined;
  let closed=false;
  let timer:NodeJS.Timeout|undefined;
  let reading=false;
  let pending=false;
  const read=async()=>{
    if(closed)return;
    if(reading){pending=true;return;}
    reading=true;
    try{
      const state=JSON.parse(await fs.readFile(path.join(home,name),'utf8'));
      const next=JSON.stringify([...desktopUnreadThreads(state)].sort());
      const previous=revision;revision=next;
      if(previous!==undefined&&previous!==next&&!closed)changed();
    }catch{/* An incomplete save cannot be interpreted as marking everything read. */}
    finally{reading=false;if(pending){pending=false;schedule();}}
  };
  const schedule=()=>{
    if(closed)return;
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=undefined;void read();},300);timer.unref();
  };
  let watcher:ReturnType<typeof watch>|undefined;
  try{
    watcher=watch(home,{persistent:false},(_event,file)=>{if(!file||file.toString()===name)schedule();});
    watcher.on('error',()=>{watcher?.close();watcher=undefined;});
  }catch{/* Polling also covers a missing home or an unavailable file watcher. */}
  const fallback=setInterval(()=>{void read();},5000);fallback.unref();
  void read();
  return ()=>{closed=true;watcher?.close();clearInterval(fallback);if(timer)clearTimeout(timer);};
}

export async function withThreadReadState(threads:ThreadRecord[],store:StateStore):Promise<ThreadRecord[]> {
  const state=await fs.readFile(path.join(codexHome(),'.codex-global-state.json'),'utf8').then(text=>JSON.parse(text)).catch(()=>({}));
  const unread=desktopUnreadThreads(state);
  return Promise.all(threads.map(async thread=>{
    const manual=store.manualUnread(thread.id);
    if(manual!==undefined)return {...thread,unread:true,completedAt:manual};
    if(thread.readOnly||thread.source==='cloudCodex'||!unread.has(thread.id))return {...thread,unread:false};
    const completedAt=await readCodexThreadCompletion(thread.id).catch(()=>0);
    return {...thread,completedAt,unread:completedAt>store.threadReadThrough(thread.id)&&completedAt>0};
  }));
}
