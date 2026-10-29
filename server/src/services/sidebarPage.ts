import {z} from 'zod';

/** Each native index follows its own filter, including explicitly retained threads. */
export function nativeSidebarAgents(agent?:string,retained:Iterable<string>=[]):('deepseek'|'zcode')[]{
  const ids=[...retained];
  return (['deepseek','zcode'] as const).filter(native=>!agent||agent===native||ids.some(id=>id.startsWith(native+'-')));
}

export const sidebarPageQuery=z.object({
  limit:z.coerce.number().int().min(1).max(20000).optional(),
  agent:z.enum(['codex','claude','antigravity','grok','deepseek','hermes','opencode','zcode']).optional(),
  project:z.string().max(4096).optional(),
  filter:z.enum(['all','running','unread']).optional(),
  threadId:z.string().max(256).optional(),
  include:z.string().max(4096).optional(),
  delta:z.enum(['1']).optional(),
  since:z.string().max(64).optional(),
  keep:z.string().max(8192).optional(),
});

// Refresh a stable-sized prefix instead of offset paging a list whose recency
// changes while a turn runs. Selected/pinned entries do not consume the page.
export function sidebarPage<T>(rows:T[],limit:number|undefined,keep:(row:T)=>boolean=()=>false){
  if(limit===undefined)return {rows,hasMore:false};
  const ordinary=rows.filter(row=>!keep(row));
  const visible=new Set(ordinary.slice(0,limit));
  return {rows:rows.filter(row=>keep(row)||visible.has(row)),hasMore:ordinary.length>limit};
}
