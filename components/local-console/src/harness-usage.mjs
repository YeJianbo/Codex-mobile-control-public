import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {zstdDecompressSync} from 'node:zlib';

export const HARNESS_PRICE_DATE='2026-10-13';
export const DEEPSEEK_PRICE_SOURCE='https://api-docs.deepseek.com/quick_start/pricing/';
export const QWEN_PRICE_SOURCE='https://www.qwencloud.com/models/qwen3.8-flash';
export const GLM_PRICE_SOURCE='https://docs.z.ai/guides/overview/pricing';
export const GLM_PRICE_DATE='2026-10-24';
const glmRates={'glm-5.3':{input:1.4,cached:.26,output:4.4},'glm-5.3-flash':{input:.15,cached:.03,output:.5},'glm-5.3-flashx':{input:.37,cached:.075,output:1.25}};
// USD / million tokens. Cache reads are part of input, not additional input.
export function glmQuote(row){
  const model=String(row.model||'').split('::').at(-1).split('/').at(-1).toLowerCase(),rate=glmRates[model];
  if(!rate||row.partialUsage||![row.input,row.cacheRead??0,row.output].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0)||(row.cacheRead??0)>row.input)return null;
  return {usd:((row.input-(row.cacheRead??0))*rate.input+(row.cacheRead??0)*rate.cached+row.output*rate.output)/1e6,basis:'official_reference',date:GLM_PRICE_DATE,priceModel:model};
}
const holidaySource='https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html';
const holidays2026=[['01-01','01-03'],['02-15','02-23'],['04-04','04-06'],['05-01','05-05'],['06-19','06-21'],['09-25','09-27'],['10-01','10-07']];
const validCount=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const count=value=>validCount(value)?value:0;
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const time=value=>{const n=typeof value==='string'?Date.parse(value):Number(value);return Number.isFinite(n)&&n>0?(n<1e11?n*1000:n):null;};
const text=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,'').slice(0,256):'';
const endpoint=value=>{try{const url=new URL(value);return url.protocol+'//'+url.host+url.pathname.replace(/\/+$/,'');}catch{return '';}};

export function deepseekQuote(row){
  const model=String(row.model||'').split('::').at(-1).toLowerCase();
  const flash=['deepseek-flash','deepseek-v4.1-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp','ecnu-max'].includes(model);
  const pro=model==='deepseek-v4-pro';
  if((!flash&&!pro)||row.partialUsage||row.cacheWrite>0||!Number.isFinite(row.time))return null;
  // The provider's schedule is UTC; Chinese holiday dates are local calendar dates.
  const d=new Date(row.time),chinaDate=new Date(row.time+8*3600000).toISOString().slice(0,10);
  if(!chinaDate.startsWith('2026-'))return null;
  const holiday=holidays2026.some(([from,to])=>chinaDate.slice(5)>=from&&chinaDate.slice(5)<=to);
  const hour=d.getUTCHours()+d.getUTCMinutes()/60;
  const peak=!holiday&&d.getUTCDay()>=1&&d.getUTCDay()<=5&&(hour>=1&&hour<4||hour>=6&&hour<10);
  const rate=flash?{input:.3,cached:.006,output:1.2}:{input:1.32,cached:.044,output:3.96};
  const multiplier=peak?1:.5;
  if(row.cacheRead>row.input)return null;
  return {usd:((row.input-row.cacheRead)*rate.input+row.cacheRead*rate.cached+row.output*rate.output)*multiplier/1e6,window:peak?'peak':'off_peak',basis:'official_reference',date:HARNESS_PRICE_DATE};
}

// User-selected ECNU reference prices; the original model/provider attribution stays intact.
export function ecnuQuote(row){
  const model=String(row.model||'').split('::').at(-1).toLowerCase();
  if(model==='ecnu-max')return deepseekQuote(row);
  if(model!=='ecnu-plus'||row.partialUsage||row.cacheRead+row.cacheWrite>row.input)return null;
  const usd=((row.input-row.cacheRead-row.cacheWrite)*.15+row.cacheRead*.016+row.cacheWrite*.2+row.output*.47)/1e6;
  return {usd,basis:'official_reference',date:HARNESS_PRICE_DATE,priceModel:'Qwen3.8-Flash-Next'};
}

