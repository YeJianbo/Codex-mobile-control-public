import {summarizeError} from './upstream-errors.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {Transform} from 'node:stream';
import {atomicWrite} from './catalog.mjs';
import {json} from './store.mjs';
import {calendarRange,normalizeAnalyticsTier} from './analytics-core.mjs';
import {tokenSpeedStats} from './token-speed.mjs';

const percent=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000?v:null;
export function tailRows(file,maxBytes=4*1024*1024){
  if(!fs.existsSync(file))return [];
  const fd=fs.openSync(file,'r');try{const size=fs.fstatSync(fd).size;const b=Buffer.alloc(Math.min(size,maxBytes));fs.readSync(fd,b,0,b.length,size-b.length);const lines=b.toString().split('\n');if(size>b.length)lines.shift();return lines.map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean);}finally{fs.closeSync(fd);}
}
function append(file,row){fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file)&&fs.statSync(file).size>4*1024*1024)fs.renameSync(file,file+'.previous');fs.appendFileSync(file,JSON.stringify(row)+'\n',{mode:0o600});}
export function normalizeWindows(rate={}){
  const result={primary:null,secondary:null,other:[]};
  for(const w of [rate.primary_window,rate.secondary_window]){if(!w)continue;const normalized={used_percent:percent(w.used_percent),reset_at:w.reset_at??null,limit_window_seconds:w.limit_window_seconds??null};if(w.limit_window_seconds===18000)result.primary=normalized;else if(w.limit_window_seconds===604800)result.secondary=normalized;else result.other.push(normalized);}
  return result;
}
export function activeAccount(store){
  const auth=json(path.join(store.home,'auth.json'),{});const registry=json(path.join(store.home,'accounts/registry.json'),{});const id=auth.tokens?.account_id;
  const matching=id?(registry.items||[]).find(i=>i.accountKey?.endsWith('::'+id)):null;
  return matching?.accountKey||id||registry.activeAccountKey||'current';
}
export class UsageService {
  constructor(store,{fetchImpl=fetch,now=()=>Date.now()}={}){this.store=store;this.fetch=fetchImpl;this.now=now;this.historyFile=path.join(store.dir,'quota-history.jsonl');this.requestFile=path.join(store.dir,'request-usage.jsonl');this.latestFile=path.join(store.dir,'quota-current.json');this.pending=null;this.lastError=null;this.timer=null;this.closed=false;const latest=json(this.latestFile);if(latest?.accountKey===activeAccount(store))store.usage=latest;}
  async refresh(){if(this.pending)return this.pending;this.pending=this.capture();try{const r=await this.pending;this.lastError=null;return r;}catch(e){this.lastError=e.message;throw e;}finally{this.pending=null;}}
  async capture(){const accountKey=activeAccount(this.store);const auth=this.store.auth();const headers={Authorization:'Bearer '+auth.tokens.access_token};if(auth.tokens.account_id)headers['ChatGPT-Account-Id']=auth.tokens.account_id;
    const r=await this.fetch('https://chatgpt.com/backend-api/wham/usage',{headers,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`官方额度接口 HTTP ${r.status}`);const v=await r.json();
    const record={accountKey,at:new Date(this.now()).toISOString(),plan:v.plan_type||null,...normalizeWindows(v.rate_limit)};
    append(this.historyFile,{accountKey,timestamp:Math.floor(this.now()/1000),primaryUsedPercent:record.primary?.used_percent??null,secondaryUsedPercent:record.secondary?.used_percent??null,source:'official-api'});atomicWrite(this.latestFile,record);if(activeAccount(this.store)===accountKey)this.store.usage=record;return record;
  }
  history(accountKey=activeAccount(this.store),days=7,range=null,bounds={}){
    if(![1,7,30,90].includes(Number(days)))throw new Error('不支持该时间范围');
    const window=range?calendarRange(range,this.now(),bounds):{since:this.now()-Number(days)*86400000,until:this.now()};const cutoff=window.since/1000,until=window.until/1000;const files=[path.join(this.store.home,'codexmate/quota-history.jsonl'),this.historyFile+'.previous',this.historyFile];const map=new Map();let rawCount=0;
    for(const file of files)for(const row of tailRows(file)){const time=typeof row.timestamp==='number'?(row.timestamp>1e12?row.timestamp/1000:row.timestamp):Date.parse(row.timestamp)/1000;if(row.accountKey!==accountKey||!Number.isFinite(time)||time<cutoff||time>until)continue;rawCount++;map.set(time,{timestamp:time,primary:percent(row.primaryUsedPercent),secondary:percent(row.secondaryUsedPercent)});}
    let points=[...map.values()].sort((a,b)=>a.timestamp-b.timestamp);const sampleCount=points.length;if(points.length>2000){const buckets=new Map();const width=Math.max(1,(until-cutoff)/2000);for(const p of points)buckets.set(Math.min(1999,Math.floor((p.timestamp-cutoff)/width)),p);points=[...buckets.values()];}
    const latest=json(this.latestFile);return {accountKey,days:Number(days),points,sampleCount,displayedCount:points.length,rawCount,latest:latest?.accountKey===accountKey?latest:null,autoSample:this.store.data.usageAutoSample!==false,lastError:this.lastError};
  }
  recordRequest(record){const number=v=>Number.isFinite(v)&&v>=0?v:null;append(this.requestFile,{timestamp:Math.floor(this.now()/1000),model:record.model,tier:normalizeAnalyticsTier(record.tier),provider:record.provider||'openai',resource:record.resource||'responses',status:record.status||0,durationMs:number(record.durationMs),...Object.fromEntries(['firstByteMs','firstOutputMs','firstTextMs','completedMs'].map(k=>[k,number(record.timings?.[k])])),inputTokens:number(record.usage?.input_tokens),outputTokens:number(record.usage?.output_tokens),cachedTokens:number(record.usage?.input_tokens_details?.cached_tokens),test:!!record.test,...(record.errorSummary?{errorSummary:record.errorSummary}:{}),...(record.errorCode?{errorCode:record.errorCode}:{})});}
  requestRows(days=7,range=null,bounds={}){const window=range?calendarRange(range,this.now(),bounds):{since:this.now()-Number(days)*86400000,until:this.now()};const cutoff=window.since/1000,until=window.until/1000;return [...tailRows(this.requestFile+'.previous'),...tailRows(this.requestFile)].filter(r=>r.timestamp>=cutoff&&r.timestamp<=until);}
  speed(range='week',bounds={},filters={}){const result=tokenSpeedStats(this.requestRows(7,range,bounds),filters);const names=new Map(this.store.providers().map(p=>[p.id,p.name]));for(const option of result.options.provider)if(option.value!=='missing')option.label=option.value==='v:openai'?'OpenAI':names.get(option.value.slice(2))||option.label;for(const row of [...result.groups,...result.recent])row.providerName=row.provider==='openai'?'OpenAI':names.get(row.provider)||row.provider||'未记录';return result;}
  requests(days=7,range=null,bounds={}){const rows=this.requestRows(days,range,bounds);return {scope:'local-router-only',requests:rows.length,failed:rows.filter(r=>r.status<200||r.status>=400||r.errorCode).length,measuredRequests:rows.filter(r=>r.inputTokens!=null||r.outputTokens!=null).length,inputTokens:rows.reduce((n,r)=>n+(r.inputTokens||0),0),outputTokens:rows.reduce((n,r)=>n+(r.outputTokens||0),0),recent:rows.slice(-30).reverse()};}
  start(){if(this.timer)return;const tick=async()=>{try{if(this.store.data.usageAutoSample!==false&&json(path.join(this.store.home,'auth.json'),{}).tokens?.access_token)await this.refresh();}catch{}finally{if(!this.closed){this.timer=setTimeout(tick,300000);this.timer.unref();}}};this.timer=setTimeout(tick,5000);this.timer.unref();}
  stop(){this.closed=true;clearTimeout(this.timer);}
}
export function usageObserver({now=()=>performance.now(),startedAt=now()}={}){
 let pending='',usage=null,tier=null,failure=null,completed=false,expectSSE=true,jsonOverflow=false;const decoder=new TextDecoder();
 const timings={firstByteMs:null,firstOutputMs:null,firstTextMs:null,completedMs:null};const elapsed=()=>Math.max(0,now()-startedAt);
 const deltas=new Set(['response.output_text.delta','response.reasoning_text.delta','response.reasoning_summary_text.delta','response.function_call_arguments.delta','response.custom_tool_call_input.delta','response.mcp_call_arguments.delta','response.refusal.delta']);
 const line=value=>{if(!value.startsWith('data:'))return;try{const v=JSON.parse(value.slice(5).trimStart());if(Object.hasOwn(v.response||{},'service_tier'))tier=normalizeAnalyticsTier(v.response.service_tier);if(deltas.has(v.type)&&typeof v.delta==='string'&&v.delta.length){timings.firstOutputMs??=elapsed();if(v.type==='response.output_text.delta')timings.firstTextMs??=elapsed();}if(v.type==='response.completed'){completed=true;usage=v.response?.usage||null;timings.completedMs??=elapsed();}if(['error','response.failed','response.incomplete'].includes(v.type)){failure=summarizeError(200,v.error||v.response?.error? v : {error:{code:v.type,message:v.response?.incomplete_details?.reason||'上游响应未完成'}});}}catch{}};
 const stream=new Transform({transform(chunk,encoding,done){if(chunk.length)timings.firstByteMs??=elapsed();if(expectSSE){pending+=decoder.decode(chunk,{stream:true});let i;while((i=pending.indexOf('\n'))>=0){line(pending.slice(0,i));pending=pending.slice(i+1);}if(pending.length>1024*1024)pending='';}else if(!jsonOverflow){pending+=decoder.decode(chunk,{stream:true});if(pending.length>1024*1024){pending='';jsonOverflow=true;}}done(null,chunk);},flush(done){if(expectSSE){pending+=decoder.decode();line(pending);if(!completed&&!failure)failure=summarizeError(200,{error:{code:'UPSTREAM_STREAM_INCOMPLETE',message:'上游响应流结束，但未收到完成事件'}});}else if(!jsonOverflow){try{const response=JSON.parse(pending+decoder.decode());usage=response.usage||null;tier=normalizeAnalyticsTier(response.service_tier);timings.completedMs=elapsed();if(['failed','incomplete'].includes(response.status)||response.error)failure=summarizeError(200,{error:response.error||{code:'response.'+response.status,message:response.incomplete_details?.reason||'上游响应未完成'}});}catch{}}done();}});
 return {stream,expectSSE:value=>expectSSE=!!value,getUsage:()=>usage,getTier:()=>tier,getFailure:()=>failure,getTimings:()=>({...timings})};
}

