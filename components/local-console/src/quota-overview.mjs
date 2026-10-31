// Read account metadata and existing quota samples. Opening the overview never
// switches a login or starts a model request; refresh is an explicit operation.
import {agyQuotaEstimates} from './agy-quota-estimate.mjs';
export const QUOTA_SOURCES={codex:'Codex',agy:'Antigravity',claude:'Claude Code',zcode:'ZCode',grok:'Grok',deepseek:'DeepSeek',hermes:'Hermes',opencode:'OpenCode'};
const text=value=>typeof value==='string'?value.slice(0,300):null;
const percent=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null;
const iso=value=>{
  if(value==null||value==='')return null;
  const time=typeof value==='number'?(value<1e12?value*1000:value):Date.parse(value);
  return Number.isFinite(time)?new Date(time).toISOString():null;
};
export function quotaWindow(value,label){
  if(!value||typeof value!=='object')return null;
  const used=percent(value.usedPercent??value.used_percent),remaining=percent(value.remainingPercent)??(used===null?null:100-used);
  if(remaining===null)return null;
  return {name:text(value.name)||label||text(value.window)||'额度',remainingPercent:remaining,resetsAt:iso(value.resetsAt??value.reset_at??value.resets_at)};
}
const windows=values=>values.flatMap(([value,label])=>{const row=quotaWindow(value,label);return row?[row]:[];});
export function agyOverviewWindows(values){
  const seen=new Set();
  return values.flatMap(value=>{
    const row=quotaWindow(value);if(!row)return [];
    // Only provider-issued pool IDs establish shared quota; matching balances
    // and reset times alone do not establish a relationship between models.
    if(!value.poolId)return [row];
    const key=JSON.stringify([value.poolId,value.window,row.remainingPercent,row.resetsAt]);
    if(seen.has(key))return [];seen.add(key);
    const group=(text(value.group)||row.name).replace(/\s+models$/i,'').replace(/\s+and\s+/gi,' / ');
    const window=value.window==='weekly'?'7d':text(value.window);
    return [{...row,name:window?`${group} · ${window}`:group,poolId:text(value.poolId),window:text(value.window),description:text(value.description)}];
  });
}
const account=(row,extra={})=>({id:text(row.id),label:text(row.alias)||text(row.email)||text(row.identity)||text(row.name)||'当前账号',
  active:row.active===true,plan:text(row.plan),configured:row.configured!==false,updatedAt:null,windows:[],...extra});