function walk(root,depth=0){
  if(depth>8||!fs.existsSync(root))return [];
  return fs.readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(root,entry.name),depth+1):entry.isFile()?[path.join(root,entry.name)]:[]);
}

export function readHermesUsage(home){
  const file=path.join(home,'state.db');
  if(!fs.existsSync(file))return {rows:[],coverage:{available:false,periodBasis:'session_last_seen'}};
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    const columns=table=>new Set(db.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name));
    const select=(table,fields)=>fields.map(field=>columns(table).has(field)?field:'NULL AS '+field).join(',');
    const fields=['model','billing_provider','billing_base_url','billing_mode','input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens','api_call_count','estimated_cost_usd','actual_cost_usd','cost_status','cost_source'];
    const items=tables.has('session_model_usage')?db.prepare('SELECT rowid AS native_id,session_id,first_seen,last_seen,'+select('session_model_usage',[...fields,'task'])+' FROM session_model_usage').all():[];
    const attributed=new Set(items.map(item=>item.session_id));
    // Old Hermes versions may have only session totals. Never add both representations.
    if(tables.has('sessions'))for(const item of db.prepare('SELECT id,started_at,last_activity_at,ended_at,'+select('sessions',fields)+' FROM sessions').all())if(!attributed.has(item.id))items.push({...item,session_id:item.id,first_seen:item.started_at,last_seen:item.ended_at||item.last_activity_at||item.started_at});
    const rows=[];let activityOnlySessions=0;
    for(const item of items){
      if(!count(item.api_call_count)&&!count(item.input_tokens)&&!count(item.output_tokens)){activityOnlySessions++;continue;}
      const at=time(item.last_seen),first=time(item.first_seen);if(!at)continue;
      const cacheRead=count(item.cache_read_tokens),cacheWrite=count(item.cache_write_tokens),provider=text(item.billing_provider),billingMode=text(item.billing_mode),status=text(item.cost_status);
      // Hermes stores canonical non-cache input separately from read/write cache buckets.
      const row={usageId:JSON.stringify(['hermes',file,item.session_id,item.native_id??'legacy',first]),time:at,firstTime:first,model:text(item.model)||'未知模型',provider,billingMode,sessionId:text(item.session_id),input:count(item.input_tokens)+cacheRead+cacheWrite,cacheRead,cacheWrite,output:count(item.output_tokens),reasoning:count(item.reasoning_tokens),requests:count(item.api_call_count),turns:0};
      if(status==='included'||billingMode==='subscription_included')row.cost={basis:'subscription_included',usd:null};
      else if(status==='actual'&&amount(item.actual_cost_usd)!==null)row.cost={basis:'provider_reported',usd:item.actual_cost_usd};
      else if(status==='estimated'&&amount(item.estimated_cost_usd)!==null)row.cost={basis:'native_estimate',usd:item.estimated_cost_usd};
      else row.cost={basis:'unknown',usd:null};
      row.costSource=text(item.cost_source);row.endpoint=endpoint(item.billing_base_url);rows.push(row);
    }
    return {rows,coverage:{available:true,periodBasis:'session_last_seen',activityOnlySessions}};
  }finally{db.close();}
}

function streamUsage(stream){return Array.isArray(stream)?[...stream].reverse().find(record=>record?.type==='chunk'&&record.chunk?.type==='usage')?.chunk.usage:null;}

// DSH writes a separate Zstandard frame for its header and each event batch.
// Node's one-shot decoder returns only the first frame, so find frame boundaries.
export function decodeDeepSeekFrames(raw){
  const output=[];let offset=0,total=0,torn=false;
  while(offset<raw.length){
    const start=offset;
    if(raw.length-offset<5){torn=true;break;}
    if(raw.readUInt32LE(offset)!==0xfd2fb528)throw new Error('Invalid Zstandard frame');
    offset+=4;const descriptor=raw[offset++];
    if(descriptor&24)throw new Error('Invalid Zstandard descriptor');
    const flag=descriptor>>>6,single=!!(descriptor&32),dict=descriptor&3;
    offset+=(single?0:1)+(dict===3?4:dict)+(flag===0?(single?1:0):1<<flag);
    if(offset>raw.length){torn=true;break;}
    let complete=false;
    while(offset+3<=raw.length){
      const block=raw.readUIntLE(offset,3);offset+=3;
      const type=(block>>>1)&3;if(type===3)throw new Error('Invalid Zstandard block');
      offset+=type===1?1:block>>>3;
      if(offset>raw.length)break;
      if(block&1){complete=true;break;}
    }
    if(!complete){torn=true;break;}
    if(descriptor&4)offset+=4;
    if(offset>raw.length){torn=true;break;}
    const decoded=zstdDecompressSync(raw.subarray(start,offset),{maxOutputLength:128*1024*1024-total});
    total+=decoded.length;if(total>128*1024*1024)throw new Error('Session too large');output.push(decoded);
  }
  return {body:Buffer.concat(output),torn};
}

