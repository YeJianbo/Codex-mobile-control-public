import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {codexHome} from './paths.js';
export async function desktopSidebar() {
  let state:any={};
  try{state=JSON.parse(await fs.readFile(path.join(codexHome(),'.codex-global-state.json'),'utf8'))}catch{}
  const atoms=state['electron-persisted-atom-state']||{};
  const pinned:string[]=atoms['app-server-pinned-thread-order-v1'] ?? state['pinned-thread-ids'] ?? [];
  const order:string[]=(state['project-order'] ?? atoms['unified-sidebar-project-order-v1'] ?? []).map((x:string)=>x.replace(/^codex:project:/,''));
  let threads:any[]=[],projects:any[]=[],archived:string[]=[],threadsLoaded=false;
  let db:DatabaseSync|undefined;
  try {
    const file=path.join(codexHome(),'state_5.sqlite');await fs.access(file);
    db=new DatabaseSync(file,{readOnly:true});
    threads=db.prepare('SELECT id,cwd,name,title,recency_at_ms,updated_at_ms,created_at_ms,is_pinned,section_position FROM threads WHERE archived=0 ORDER BY COALESCE(recency_at_ms,updated_at_ms) DESC').all();
    archived=db.prepare('SELECT id FROM threads WHERE archived=1').all().map((row:any)=>row.id);
    threadsLoaded=true;
    projects=db.prepare('SELECT p.id,p.name,p.position,r.path FROM projects p JOIN project_roots r ON p.id=r.project_id ORDER BY p.position,r.position').all();
  } catch {} finally {db?.close()}
  const local=Object.values(state['local-projects']||{}) as any[];
  if(!projects.length)projects=local.flatMap(p=>(p.rootPaths||[]).map((root:string)=>({id:p.id,name:p.name,path:root})));
  const roots=order.flatMap(id=>(state['local-projects']?.[id]?.rootPaths||[]).map((root:string)=>root.replace(/\\/g,'/').toLowerCase()));
  const rank=(project:any)=>{const index=roots.indexOf(project.path.replace(/\\/g,'/').toLowerCase());return index>=0?index:order.indexOf(project.id)>=0?order.indexOf(project.id):1e6};
  projects.sort((a,b)=>rank(a)-rank(b));
  return {pinned,threads,projects,archived,threadsLoaded};
}
