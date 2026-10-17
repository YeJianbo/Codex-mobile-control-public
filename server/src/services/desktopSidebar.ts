import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {codexHome} from './paths.js';
import {subagentMetadata} from './subagentThreads.js';
import type {ThreadRecord} from '../types.js';
export function desktopArchivedThreads():ThreadRecord[]{
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(path.join(codexHome(),'state_5.sqlite'),{readOnly:true});
    return (db.prepare('SELECT * FROM threads WHERE archived=1 ORDER BY updated_at_ms DESC').all() as Record<string,any>[]).map(row=>({
      id:row.id,title:row.name||row.title||'未命名会话',projectPath:row.cwd,status:'idle',subagent:subagentMetadata(row),
      createdAt:new Date(Number(row.created_at_ms)||0).toISOString(),updatedAt:new Date(Number(row.updated_at_ms)||0).toISOString(),
    }));
  }catch{return [];}finally{db?.close();}
}
export function desktopThreadSections():{id:string;name:string}[]{
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(path.join(codexHome(),'state_5.sqlite'),{readOnly:true});
    return db.prepare('SELECT id,name FROM thread_sections ORDER BY name').all() as {id:string;name:string}[];
  }finally{db?.close();}
}
export const PINNED_SECTION_ID='01984de2-8f74-7c91-a3b2-5c5e937cf318';
export async function desktopPinnedThreads():Promise<string[]> {
  const file=path.join(codexHome(),'state_5.sqlite');
  if(await fs.access(file).then(()=>true,()=>false)){
    const db=new DatabaseSync(file,{readOnly:true});
    try{
      if((db.prepare('PRAGMA table_info(threads)').all() as {name:string}[]).some(column=>column.name==='thread_section_id')){
        return (db.prepare('SELECT id FROM threads WHERE archived=0 AND thread_section_id=? ORDER BY section_position IS NULL,section_position').all(PINNED_SECTION_ID) as {id:string}[]).map(row=>row.id);
      }
    }finally{db.close();}
  }
  return (await desktopSidebar()).pinned;
}
export function desktopThreadIsSubagent(id:string):boolean {
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(path.join(codexHome(),'state_5.sqlite'),{readOnly:true});
    const row=db.prepare('SELECT source FROM threads WHERE id=?').get(id) as Record<string,unknown>|undefined;
    return Boolean(row&&subagentMetadata(row));
  }catch{return false;}finally{db?.close();}
}
export function desktopThreadSettings(id:string) {
  let db:DatabaseSync|undefined;
  try {
    db=new DatabaseSync(path.join(codexHome(),'state_5.sqlite'),{readOnly:true});
    const row=db.prepare('SELECT model,reasoning_effort FROM threads WHERE id=?').get(id) as {model?:string;reasoning_effort?:string}|undefined;
    return row?.model?{model:row.model,effort:row.reasoning_effort||''}:null;
  }catch{return null;}finally{db?.close();}
}
type DesktopSidebarSnapshot={pinned:string[];threads:any[];projects:any[];archived:string[];threadsLoaded:boolean;pinsAuthoritative:boolean};
const sidebarReads=new Map<string,Promise<DesktopSidebarSnapshot>>();
export function desktopSidebar():Promise<DesktopSidebarSnapshot> {
  const home=codexHome();
  const pending=sidebarReads.get(home);
  if(pending)return pending;
  // Share only work in flight; the next refresh still reads current desktop state.
  const reading=readDesktopSidebar(home).finally(()=>{sidebarReads.delete(home);});
  sidebarReads.set(home,reading);
  return reading;
}
async function readDesktopSidebar(home:string):Promise<DesktopSidebarSnapshot> {
  let state:any={};
  try{state=JSON.parse(await fs.readFile(path.join(home,'.codex-global-state.json'),'utf8'))}catch{}
  const atoms=state['electron-persisted-atom-state']||{};
  let pinned:string[]=atoms['app-server-pinned-thread-order-v1'] ?? state['pinned-thread-ids'] ?? [];
  const order:string[]=(state['project-order'] ?? atoms['unified-sidebar-project-order-v1'] ?? []).map((x:string)=>x.replace(/^codex:project:/,''));
  let threads:any[]=[],projects:any[]=[],archived:string[]=[],threadsLoaded=false,pinsAuthoritative=false;
  let db:DatabaseSync|undefined;
  try {
    const file=path.join(home,'state_5.sqlite');await fs.access(file);
    db=new DatabaseSync(file,{readOnly:true});
    const columns=new Set((db.prepare('PRAGMA table_info(threads)').all() as {name:string}[]).map(column=>column.name));
    const metadata=['source','thread_source','agent_nickname','agent_role','agent_path','thread_section_id','has_user_event','first_user_message','tokens_used'].filter(column=>columns.has(column));
    threads=db.prepare(`SELECT id,cwd,name,title,recency_at_ms,updated_at_ms,created_at_ms,is_pinned,section_position${metadata.length?','+metadata.join(','):''} FROM threads WHERE archived=0 ORDER BY COALESCE(recency_at_ms,updated_at_ms) DESC`).all();
    archived=db.prepare('SELECT id FROM threads WHERE archived=1').all().map((row:any)=>row.id);
    threadsLoaded=true;
    if(columns.has('thread_section_id')){
      // Section moves are persisted in SQLite; legacy desktop JSON can lag forever.
      pinned=threads.filter(row=>row.thread_section_id===PINNED_SECTION_ID).sort((a,b)=>(a.section_position??Number.MAX_SAFE_INTEGER)-(b.section_position??Number.MAX_SAFE_INTEGER)).map(row=>row.id);
      pinsAuthoritative=true;
    }
    projects=db.prepare('SELECT p.id,p.name,p.position,r.path FROM projects p JOIN project_roots r ON p.id=r.project_id ORDER BY p.position,r.position').all();
  } catch {} finally {db?.close()}
  const local=Object.values(state['local-projects']||{}) as any[];
  if(!projects.length)projects=local.flatMap(p=>(p.rootPaths||[]).map((root:string)=>({id:p.id,name:p.name,path:root})));
  const roots=order.flatMap(id=>(state['local-projects']?.[id]?.rootPaths||[]).map((root:string)=>root.replace(/\\/g,'/').toLowerCase()));
  const rank=(project:any)=>{const index=roots.indexOf(project.path.replace(/\\/g,'/').toLowerCase());return index>=0?index:order.indexOf(project.id)>=0?order.indexOf(project.id):1e6};
  projects.sort((a,b)=>rank(a)-rank(b));
  return {pinned,threads,projects,archived,threadsLoaded,pinsAuthoritative};
}
