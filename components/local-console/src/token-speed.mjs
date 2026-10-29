import {normalizeAnalyticsTier} from './analytics-core.mjs';
const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
function percentile(values,p){if(!values.length)return null;const ordered=[...values].sort((a,b)=>a-b);return ordered[Math.max(0,Math.ceil(ordered.length*p)-1)];}
function summarize(rows){
  const outputTokens=rows.reduce((n,r)=>n+r.outputTokens,0),durationMs=rows.reduce((n,r)=>n+r.durationMs,0);
  const speeds=rows.map(r=>r.outputTokens/r.durationMs*1000),durations=rows.map(r=>r.durationMs);
  const waits=rows.filter(r=>valid(r.firstOutputMs)&&r.firstOutputMs<=r.durationMs).map(r=>r.firstOutputMs);
  const textWaits=rows.filter(r=>valid(r.firstTextMs)&&r.firstTextMs<=r.durationMs).map(r=>r.firstTextMs);
  return {samples:rows.length,outputTokens,durationMs,averageTPS:durationMs?outputTokens/durationMs*1000:null,p50TPS:percentile(speeds,.5),p95TPS:percentile(speeds,.95),p50DurationMs:percentile(durations,.5),p95DurationMs:percentile(durations,.95),firstOutputSamples:waits.length,p50FirstOutputMs:percentile(waits,.5),p95FirstOutputMs:percentile(waits,.95),firstTextSamples:textWaits.length,p50FirstTextMs:percentile(textWaits,.5),p95FirstTextMs:percentile(textWaits,.95)};
}
function matches(value,filter){return !filter||filter==='all'||(filter==='missing'?value==null:filter==='v:'+value);}
export function tokenSpeedStats(records,filters={}){
  for(const field of ['model','provider']){const value=filters[field];if(value!=null&&(typeof value!=='string'||value.length>500||!(value==='all'||value==='missing'||value.startsWith('v:'))))throw new Error('速度筛选值无效');}
  // Archived request rows without a resource field predate explicit compact tagging.
  const all=records.filter(r=>!r.test&&(!r.resource||r.resource==='responses')).map(r=>({...r,tier:normalizeAnalyticsTier(r.tier)}));
  const options={};for(const field of ['model','provider'])options[field]=[...new Set(all.map(r=>r[field]??null))].sort((a,b)=>String(a).localeCompare(String(b))).map(value=>({value:value==null?'missing':'v:'+value,label:value??'未记录'}));
  const scoped=all.filter(r=>matches(r.model,filters.model)&&matches(r.provider,filters.provider));
  const successful=scoped.filter(r=>r.status>=200&&r.status<300&&!r.errorCode);
  const measured=successful.filter(r=>valid(r.outputTokens)&&r.outputTokens>0&&valid(r.durationMs)&&r.durationMs>0);
  const groups=new Map();for(const row of measured){const key=JSON.stringify([row.model??null,row.provider??null,row.tier,row.effort??null,row.phase??null]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  return {source:'router',scope:'local-router-only',unit:'output-token/s',definition:'end-to-end',filters,options,totals:summarize(measured),coverage:{requests:scoped.length,failed:scoped.length-successful.length,unmeasured:successful.length-measured.length,excludedTests:records.filter(r=>r.test).length,excludedCompact:records.filter(r=>!r.test&&r.resource==='responses/compact').length},groups:[...groups.values()].map(rows=>({model:rows[0].model??null,provider:rows[0].provider??null,tier:rows[0].tier,effort:rows[0].effort??null,phase:rows[0].phase??null,...summarize(rows)})).sort((a,b)=>b.samples-a.samples),recent:[...measured].sort((a,b)=>b.timestamp-a.timestamp).slice(0,30).map(r=>({timestamp:r.timestamp,model:r.model??null,provider:r.provider??null,tier:r.tier,effort:r.effort??null,phase:r.phase??null,outputTokens:r.outputTokens,durationMs:r.durationMs,firstOutputMs:valid(r.firstOutputMs)&&r.firstOutputMs<=r.durationMs?r.firstOutputMs:null,firstTextMs:valid(r.firstTextMs)&&r.firstTextMs<=r.durationMs?r.firstTextMs:null,endToEndTPS:r.outputTokens/r.durationMs*1000}))};
}
