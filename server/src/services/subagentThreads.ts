import type {ThreadRecord} from '../types.js';

// Extract display metadata only; the source can also contain internal prompts.
export function subagentMetadata(row:Record<string,unknown>):ThreadRecord['subagent'] {
  let source:unknown=row.source;
  if(typeof source==='string')try{source=JSON.parse(source);}catch{}
  const agent=source&&typeof source==='object'?((source as any).subagent??(source as any).subAgent):undefined;
  const spawn=agent&&typeof agent==='object'?agent.thread_spawn??agent.threadSpawn:undefined;
  if(!agent&&row.thread_source!=='subagent'&&source!=='subagent')return undefined;
  const clean=(value:unknown,max=128)=>typeof value==='string'?value.replace(/[\x00-\x1f]/g,'').trim().slice(0,max):undefined;
  const parent=clean(spawn?.parent_thread_id??spawn?.parentThreadId,256);
  const task=clean(row.agent_path??row.agentPath??spawn?.agent_path??spawn?.agentPath)?.split('/').filter(Boolean).at(-1);
  return {
    ...(parent?{parentThreadId:parent}:{}),
    nickname:clean(row.agent_nickname??row.agentNickname??spawn?.agent_nickname??spawn?.agentNickname),
    role:clean(row.agent_role??row.agentRole??spawn?.agent_role??spawn?.agentRole,64),
    task,
  };
}

// Page main conversations, then retain their entire agent tree. Agents should
// neither displace their parent from a page nor disappear on a selected retry.
function familyRoot(row:ThreadRecord,byId:Map<string,ThreadRecord>):string {
  const seen=new Set<string>();
  while(row.subagent?.parentThreadId&&byId.has(row.subagent.parentThreadId)){
    if(seen.has(row.id))return [...seen].sort()[0];
    seen.add(row.id);row=byId.get(row.subagent.parentThreadId)!;
  }
  return row.id;
}
export function subagentThreadScope(rows:ThreadRecord[],matches:(row:ThreadRecord)=>boolean){
  const byId=new Map(rows.map(row=>[row.id,row]));
  const selected=new Set(rows.filter(matches).map(row=>familyRoot(row,byId)));
  return rows.filter(row=>selected.has(familyRoot(row,byId)));
}
export function subagentSidebarPage(rows:ThreadRecord[],limit:number|undefined,keep:(row:ThreadRecord)=>boolean){
  if(limit===undefined)return {rows,hasMore:false};
  const byId=new Map(rows.map(row=>[row.id,row]));
  const root=(row:ThreadRecord)=>familyRoot(row,byId);
  const families=new Map<string,ThreadRecord[]>();
  for(const row of rows){const id=root(row);const family=families.get(id)??[];family.push(row);families.set(id,family);}
  const selected=new Set([...families].filter(([,family])=>family.some(keep)).map(([id])=>id));
  const ordinary=[...families.keys()].filter(id=>!selected.has(id));
  for(const id of ordinary.slice(0,limit))selected.add(id);
  return {rows:rows.filter(row=>selected.has(root(row))),hasMore:ordinary.length>limit};
}
