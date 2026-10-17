export function sidebarThreadRoots(threads,query='') {
  return threads.filter(thread=>!thread.subagent && `${thread.title} ${thread.projectPath||''} ${thread.goal?.objective||''}`.toLowerCase().includes(query.trim().toLowerCase()));
}
export function subagentLabel(thread){
  const agent=thread.subagent;
  return agent?`子代理 · ${agent.nickname||agent.role||agent.task||'未命名'}`:thread.title;
}
export function subagentRunning(thread){return ['running','starting'].includes(thread.status)||thread.goal?.status==='active';}
export function conversationRunningAgents(threads,threadId){
  const children=new Map();
  for(const thread of threads)if(thread.subagent){const siblings=children.get(thread.subagent.parentThreadId)||[];siblings.push(thread);children.set(thread.subagent.parentThreadId,siblings);}
  const descendants=new Set([threadId]),pending=[threadId];
  while(pending.length)for(const child of children.get(pending.pop())||[])if(!descendants.has(child.id)){descendants.add(child.id);pending.push(child.id);}
  descendants.delete(threadId);
  const seen=new Set();
  return threads.filter(thread=>{if(seen.has(thread.id))return false;seen.add(thread.id);return descendants.has(thread.id)&&subagentRunning(thread);});
}
export function sidebarInactiveAgents(threads,query=''){
  const parents=new Map(threads.map(thread=>[thread.id,thread])),seen=new Set(),search=query.trim().toLowerCase();
  return threads.filter(thread=>{
    if(seen.has(thread.id))return false;seen.add(thread.id);
    return thread.subagent&&!subagentRunning(thread)&&`${subagentLabel(thread)} ${thread.subagent.role||''} ${thread.subagent.task||''} ${thread.title||''} ${thread.projectPath||''} ${parents.get(thread.subagent.parentThreadId)?.title||''}`.toLowerCase().includes(search);
  });
}
export function conversationParent(threads,threadId){
  const current=threads.find(thread=>thread.id===threadId),id=current?.subagent?.parentThreadId;
  if(!id||id===threadId)return null;
  return threads.find(thread=>thread.id===id)||{id,title:'上级会话',projectPath:current.projectPath};
}
export function conversationLineage(threads,threadId){
  const rows=new Map(threads.map(thread=>[thread.id,thread])),seen=new Set(),result=[];
  for(let row=rows.get(threadId);row&&!seen.has(row.id);row=rows.get(row.subagent?.parentThreadId)){seen.add(row.id);result.push(row);}
  return result;
}
export function threadFamilyRunning(thread,children){
  const pending=[thread],seen=new Set();
  while(pending.length){const row=pending.pop();if(seen.has(row.id))continue;seen.add(row.id);if(row.status==='running')return true;pending.push(...(children.get(row.id)||[]));}
  return false;
}
