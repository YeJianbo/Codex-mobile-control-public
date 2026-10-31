import {localDate,localHour} from './usage-dates.mjs';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {isDeepStrictEqual} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {calendarRange} from './analytics-core.mjs';
import {readHermesUsage,readDeepSeekUsage,harnessSummary} from './harness-usage.mjs';
import {readZcodeUsage} from './zcode-usage.mjs';
import {readOpenCodeUsage,openCodeActivitySummary} from './opencode-usage.mjs';
import {readPiUsage,readResearchAgentUsage} from './agent-native-usage.mjs';

const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const empty=()=>({input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,requests:0,sessions:0,turns:0});
function files(root,name,depth=0){if(depth>8||!fs.existsSync(root))return [];const result=[];for(const item of fs.readdirSync(root,{withFileTypes:true})){const target=path.join(root,item.name);if(item.isDirectory())result.push(...files(target,name,depth+1));else if(item.isFile()&&name(item.name))result.push(target);}return result;}
async function* jsonl(file){const stream=fs.createReadStream(file,{encoding:'utf8'});const lines=readline.createInterface({input:stream,crlfDelay:Infinity});try{for await(const line of lines){if(line.length>1024*1024)continue;try{yield JSON.parse(line);}catch{}}}finally{lines.close();stream.destroy();}}
function append(map,row){const label=String(row.model||'未知模型').slice(0,120),group=map.get(label)||{model:label,...empty()};for(const k of Object.keys(empty()))group[k]+=number(row[k]);map.set(label,group);}
function finish(source,range,bounds,rows,coverage){const {since,until}=calendarRange(range,Date.now(),bounds),groups=new Map(),daily=new Map(),sessions=new Set();for(const row of rows)if(row.time>=since&&row.time<=until){const date=localDate(row.time),hour=localHour(row.time),dayKey=JSON.stringify([hour,row.model]);const day=daily.get(dayKey)||{date,hour,model:row.model,...empty()};for(const k of Object.keys(empty()))day[k]+=number(row[k]);daily.set(dayKey,day);const key=row.sessionId?row.model+':'+row.sessionId:null;append(groups,{...row,sessions:key&&!sessions.has(key)?1:0});if(key)sessions.add(key);}const list=[...groups.values()].sort((a,b)=>(b.input+b.output+b.turns)-(a.input+a.output+a.turns)),totals=empty();for(const group of list)for(const k of Object.keys(totals))totals[k]+=group[k];return {source,range,since,until,totals,groups:list,modelSeries:[...daily.values()],coverage};}
function openCodeSourceStamp(home){
 const file=path.join(home,'opencode.db');
 return JSON.stringify([file,file+'-wal'].map(target=>{
  try{const stat=fs.statSync(target,{bigint:true});return [target,...['ino','size','mtimeNs','ctimeNs'].map(key=>String(stat[key]))];}
  catch(error){if(error.code==='ENOENT')return [target,null];throw error;}
 }));
}

