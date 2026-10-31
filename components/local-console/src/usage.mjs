import {summarizeError} from './upstream-errors.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {Transform} from 'node:stream';
import {atomicWrite} from './catalog.mjs';
import {json} from './store.mjs';
import {calendarRange,normalizeAnalyticsTier} from './analytics-core.mjs';
import {tokenSpeedStats} from './token-speed.mjs';
import {RequestJournal} from './request-journal.mjs';
import {normalizeCredits} from './credit-balance.mjs';
import {estimateCredits,subscriptionEstimate,creditConsumption,historicalCalibration} from './credit-estimate.mjs';
import {nativeCreditRequests} from './native-credit-meter.mjs';

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
  async refresh({recordHistory=true}={}){
    if(this.pending){this.recordPending||=recordHistory;return this.pending;}
    this.recordPending=recordHistory;this.pending=this.capture();
    try{const result=await this.pending;this.lastError=null;return result;}
    catch(error){this.lastError=error.message;throw error;}
    finally{this.pending=null;this.recordPending=undefined;}
  }
  async capture(){const accountKey=activeAccount(this.store);const auth=this.store.auth();const headers={Authorization:'Bearer '+auth.tokens.access_token};if(auth.tokens.account_id)headers['ChatGPT-Account-Id']=auth.tokens.account_id;
    const r=await this.fetch('https://chatgpt.com/backend-api/wham/usage',{headers,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`官方额度接口 HTTP ${r.status}`);const v=await r.json();
    const record={accountKey,at:new Date(this.now()).toISOString(),plan:v.plan_type||null,credits:normalizeCredits(v.credits),...normalizeWindows(v.rate_limit)};
    const prior=json(this.latestFile),history=this.recordPending===false?[]:[...tailRows(this.historyFile+'.previous'),...tailRows(this.historyFile)];
    const baseline=history.at(-1);
    const previous=baseline?.accountKey===accountKey?{accountKey,plan:baseline.plan,at:new Date(baseline.timestamp*1000).toISOString(),credits:normalizeCredits(baseline.credits),primary:{used_percent:baseline.primaryUsedPercent,reset_at:baseline.primaryResetAt},secondary:{used_percent:baseline.secondaryUsedPercent,reset_at:baseline.secondaryResetAt}}:null;
    const calibration={};
    if(previous?.accountKey===accountKey&&previous.plan===record.plan&&Date.parse(record.at)-Date.parse(previous.at)<=900000){
      const rows=this.journal().db.prepare('SELECT data FROM requests WHERE at>? AND at<=?').all(Date.parse(previous.at),Date.parse(record.at)).map(row=>JSON.parse(row.data));
      const eligible=rows.filter(row=>row.accountKey===accountKey&&row.provider==='openai'&&!row.errorCode&&row.status>=200&&row.status<300&&row.purpose!=='test'&&row.startedAt>=Date.parse(previous.at));
      const config=this.store.configInfo?.(),officialProviders=['openai',...(config?.officialHttp&&config.provider?[config.provider]:[])];
      const native=nativeCreditRequests(path.join(this.store.dir,'analytics/activity.sqlite'),accountKey,Date.parse(previous.at),Date.parse(record.at),eligible,officialProviders);
      const balanceSame=record.credits?.balance!=null&&previous.credits?.balance===record.credits.balance;
      for(const key of ['primary','secondary']){
        const before=previous[key],after=record[key],delta=(after?.used_percent??NaN)-(before?.used_percent??NaN);
        const resetField=key==='primary'?'primaryReset':'secondaryReset';
        const matched=native.filter(row=>Number(row.nativeMeter[resetField])===before?.reset_at&&row.nativeMeter.balance!=null&&Number(row.nativeMeter.balance)===previous.credits?.balance);
        const quotes=[...eligible,...matched].map(estimateCredits).filter(Boolean);
        if(balanceSame&&before?.reset_at&&before.reset_at===after?.reset_at&&delta>0&&delta<=100&&after.used_percent<100&&quotes.length)
          calibration[key]={resetAt:after.reset_at,percent:delta,credits:quotes.reduce((sum,row)=>sum+row.subscription,0),requests:quotes.length};
      }
    }
    // Warmup probes keep current quota fresh without shortening history retention.
    // A simultaneous normal refresh promotes the shared request to a history sample.
    if(this.recordPending!==false)append(this.historyFile,{accountKey,timestamp:Math.floor(this.now()/1000),primaryUsedPercent:record.primary?.used_percent??null,secondaryUsedPercent:record.secondary?.used_percent??null,primaryResetAt:record.primary?.reset_at??null,secondaryResetAt:record.secondary?.reset_at??null,plan:record.plan,calibration,credits:record.credits,source:'official-api'});
    if(this.recordPending===false)record.subscriptionEstimate=prior?.accountKey===accountKey?prior.subscriptionEstimate:null;
    else{
      const config=this.store.configInfo?.(),providers=['openai',...(config?.officialHttp&&config.provider?[config.provider]:[])];
      const cacheKey=JSON.stringify([accountKey,record.plan,providers]);
      if(this.calibrationCache?.key!==cacheKey||this.now()-this.calibrationCache.at>=1800000){
        // Existing recorded calibrations already include their own request
        // intervals; do not reconstruct overlapping history a second time.
        const firstRecorded=history.findIndex(row=>row.accountKey===accountKey&&row.plan===record.plan&&Object.keys(row.calibration||{}).length>0);
        const backfill=firstRecorded<0?history:history.slice(0,firstRecorded);
        const reconstructed=historicalCalibration(backfill,accountKey,record.plan,(since,until,key,reset,balance)=>{
          const rows=this.journal().db.prepare('SELECT data FROM requests WHERE at>? AND at<=?').all(since,until).map(row=>JSON.parse(row.data));
          const eligible=rows.filter(row=>row.accountKey===accountKey&&row.provider==='openai'&&!row.errorCode&&row.status>=200&&row.status<300&&row.purpose!=='test'&&row.startedAt>=since);
          const native=nativeCreditRequests(path.join(this.store.dir,'analytics/activity.sqlite'),accountKey,since,until,eligible,providers);
          return [...eligible,...native.filter(row=>Number(row.nativeMeter[key+'Reset'])===reset&&row.nativeMeter.balance!=null&&Number(row.nativeMeter.balance)===balance)];
        },{since:this.now()/1000-7*86400});
        this.calibrationCache={key:cacheKey,at:this.now(),rows:reconstructed};
      }
      record.subscriptionEstimate=subscriptionEstimate([...this.calibrationCache.rows,...history,{accountKey,plan:record.plan,timestamp:this.now()/1000,calibration}].filter(row=>(row.accountKey===undefined||row.accountKey===accountKey)&&row.plan===record.plan&&(row.timestamp===undefined||row.timestamp*1000>=this.now()-90*86400000)));
    }
    atomicWrite(this.latestFile,record);if(activeAccount(this.store)===accountKey)this.store.usage=record;return record;
  }
  history(accountKey=activeAccount(this.store),days=7,range=null,bounds={}){
    if(![1,7,30,90].includes(Number(days)))throw new Error('不支持该时间范围');
    const window=range?calendarRange(range,this.now(),bounds):{since:this.now()-Number(days)*86400000,until:this.now()};const cutoff=window.since/1000,until=window.until/1000;const files=[path.join(this.store.home,'codexmate/quota-history.jsonl'),this.historyFile+'.previous',this.historyFile];const map=new Map();let rawCount=0;
    for(const file of files)for(const row of tailRows(file)){const time=typeof row.timestamp==='number'?(row.timestamp>1e12?row.timestamp/1000:row.timestamp):Date.parse(row.timestamp)/1000;if(row.accountKey!==accountKey||!Number.isFinite(time)||time<cutoff||time>until)continue;rawCount++;map.set(time,{timestamp:time,primary:percent(row.primaryUsedPercent),secondary:percent(row.secondaryUsedPercent),credits:normalizeCredits(row.credits)});}
    const latest=json(this.latestFile),latestTime=Date.parse(latest?.at)/1000;
    if(latest?.accountKey===accountKey&&latestTime>=cutoff&&latestTime<=until)map.set(latestTime,{timestamp:latestTime,primary:percent(latest.primary?.used_percent),secondary:percent(latest.secondary?.used_percent),credits:normalizeCredits(latest.credits)});
    let points=[...map.values()].sort((a,b)=>a.timestamp-b.timestamp);const sampleCount=points.length,creditUsage=creditConsumption(points);if(points.length>2000){const buckets=new Map();const width=Math.max(1,(until-cutoff)/2000);for(const p of points)buckets.set(Math.min(1999,Math.floor((p.timestamp-cutoff)/width)),p);points=[...buckets.values()];}
    return {accountKey,days:Number(days),points,creditUsage,sampleCount,displayedCount:points.length,rawCount,latest:latest?.accountKey===accountKey?latest:null,autoSample:this.store.data.usageAutoSample!==false,lastError:this.lastError};
  }
  creditSnapshots(){
    const files=[this.historyFile+'.previous',this.historyFile];
    const key=files.map(file=>{try{const s=fs.statSync(file);return `${s.size}:${s.mtimeMs}`;}catch{return '';}}).join('/');
    if(this.creditCache?.key===key)return this.creditCache.rows;
    const rows=new Map();
    for(const file of files)for(const row of tailRows(file)){
      const credits=normalizeCredits(row.credits),at=Number(row.timestamp)*1000;
      if(typeof row.accountKey!=='string'||!credits||!Number.isFinite(at))continue;
      if(at>=(rows.get(row.accountKey)?.at??0))rows.set(row.accountKey,{credits,at});
    }
    this.creditCache={key,rows};return rows;
  }
  journal(){return this.requestJournal??=new RequestJournal(this.store.dir,this.requestFile);}
  recordRequest(record){
    const number=value=>Number.isFinite(value)&&value>=0?value:null;
    const row=this.journal().record({timestampMs:this.now(),accountKey:record.accountKey||null,startedAt:record.startedAt??null,model:record.model,tier:normalizeAnalyticsTier(record.tier),requestedTier:normalizeAnalyticsTier(record.requestedTier),effort:typeof record.effort==='string'?record.effort:null,
      provider:record.provider||'openai',resource:record.resource||'responses',status:record.status||0,durationMs:number(record.durationMs),
      sessionId:typeof record.sessionId==='string'?record.sessionId.slice(0,200):null,purpose:record.purpose==='warmup'?'warmup':record.test?'test':'normal',
      ...Object.fromEntries(['firstByteMs','firstOutputMs','firstTextMs','completedMs'].map(key=>[key,number(record.timings?.[key])])),
      inputTokens:number(record.usage?.input_tokens),outputTokens:number(record.usage?.output_tokens),cachedTokens:number(record.usage?.input_tokens_details?.cached_tokens),
      reasoningTokens:number(record.usage?.output_tokens_details?.reasoning_tokens),test:!!record.test,
      ...(record.errorSummary?{errorSummary:record.errorSummary}:{}),...(record.errorCode?{errorCode:record.errorCode}:{})});
    // Keep the bounded rolling input for existing aggregates; archive queries are indexed.
    append(this.requestFile,row);
  }
  requestRows(days=7,range=null,bounds={}){const window=range?calendarRange(range,this.now(),bounds):{since:this.now()-Number(days)*86400000,until:this.now()};const cutoff=window.since/1000,until=window.until/1000;return [...tailRows(this.requestFile+'.previous'),...tailRows(this.requestFile)].filter(row=>row.timestamp>=cutoff&&row.timestamp<=until);}
  speed(range='week',bounds={},filters={}){const result=tokenSpeedStats(this.requestRows(7,range,bounds),filters);const names=new Map(this.store.providers().map(p=>[p.id,p.name]));for(const option of result.options.provider)if(option.value!=='missing')option.label=option.value==='v:openai'?'OpenAI':names.get(option.value.slice(2))||option.label;for(const row of [...result.groups,...result.recent])row.providerName=row.provider==='openai'?'OpenAI':names.get(row.provider)||row.provider||'未记录';return result;}
  requests(days=7,range=null,bounds={}){const rows=this.requestRows(days,range,bounds);return {scope:'local-router-only',requests:rows.length,failed:rows.filter(r=>r.status<200||r.status>=400||r.errorCode).length,measuredRequests:rows.filter(r=>r.inputTokens!=null||r.outputTokens!=null).length,inputTokens:rows.reduce((n,r)=>n+(r.inputTokens||0),0),outputTokens:rows.reduce((n,r)=>n+(r.outputTokens||0),0),recent:rows.slice(-30).reverse()};}
  start(){if(this.timer)return;const tick=async()=>{try{if(this.store.data.usageAutoSample!==false&&json(path.join(this.store.home,'auth.json'),{}).tokens?.access_token)await this.refresh();}catch{}finally{if(!this.closed){this.timer=setTimeout(tick,300000);this.timer.unref();}}};this.timer=setTimeout(tick,5000);this.timer.unref();}
  stop(){this.closed=true;clearTimeout(this.timer);this.requestJournal?.close();this.requestJournal=null;}
}
export function usageObserver({now=()=>performance.now(),startedAt=now()}={}){
 let pending='',usage=null,tier=null,failure=null,completed=false,expectSSE=true,jsonOverflow=false;const decoder=new TextDecoder();
 const timings={firstByteMs:null,firstOutputMs:null,firstTextMs:null,completedMs:null};const elapsed=()=>Math.max(0,now()-startedAt);
 const deltas=new Set(['response.output_text.delta','response.reasoning_text.delta','response.reasoning_summary_text.delta','response.function_call_arguments.delta','response.custom_tool_call_input.delta','response.mcp_call_arguments.delta','response.refusal.delta']);
 const line=value=>{if(!value.startsWith('data:'))return;try{const v=JSON.parse(value.slice(5).trimStart());if(Object.hasOwn(v.response||{},'service_tier'))tier=normalizeAnalyticsTier(v.response.service_tier);if(deltas.has(v.type)&&typeof v.delta==='string'&&v.delta.length){timings.firstOutputMs??=elapsed();if(v.type==='response.output_text.delta')timings.firstTextMs??=elapsed();}if(v.type==='response.completed'){completed=true;usage=v.response?.usage||null;timings.completedMs??=elapsed();}if(['error','response.failed','response.incomplete'].includes(v.type)){failure=summarizeError(200,v.error||v.response?.error? v : {error:{code:v.type,message:v.response?.incomplete_details?.reason||'上游响应未完成'}});}}catch{}};
 const stream=new Transform({transform(chunk,encoding,done){if(chunk.length)timings.firstByteMs??=elapsed();if(expectSSE){pending+=decoder.decode(chunk,{stream:true});let i;while((i=pending.indexOf('\n'))>=0){line(pending.slice(0,i));pending=pending.slice(i+1);}if(pending.length>1024*1024)pending='';}else if(!jsonOverflow){pending+=decoder.decode(chunk,{stream:true});if(pending.length>1024*1024){pending='';jsonOverflow=true;}}done(null,chunk);},flush(done){if(expectSSE){pending+=decoder.decode();line(pending);if(!completed&&!failure)failure=summarizeError(200,{error:{code:'UPSTREAM_STREAM_INCOMPLETE',message:'上游响应流结束，但未收到完成事件'}});}else if(!jsonOverflow){try{const response=JSON.parse(pending+decoder.decode());usage=response.usage||null;tier=normalizeAnalyticsTier(response.service_tier);timings.completedMs=elapsed();if(['failed','incomplete'].includes(response.status)||response.error)failure=summarizeError(200,{error:response.error||{code:'response.'+response.status,message:response.incomplete_details?.reason||'上游响应未完成'}});}catch{}}done();}});
 return {stream,expectSSE:value=>expectSSE=!!value,getUsage:()=>usage,getTier:()=>tier,getFailure:()=>failure,getTimings:()=>({...timings})};
}