function latestSamples(points,id){
  const own=points.filter(point=>point.accountId===id).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  return {latest:own.at(-1),success:own.findLast(point=>point.status!=='unavailable'&&point.windows?.length)};
}
export class QuotaOverview{
  constructor({store,usage,agy,claude,refreshAgy,agyUsage,now=()=>Date.now()}){
    Object.assign(this,{store,usage,agy,claude,agyUsage,now});this.jobs=new Map();this.snapshots=new Map();
    this.refreshers={codex:()=>usage.refresh(),agy:refreshAgy,claude:()=>claude.refresh('current').then(value=>{if(value.sample?.status!=='ok')throw Error(value.message||'Claude 额度读取失败');})};
  }
  catalog(){
    return {sources:Object.entries(QUOTA_SOURCES).map(([source,label])=>({source,label,supported:!!this.refreshers[source],refreshable:!!this.refreshers[source]}))};
  }
  async accounts(source){
    if(source==='codex'){
      const state=this.store.accounts(),live=state.liveUsage,savedCredits=this.usage.creditSnapshots?.();
      const items=[...state.items];
      if(state.hasLogin&&!items.some(row=>row.active))items.unshift({id:'current',email:state.email,active:true});
      return items.map(row=>{
        const current=row.active&&live?live:null;
        return account(row,{configured:row.active?state.hasLogin:true,plan:text(current?.plan)||text(row.plan),updatedAt:iso(current?.at||row.updatedAt),
          stale:row.active&&!!this.usage.lastError,reason:row.active?text(this.usage.lastError):null,
          credits:current?current.credits??null:savedCredits?.get(row.id)?.credits??null,
          creditsUpdatedAt:current?.at||iso(savedCredits?.get(row.id)?.at),subscriptionEstimate:current?.subscriptionEstimate??null,
          windows:windows([[current?current.primary:row.primary,'5h'],[current?current.secondary:row.secondary,'7d']])});
      });
    }
    if(source==='agy'){
      const state=await this.agy.list(),points=this.agy.history({days:90}).points,items=[...state.items];
      if(state.current.configured&&!items.some(row=>row.active))items.unshift({id:state.current.quotaAccountId||'current',email:state.current.email,active:true});
      // Older AGY samples without an imported owner remain explicitly unassigned.
      // They must not be attributed to whichever login happens to be current.
      if(points.some(point=>point.accountId==null))items.push({id:'unassigned',name:'未关联账号的记录',active:false});
      return items.map(row=>{
        const {latest,success}=latestSamples(points,row.id==='unassigned'?null:row.id);
        const error=(row.active?this.jobs.get(source)?.error||text(state.current.error):null)||
          (latest?.status==='unavailable'?text(latest.reason)||'额度刷新失败':null);
        let estimates=new Map();
        if(row.active&&row.id!=='unassigned'&&this.agyUsage){
          const recent=points.filter(point=>Date.parse(point.at)>=this.now()-7*86400000);
          estimates=agyQuotaEstimates(recent,row.id,(start,end)=>{
            const index=this.agyUsage();index.refresh();
            return index.db.prepare('SELECT data FROM usage WHERE time>? AND time<=?').all(start,end).map(item=>JSON.parse(item.data));
          });
        }
        const resultWindows=agyOverviewWindows(success?.windows||[]).map(window=>{
          const original=success?.windows?.find(item=>item.poolId===window.poolId&&item.window===window.window&&iso(item.resetsAt)===window.resetsAt);
          if(!original?.poolId)return window;
          const sample=estimates.get(JSON.stringify([original.poolId,original.window,original.resetsAt]));
          return {...window,estimate:sample&&sample.percent>=1&&sample.tokens>0?{state:'estimated',tokens:sample.tokens*100/sample.percent,usd:sample.priced?sample.usd*100/sample.percent:null,partial:sample.partial}:{state:'collecting'}};
        });
        return account(row,{disabled:row.disabled===true,updatedAt:iso(success?.at),cached:true,
          stale:!!success&&!!error,reason:error,
          windows:resultWindows});
      });
    }
    if(source==='claude'){
      const state=await this.claude.list(),points=this.claude.history(),items=[...state.items];
      if(!items.some(row=>row.active))items.unshift({...state.current,id:state.currentAccountId||'current',active:true});
      return items.map(row=>{
        const {latest,success}=latestSamples(points,row.id);
        return account(row,{updatedAt:iso(success?.at),stale:latest?.status==='unavailable',
          reason:text(latest?.reason)||text(row.usageReason),
          windows:windows((success?.windows||[]).map(value=>[value,value.name]))});
      });
    }
    return [];
  }
  snapshot(source){
    // AGY's native identity read starts a Windows credential helper. Share it
    // across clients and job polling instead of spawning it every two seconds.
    if(source==='codex')return this.accounts(source);
    const previous=this.snapshots.get(source);
    if(previous&&(previous.pending||previous.until>this.now()))return previous.pending||Promise.resolve(previous.value);
    const entry={until:0};this.snapshots.set(source,entry);
    entry.pending=this.accounts(source).then(value=>{entry.value=value;entry.until=this.now()+15000;return value;}).finally(()=>{entry.pending=null;});
    return entry.pending;
  }
  async read(source='all'){
    if(source!=='all'&&!Object.hasOwn(QUOTA_SOURCES,source))throw Error('额度来源无效');
    const ids=source==='all'?Object.keys(QUOTA_SOURCES):[source];
    const sources=await Promise.all(ids.map(async id=>{
      const job=this.jobs.get(id),base={source:id,label:QUOTA_SOURCES[id],refreshable:!!this.refreshers[id],refreshing:!!job?.pending,
        checkedAt:job?.checkedAt||null,error:job?.error||null,accounts:[]};
      try{return {...base,accounts:[...await this.snapshot(id)].sort((a,b)=>Number(b.active)-Number(a.active)),supported:!!this.refreshers[id]};}
      catch{return {...base,error:'账号信息暂不可读取',supported:!!this.refreshers[id]};}
    }));
    return {sources,updatedAt:this.now()};
  }
  refresh(source='all'){
    if(source!=='all'&&!Object.hasOwn(this.refreshers,source))throw Error('此来源暂不支持额度刷新');
    for(const id of source==='all'?Object.keys(this.refreshers):[source]){
      if(this.jobs.get(id)?.pending)continue;
      this.snapshots.delete(id);
      const job={pending:true,error:null,checkedAt:null};this.jobs.set(id,job);
      Promise.resolve().then(()=>this.refreshers[id]()).catch(error=>{job.error=text(error.message)||'额度刷新失败';})
        .finally(()=>{job.pending=false;job.checkedAt=new Date(this.now()).toISOString();this.snapshots.delete(id);});
    }
    return {accepted:true,sources:source==='all'?Object.keys(this.refreshers):[source]};
  }
}
