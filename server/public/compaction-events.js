export function canonicalCompactionText(text='') {
  return text.replace(/<oai-mem-citation>[\s\S]*?(?:<\/oai-mem-citation>|$)/g,'').replace(/\r\n/g,'\n').trim();
}

const realItem=event=>event.itemId&&!event.itemId.startsWith('history:')?event.itemId:null;
export function sameCompaction(left,right) {
  if(left.type!=='context.compaction'||right.type!==left.type||left.threadId!==right.threadId)return false;
  if(left.turnId&&right.turnId&&left.turnId!==right.turnId)return false;
  if(left.eventId&&left.eventId===right.eventId)return true;
  const a=realItem(left),b=realItem(right);
  return a&&b?a===b:Boolean(left.createdAt)&&left.createdAt===right.createdAt;
}

// Transcript markers have no real item ID. Only a unique lifecycle or complete
// summary can identify their live counterpart; nearby timestamps are not enough.
export function identifyCompactionMarkers(incoming,previous=[]) {
  const markers=incoming.map((event,index)=>({event,index})).filter(({event})=>
    event.type==='context.compaction'&&event.eventId?.startsWith('history:')&&!realItem(event)&&event.status!=='running');
  if(!markers.length)return incoming;
  const all=[...previous,...incoming],groups=new Map(),boundaries=new Map();
  for(const event of all){
    if(event.type==='context.compaction'&&realItem(event)){
      const key=JSON.stringify([event.threadId,realItem(event)]),rows=groups.get(key)||[];
      rows.push(event);groups.set(key,rows);
    }
    if(['turn.started','turn.completed'].includes(event.type)||event.type==='context.compaction'&&event.status==='running'){
      const rows=boundaries.get(event.threadId)||[];rows.push(event);boundaries.set(event.threadId,rows);
    }
  }
  if(!groups.size)return incoming;
  const matches=new Map(),counts=new Map(),windows=new Map(),summaries=new Map();
  const summary=event=>{if(!summaries.has(event))summaries.set(event,canonicalCompactionText(event.text));return summaries.get(event);};
  for(const {event,index} of markers){
    const at=Date.parse(event.createdAt);if(!Number.isFinite(at))continue;
    const candidates=[];
    for(const [key,rows] of groups){
      if(rows[0].threadId!==event.threadId||event.turnId&&rows.some(row=>row.turnId&&row.turnId!==event.turnId))continue;
      const sameWindow=row=>{
        const done=Date.parse(row.createdAt);if(!Number.isFinite(done))return false;
        return !(boundaries.get(event.threadId)||[]).some(boundary=>{
          if(boundary.type==='context.compaction'&&realItem(boundary)===realItem(row))return false;
          const time=Date.parse(boundary.createdAt);
          return time>Math.min(at,done)&&time<=Math.max(at,done);
        });
      };
      let match=rows.some(row=>sameCompaction(row,event))||Boolean(summary(event))&&rows.some(row=>row.status!=='running'&&summary(row)===summary(event)&&sameWindow(row));
      if(!match){
        if(!windows.has(key)){
          const times=rows.filter(row=>row.status==='running').map(row=>Date.parse(row.createdAt)).filter(Number.isFinite);
          const start=times.length?Math.min(...times):null;
          const finishes=rows.filter(row=>row.status!=='running').map(row=>Date.parse(row.createdAt)).filter(Number.isFinite);
          const ends=(boundaries.get(event.threadId)||[]).filter(row=>row.type!=='context.compaction'||realItem(row)!==realItem(rows[0])).map(row=>Date.parse(row.createdAt)).filter(at=>Number.isFinite(at)&&start!==null&&at>start);
          windows.set(key,{start,finish:finishes.length?Math.max(...finishes):null,end:ends.length?Math.min(...ends):null});
        }
        const {start,finish,end}=windows.get(key);
        match=start!==null&&at>=start&&(finish===null||at<=finish)&&(end===null||at<end);
      }
      if(match)candidates.push(key);
    }
    if(candidates.length===1){const key=candidates[0];matches.set(index,key);counts.set(key,(counts.get(key)||0)+1);}
  }
  return incoming.map((event,index)=>{
    const key=matches.get(index);if(!key||counts.get(key)!==1)return event;
    const rows=groups.get(key),prior=rows[0];
    const pending=!event.text?.trim()&&!event.detail?.trim()&&rows.some(row=>row.status==='running')&&
      !rows.some(row=>!row.eventId?.startsWith('history:')&&row.status!=='running');
    return {...event,itemId:realItem(prior),turnId:event.turnId||rows.findLast(row=>row.turnId)?.turnId,
      status:pending?'running':event.status};
  });
}

export function reconcileCompactionRecords(events) {
  const identified=identifyCompactionMarkers(events),result=[];
  for(const event of identified){
    const index=event.type==='context.compaction'?result.findLastIndex(prior=>sameCompaction(prior,event)):-1;
    if(index<0){result.push(event);continue;}
    const prior=result[index];
    if(prior.status==='running'||event.status!=='running')result[index]={...event,
      eventId:prior.eventId,itemId:realItem(event)||prior.itemId,turnId:event.turnId||prior.turnId,
      text:event.text||prior.text,detail:event.detail||prior.detail};
  }
  return result;
}