export function deepseekRows(records,sessionId){
  const header=records[0];if(header?.type!=='session'||header.version!==4)return {rows:[],unsupported:true};
  const slots=new Map(),attempts=new Map();let at=time(header.createdAt),model='',provider='';
  const inherited=header.isSeeded?Math.max(-1,...records.filter(event=>event.type==='session/end-seed'&&event.data?.inherited===true).map(event=>event.seq)): -1;
  if(header.isSeeded&&inherited<0)return {rows:[],unsupported:true};
  for(const event of records.slice(1)){
    if(typeof event.type!=='string'||!event.data)continue;
    if(Number.isFinite(event.seq)&&event.seq<=inherited)continue;
    const data=event.data;at=time(event.time)||at;
    if(event.type==='request/context'){model=text(data.model);provider=text(data.provider);continue;}
    if(event.type==='request/header'){model=text(data.header?.config?.model)||model;provider=text(data.header?.config?.provider)||provider;continue;}
    const step=JSON.stringify([data.turn,data.step]);
    if(event.type==='llm/retry-started'){attempts.set(step,(attempts.get(step)||0)+1);continue;}
    if(!['assistant/message','assistant/attempt'].includes(event.type))continue;
    const source=data.message?.source;
    if(source){model=text(source.model);provider=text(source.provider);}
    const usage=data.usage??streamUsage(data.stream);if(!usage||!validCount(usage.inputTokens)||!validCount(usage.outputTokens))continue;
    if(!Number.isSafeInteger(data.turn)||!Number.isSafeInteger(data.step))continue;
    const cacheRead=count(usage.cacheReadTokens),cacheWrite=count(usage.cacheWriteTokens),known=usage.inputTokens+cacheRead+cacheWrite;
    const exact=validCount(usage.totalTokens)?usage.totalTokens-usage.outputTokens:null;
    if(exact!==null&&exact<known)continue;
    const partialUsage=exact!==null&&exact!==known;
    const id=JSON.stringify(['deepseek',sessionId,data.turn,data.step,attempts.get(step)||0]);
    const row={usageId:id,sessionId,time:at,model:model||'未知模型',provider:provider||'未知供应商',billingMode:'api',input:exact??known,cacheRead,cacheWrite,output:usage.outputTokens,reasoning:count(usage.reasoningTokens),requests:1,turns:0,partialUsage};
    const quote=ecnuQuote(row)||(provider==='deepseek-official'?deepseekQuote(row):null);row.cost=quote||{usd:null,basis:'unknown'};
    slots.set(id,row);
  }
  return {rows:[...slots.values()].filter(row=>Number.isFinite(row.time))};
}

export function readDeepSeekUsage(home){
  const root=path.join(home,'sessions'),selected=new Map();let skippedFiles=0;
  for(const file of walk(root)){
    const match=path.basename(file).match(/^session\.v(\d+)\.jsonl(?:\.zstd)?$/);if(!match)continue;
    const key=path.dirname(file),previous=selected.get(key),version=Number(match[1]);
    if(!previous||version>previous.version||version===previous.version&&fs.statSync(file).mtimeMs>fs.statSync(previous.file).mtimeMs)selected.set(key,{file,version});
  }
  const rows=[];
  for(const {file} of selected.values()){
    try{
      if(fs.statSync(file).size>64*1024*1024){skippedFiles++;continue;}
      const raw=fs.readFileSync(file),decoded=file.endsWith('.zstd')?decodeDeepSeekFrames(raw):{body:raw,torn:false};
      if(decoded.torn)skippedFiles++;
      const records=[];for(const line of decoded.body.toString('utf8').split('\n')){if(!line.trim())continue;try{records.push(JSON.parse(line));}catch{skippedFiles++;break;}}
      const result=deepseekRows(records,path.basename(path.dirname(file)));if(result.unsupported)skippedFiles++;else rows.push(...result.rows);
    }catch{skippedFiles++;}
  }
  return {rows,coverage:{available:fs.existsSync(root),periodBasis:'native_events',skippedFiles}};
}