export class ExternalUsage{
 constructor(home=process.env.USERPROFILE||'',{dir,refreshMs=0,environment=process.env}={}){this.home=home;this.environment=environment;this.cache=new Map();this.refreshMs=refreshMs;this.historyDir=dir||path.join(home,'.codex','codexmate','local-console','analytics');}
 async records(source){const recent=this.cache.get(source);if(recent&&Date.now()-recent.checkedAt<this.refreshMs)return recent;const root=source==='claude'?path.join(this.home,'.claude','projects'):path.join(this.home,'.grok','sessions');const selected=files(root,source==='claude'?n=>n.endsWith('.jsonl'):n=>n==='events.jsonl'||n==='usage.json');const signature=selected.map(file=>{const stat=fs.statSync(file);return [file,stat.size,stat.mtimeMs].join(':');}).join('|');const previous=this.cache.get(source);if(previous?.signature===signature){previous.checkedAt=Date.now();return previous;}const rows=[];let meteredSessions=0,activityOnlySessions=0;
  if(source==='claude'){const messages=new Map();for(const file of selected)for await(const record of jsonl(file)){if(record.type!=='assistant'||!record.message?.usage||record.message.model==='<synthetic>')continue;const usage=record.message.usage,time=Date.parse(record.timestamp);if(!Number.isFinite(time))continue;const model=record.message.model||'未知模型',id=record.message.id||record.uuid||file+':'+time;const row={usageId:id,time,model,sessionId:record.sessionId||file,input:number(usage.input_tokens),output:number(usage.output_tokens),cacheRead:number(usage.cache_read_input_tokens),cacheWrite:number(usage.cache_creation_input_tokens),reasoning:0,requests:1,turns:0};const key=model+':'+id,old=messages.get(key);if(!old||row.output+row.input+row.cacheRead+row.cacheWrite>old.output+old.input+old.cacheRead+old.cacheWrite)messages.set(key,row);}rows.push(...messages.values());}
  else {const metered=new Set();for(const file of selected.filter(f=>path.basename(f)==='usage.json')){try{if(fs.statSync(file).size>4*1024*1024)continue;const usage=JSON.parse(fs.readFileSync(file,'utf8')),id=usage.sessionId||path.basename(path.dirname(file));if(!Array.isArray(usage.turns))continue;metered.add(id);for(const turn of usage.turns){const time=Date.parse(turn.endedAt||usage.updatedAt);if(!Number.isFinite(time))continue;const models=turn.modelUsage&&Object.keys(turn.modelUsage).length?Object.entries(turn.modelUsage):[[turn.primaryModelId||'未知模型',turn]];for(const [model,v] of models)rows.push({time,model,sessionId:id,input:number(v.inputTokens),output:number(v.outputTokens),cacheRead:number(v.cachedReadTokens),cacheWrite:number(v.cacheCreationTokens),reasoning:number(v.reasoningTokens),requests:number(v.modelCalls),turns:model===turn.primaryModelId?1:0});}}catch{}}meteredSessions=metered.size;const activity=new Set();for(const file of selected.filter(f=>path.basename(f)==='events.jsonl')){let model='未知模型';for await(const record of jsonl(file)){if(record.type!=='turn_started')continue;const time=Date.parse(record.ts),id=record.session_id||path.basename(path.dirname(file));if(!Number.isFinite(time)||metered.has(id))continue;if(record.model_id)model=record.model_id;activity.add(id);rows.push({time,model,sessionId:id,turns:1});}}activityOnlySessions=activity.size;}
  const result={signature,rows:this.retain(source,rows),meteredSessions,activityOnlySessions,checkedAt:Date.now()};this.cache.set(source,result);return result;
 }
 retain(source,rows){
  fs.mkdirSync(this.historyDir,{recursive:true});const db=new DatabaseSync(path.join(this.historyDir,'external-history.sqlite'));
  try{
   db.exec('CREATE TABLE IF NOT EXISTS usage(source TEXT,id TEXT,time REAL,data TEXT,PRIMARY KEY(source,id));CREATE INDEX IF NOT EXISTS usage_time ON usage(time);');
   const incremental=source==='opencode'||source==='opencode:activity'||source==='zcode';
   const put=db.prepare(incremental?'INSERT INTO usage VALUES(?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET time=excluded.time,data=excluded.data WHERE usage.time IS NOT excluded.time OR usage.data IS NOT excluded.data':'INSERT OR REPLACE INTO usage VALUES(?,?,?,?)');db.exec('BEGIN');
   const occurrences=new Map();
   for(const row of rows){const base=JSON.stringify([row.model,row.sessionId,row.time]),n=occurrences.get(base)||0;occurrences.set(base,n+1);const id=row.usageId||base+':'+n;put.run(source,id,row.time,JSON.stringify(row));}
   if(source==='grok'){
    const metered=new Set(rows.filter(r=>r.requests>0).map(r=>r.sessionId));
    for(const item of db.prepare('SELECT id,data FROM usage WHERE source=?').all(source)){const r=JSON.parse(item.data);if(!r.requests&&metered.has(r.sessionId))db.prepare('DELETE FROM usage WHERE source=? AND id=?').run(source,item.id);}
   }
   if(source==='opencode'){
    // A later native step record replaces the legacy message fallback for that call.
    const measured=new Set(rows.filter(row=>row.measurement==='step').map(row=>row.nativeMessageId));
    for(const item of db.prepare('SELECT id,data FROM usage WHERE source=?').all(source)){const row=JSON.parse(item.data);if(row.measurement==='message'&&measured.has(row.nativeMessageId))db.prepare('DELETE FROM usage WHERE source=? AND id=?').run(source,item.id);}
   }
   db.exec('COMMIT');return db.prepare('SELECT data FROM usage WHERE source=?').all(source).map(r=>JSON.parse(r.data));
  }finally{db.close();}
 }
 zcode(range,bounds){
  const recent=this.cache.get('zcode');let data=recent;
  if(!recent||Date.now()-recent.checkedAt>=this.refreshMs){
   const native=readZcodeUsage(this.home,{environment:this.environment}),rows=this.retain('zcode',native.rows);
   data={rows,coverage:{...native.coverage,available:native.coverage.available||rows.length>0,historyOnly:!native.coverage.available&&rows.length>0},checkedAt:Date.now()};this.cache.set('zcode',data);
  }
  return {...harnessSummary('zcode',data.rows,calendarRange(range,Date.now(),bounds),data.coverage),range};
 }

