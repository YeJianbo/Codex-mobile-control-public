import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {Worker} from 'node:worker_threads';
import {calendarRange,normalizeAnalyticsTier} from './analytics-core.mjs';import {tokenSpeedStats} from './token-speed.mjs';

export function nativeSpeedDb(file){const db=new DatabaseSync(file);db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=1000;
CREATE TABLE IF NOT EXISTS items(session TEXT,item TEXT,turn_id TEXT,model TEXT,start_ms INTEGER,end_ms INTEGER,tokens INTEGER,characters INTEGER,reason TEXT,PRIMARY KEY(session,item));
CREATE INDEX IF NOT EXISTS items_end ON items(end_ms);
CREATE TABLE IF NOT EXISTS cursors(session TEXT PRIMARY KEY,ordinal INTEGER);
CREATE TABLE IF NOT EXISTS reasoning_cursors(session TEXT PRIMARY KEY,ordinal INTEGER);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT,cwd TEXT,provider TEXT);`);
const columns=new Set(db.prepare('PRAGMA table_info(items)').all().map(c=>c.name));let reindex=false;
for(const name of ['tier','effort','phase'])if(!columns.has(name)){db.exec('ALTER TABLE items ADD COLUMN '+name+' TEXT');if(name!=='tier')reindex=true;}
if(reindex)db.exec('DELETE FROM cursors');
db.exec('CREATE INDEX IF NOT EXISTS items_timestamp ON items(COALESCE(end_ms,start_ms))');
db.exec('CREATE INDEX IF NOT EXISTS items_request ON items(session,turn_id,model,end_ms)');
return db;}
export function nativeSpeedRow(row,model,encode,tier=null,effort=null){
  const start=row.started_at_ms,end=row.completed_at_ms;let reason=null,tokens=null,characters=null,phase=row.item_type==='reasoning'?'reasoning':null;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)reason='missing-stream-time';
  else if(row.item_type==='reasoning'){reason='reasoning-timing';phase='reasoning';}
  else {try{const item=JSON.parse(row.item_json),text=item.text;phase=typeof item.phase==='string'?item.phase:null;if(typeof text!=='string'||!text.length)reason='empty-text';else if(text.length>262144)reason='oversized-text';else{tokens=encode(text);characters=Array.from(text).length;}}catch{reason='invalid-item';}}
  return {session:row.thread_id,item:row.item_id,turn:row.turn_id,model,tier:normalizeAnalyticsTier(tier),effort:typeof effort==='string'?effort:null,phase,start,end,tokens,characters,reason};
}
export function nativeDimensionsAt(events,turn,end){
  const rows=events.get(turn)||[];
  // A short final message can finish after the turn's last token-count event.
  // Stay within this turn; never infer its model or tier from current settings.
  const row=rows.find(r=>r.time>=end-1000)??rows.at(-1);
  return {model:row?.model||null,tier:normalizeAnalyticsTier(row?.tier),effort:row?.effort||null};
}
export function nativeModelAt(events,turn,end){return nativeDimensionsAt(events,turn,end).model;}
export function nativeSessionTitle(thread){
  const clean=value=>{
    let text=String(value||'').trim();
    const request=text.match(/(?:^|\n)#{1,6}\s*My request:\s*\n([\s\S]*)/i);
    if(request)text=request[1];
    else if(/^<heartbeat[\s>]/i.test(text))text=text.match(/<instructions>\s*([\s\S]*?)\s*<\/instructions>/i)?.[1]||'';
    text=text.replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/gi,'')
      .split(/(?:^|\n)(?:#{1,6}\s*)?(?:Files (?:pasted|mentioned) by the user:|Referenced pasted text files:)/i)[0]
      .replace(/^\s*\/goal\s+/i,'').replace(/^\s*#{1,6}\s+/,'').replace(/\s+/g,' ').trim();
    return text.length>100?text.slice(0,99)+'…':text;
  };
  for(const value of [thread.name,thread.preview,thread.title,thread.first_user_message]){const title=clean(value);if(title)return title;}
  if(thread.agent_nickname||thread.agent_path){const task=thread.agent_path?.split('/').filter(Boolean).at(-1);return ['子代理 '+(thread.agent_nickname||thread.agent_role||'任务'),task&&task!=='root'?task:null].filter(Boolean).join(' · ');}
  const project=thread.cwd?.replace(/[\\/]+$/,'').split(/[\\/]/).at(-1);
  return project?'未命名会话 · '+project:'未命名会话';
}
function sourceStamp(home,analyticsFile){
  const files=fs.readdirSync(home).filter(name=>/^(thread_history|state)_\d+\.sqlite$/.test(name)).flatMap(name=>[path.join(home,name),path.join(home,name+'-wal')]);
  files.push(analyticsFile,analyticsFile+'-wal');
  return JSON.stringify(files.sort().map(file=>{try{const stat=fs.statSync(file);return stat.size===0&&file.endsWith('-wal')?[file,null]:[file,stat.size,stat.mtimeMs];}catch(e){if(e.code==='ENOENT')return [file,null];throw e;}}));
}
export class NativeSpeedService{
  constructor(home,dir){this.home=home;this.dir=dir;fs.mkdirSync(dir,{recursive:true});this.file=path.join(dir,'native-speed.sqlite');this.db=nativeSpeedDb(this.file);this.worker=null;this.progress={running:false};this.lastStarted=0;this.closed=false;this.summaryCache=new Map();}
  start(force=false){if(this.closed||this.worker||!force&&Date.now()-this.lastStarted<30000)return;this.lastStarted=Date.now();const analyticsFile=path.join(this.dir,'analytics','activity.sqlite'),stamp=sourceStamp(this.home,analyticsFile);if(!force&&stamp===this.lastSourceStamp)return;this.progress={running:true,completedThreads:0,items:0};this.worker=new Worker(new URL('./native-speed-worker.mjs',import.meta.url),{workerData:{home:this.home,file:this.file,analyticsFile},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128}});this.worker.on('message',m=>{this.progress={...this.progress,...m};});this.worker.on('error',e=>{this.progress={...this.progress,running:false,error:e.message};});this.worker.on('exit',code=>{if(code===0&&!this.progress.error&&!this.progress.cancelled&&this.progress.available===true)this.lastSourceStamp=stamp;this.worker=null;this.progress.running=false;});}
  summary(range='week',bounds={},filters={}){
    const now=Date.now(),{since,until}=calendarRange(range,now,bounds);
    // Concurrent polls share numeric aggregates; worker commits invalidate them immediately.
    const version=this.db.prepare('PRAGMA data_version').get().data_version,changes=this.db.prepare('SELECT total_changes() n').get().n;
    const key=JSON.stringify([range,bounds,since,filters.model||'all',version,changes]),cached=this.summaryCache.get(key);
    if(cached&&now-cached.at<5000)return {...cached.result,coverage:{...cached.result.coverage,available:this.progress.available!==false},progress:this.progress};
    const rows=this.db.prepare("SELECT * FROM items WHERE COALESCE(end_ms,start_ms)>=? AND COALESCE(end_ms,start_ms)<=? AND COALESCE(phase,'')<>'reasoning'").all(since,until);
    const stats=tokenSpeedStats(rows.map(r=>({timestamp:(r.end_ms||r.start_ms)/1000,model:r.model,tier:r.tier,effort:r.effort,phase:r.phase,provider:null,status:200,outputTokens:r.reason?null:r.tokens,durationMs:r.reason?null:r.end_ms-r.start_ms,session:r.session})),{model:filters.model||'all'});
    const titles=new Map(this.db.prepare('SELECT * FROM sessions').all().map(r=>[r.id,r]));
    const measured=rows.filter(r=>!r.reason&&r.tokens>0&&r.end_ms>r.start_ms&&(!filters.model||filters.model==='all'||filters.model==='v:'+r.model||filters.model==='missing'&&r.model==null));
    for(const group of stats.groups){const sessions=new Map();for(const row of measured.filter(r=>r.model===group.model&&r.tier===group.tier&&r.effort===group.effort&&r.phase===group.phase)){if(!sessions.has(row.session))sessions.set(row.session,[]);sessions.get(row.session).push({timestamp:row.end_ms/1000,status:200,outputTokens:row.tokens,durationMs:row.end_ms-row.start_ms});}group.sessions=[...sessions].map(([id,items])=>({id,title:titles.get(id)?.title||'会话 '+id.slice(0,8),cwd:titles.get(id)?.cwd||'',lastAt:Math.max(...items.map(r=>r.timestamp)),...tokenSpeedStats(items).totals})).sort((a,b)=>b.lastAt-a.lastAt);group.sessionCount=group.sessions.length;}
    const result={...stats,scope:'codex-native-history',definition:'visible-text-estimate',encoding:'o200k_base',source:'native',coverage:{...stats.coverage,available:this.progress.available!==false},progress:this.progress,filters:{...stats.filters,source:'native'}};
    if(this.summaryCache.size>=16)this.summaryCache.clear();
    this.summaryCache.set(key,{at:now,result});return result;
  }
  close(){this.closed=true;this.worker?.postMessage('cancel');this.db.close();}
}