export function harnessSummary(source,rows,{since,until},coverage){
  const empty=()=>({input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,requests:0,sessions:0,turns:0});
  const costEmpty=()=>({usd:0,actualUsd:0,estimatedUsd:0,pricedRecords:0,actualRecords:0,estimatedRecords:0,includedRecords:0,unpricedRecords:0,partialRecords:0});
  const groups=new Map(),daily=new Map(),totals=empty(),cost=costEmpty(),sessions=new Set();
  const addCost=(target,row)=>{
    const n=row.requests||1,basis=row.cost?.basis,usd=amount(row.cost?.usd);
    if(row.partialUsage)target.partialRecords+=n;
    if(basis==='subscription_included'){target.includedRecords+=n;return;}
    if(usd===null){target.unpricedRecords+=n;return;}
    target.usd+=usd;target.pricedRecords+=n;
    if(basis==='provider_reported'){target.actualUsd+=usd;target.actualRecords+=n;}else{target.estimatedUsd+=usd;target.estimatedRecords+=n;}
  };
  for(const original of rows){
    const reference=source==='opencode'?null:ecnuQuote(original)||(!original.cost||original.cost.usd==null||original.cost.basis==='official_reference'?glmQuote(original):null);
    const row=reference&&!['provider_reported','subscription_included'].includes(original.cost?.basis)?{...original,cost:reference}:original;
    if(row.time<since||row.time>until)continue;
    const key=JSON.stringify([row.model,row.provider,row.billingMode]),group=groups.get(key)||{model:row.model,provider:row.provider,billingMode:row.billingMode,...empty(),cost:costEmpty()};
    for(const k of ['input','output','cacheRead','cacheWrite','reasoning','requests','turns']){group[k]+=count(row[k]);totals[k]+=count(row[k]);}
    const sessionKey=key+':'+row.sessionId;if(!sessions.has(sessionKey)){sessions.add(sessionKey);group.sessions++;}
    addCost(group.cost,row);addCost(cost,row);groups.set(key,group);
    const d=new Date(row.time),date=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),hour=date+'T'+String(d.getHours()).padStart(2,'0'),dayKey=JSON.stringify([hour,key]);
    const day=daily.get(dayKey)||{date,hour,model:row.model,...empty()};for(const k of ['input','output','cacheRead','cacheWrite','reasoning','requests'])day[k]+=count(row[k]);daily.set(dayKey,day);
  }
  totals.sessions=new Set(rows.filter(row=>row.time>=since&&row.time<=until).map(row=>row.sessionId)).size;
  const finishCost=c=>({...c,usd:c.pricedRecords?c.usd:null,actualUsd:c.actualRecords?c.actualUsd:null,estimatedUsd:c.estimatedRecords?c.estimatedUsd:null});
  const aliases=new Set(rows.filter(row=>row.time>=since&&row.time<=until).map(row=>String(row.model||'').split('::').at(-1).toLowerCase()));
  const hasGlm=rows.some(row=>row.time>=since&&row.time<=until&&glmQuote(row));
  const priceSources=source==='opencode'?[]:[...(source==='deepseek'||aliases.has('ecnu-max')?[DEEPSEEK_PRICE_SOURCE,holidaySource]:[]),...(aliases.has('ecnu-plus')?[QWEN_PRICE_SOURCE]:[]),...(hasGlm?[GLM_PRICE_SOURCE]:[])];
  return {source,since,until,totals,groups:[...groups.values()].map(group=>({...group,cost:finishCost(group.cost),usd:group.cost.pricedRecords?group.cost.usd:null})).sort((a,b)=>b.input+b.output-a.input-a.output),modelSeries:[...daily.values()],cost:{...finishCost(cost),basis:source==='opencode'?'native_recorded':'native_and_reference',date:hasGlm?GLM_PRICE_DATE:priceSources.length?HARNESS_PRICE_DATE:null,currency:'USD',sources:priceSources},coverage};
}