 opencode(range,bounds){
  const home=path.join(this.environment.XDG_DATA_HOME||path.join(this.home,'.local','share'),'opencode'),signature=openCodeSourceStamp(home);
  let data=this.cache.get('opencode'),checkedAt=Date.now();const cached=data?.signature===signature;
  if(!cached){
   const native=readOpenCodeUsage(home),readAt=Date.now(),sourceChangedDuringRead=signature!==openCodeSourceStamp(home);
   checkedAt=Date.now();
   // Metadata-only writes and WAL checkpoints do not require saving the same metering rows again.
   const rows=data&&isDeepStrictEqual(data.nativeRows,native.rows)?data.rows:this.retain('opencode',native.rows);
   const events=data&&isDeepStrictEqual(data.nativeEvents,native.events)?data.events:this.retain('opencode:activity',native.events);
   const retained=rows.length>0||events.length>0;
   // Keep the pre-read stamp so a concurrent commit is checked again by the next request.
   data={signature,rows,events,nativeRows:native.rows,nativeEvents:native.events,readAt,sourceChangedDuringRead,coverage:{...native.coverage,available:native.coverage.available||retained,historyOnly:!native.coverage.available&&retained}};this.cache.set('opencode',data);
  }
  data.checkedAt=checkedAt;
  const window=calendarRange(range,Date.now(),bounds);
  return {...harnessSummary('opencode',data.rows,window,data.coverage),range,activity:openCodeActivitySummary(data.events,data.rows,window,data.coverage),freshness:{readAt:data.readAt,checkedAt:data.checkedAt,cached,sourceChangedDuringRead:data.sourceChangedDuringRead}};
 }
 async summary(source,range='week',bounds={}){if(!['zcode','claude','grok','deepseek','hermes','opencode','pi','research'].includes(source))throw new Error('统计来源无效');if(source==='opencode')return this.opencode(range,bounds);if(['pi','research'].includes(source)){
   let data=this.cache.get(source);
   if(!data||Date.now()-data.checkedAt>=this.refreshMs){
    const researchDir=this.environment.AA_DATA_DIR||path.join(this.home,'.autoacademic');
    const native=source==='pi'?await readPiUsage(this.home,this.environment):readResearchAgentUsage(researchDir),rows=this.retain(source,native.rows);
    data={rows,coverage:{...native.coverage,available:native.coverage.available||rows.length>0,historyOnly:!native.coverage.available&&rows.length>0},checkedAt:Date.now()};this.cache.set(source,data);
   }
   return {...harnessSummary(source,data.rows,calendarRange(range,Date.now(),bounds),data.coverage),range};
 }if(['deepseek','hermes'].includes(source)){
   const home=source==='deepseek'?process.env.DSH_HOME||path.join(this.home,'.dsh'):process.env.HERMES_HOME||path.join(process.env.LOCALAPPDATA||path.join(this.home,'AppData','Local'),'hermes');
   const recent=this.cache.get(source);let data=recent;
   if(!recent||Date.now()-recent.checkedAt>=this.refreshMs){const native=source==='hermes'?readHermesUsage(home):readDeepSeekUsage(home),saved=this.retain(source,native.rows);data={rows:saved,coverage:{...native.coverage,available:native.coverage.available||saved.length>0,historyOnly:!native.coverage.available&&saved.length>0},checkedAt:Date.now()};this.cache.set(source,data);}
   return {...harnessSummary(source,data.rows,calendarRange(range,Date.now(),bounds),data.coverage),range};
 }if(source==='zcode')return this.zcode(range,bounds);const data=await this.records(source);return finish(source,range,bounds,data.rows,{kind:'tokens',available:true,reasoningIncludedInOutput:true,meteredSessions:data.meteredSessions,activityOnlySessions:data.activityOnlySessions});}
}
