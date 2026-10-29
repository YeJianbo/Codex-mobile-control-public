import fs from 'node:fs';import path from 'node:path';import {parentPort,workerData} from 'node:worker_threads';
import {canonicalRollout,rolloutChunks} from './rollout-reader.mjs';
import {analyticsDb} from './analytics-db.mjs';import {initialAnalyticsState,parseAnalyticsRecord,ANALYTICS_DIMENSION_VERSION} from './analytics-core.mjs';
const db=analyticsDb(workerData.db);let cancelled=false;parentPort.on('message',m=>{if(m==='cancel')cancelled=true;});
const wait=ms=>new Promise(r=>setTimeout(r,ms));const CHUNK=256*1024,MAX_LINE=1024*1024;
async function inventory(){const files=new Map();async function walk(dir,archived){let entries;try{entries=await fs.promises.readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}for(const e of entries){if(cancelled)return;const file=path.join(dir,e.name);if(e.isDirectory())await walk(file,archived);else if(e.isFile()&&e.name.startsWith('rollout-')&&/\.jsonl(?:\.zst)?$/.test(e.name)){let st;try{st=await fs.promises.stat(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}const logical=canonicalRollout(file),compressed=file.endsWith('.zst');if(!files.has(logical)||!compressed)files.set(logical,{path:logical,source:file,compressed,size:st.size,mtime:st.mtimeMs,identity:`${compressed?'zst:':''}${st.dev}:${st.ino}:${st.birthtimeMs}`,archived});}}}await walk(path.join(workerData.home,'sessions'),0);await walk(path.join(workerData.home,'archived_sessions'),1);return [...files.values()].sort((a,b)=>b.mtime-a.mtime);}
const insertEvent=db.prepare('INSERT INTO events(key,kind,time,session,input,cached,output,reasoning,tool,category,model,effort,tier,credit_meter,dim_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,3) ON CONFLICT(key) DO UPDATE SET model=excluded.model,effort=excluded.effort,tier=excluded.tier,credit_meter=COALESCE(events.credit_meter,excluded.credit_meter),dim_version=3 WHERE events.kind=\'token\' AND (events.dim_version<3 OR events.credit_meter IS NULL)');
const insertRef=db.prepare('INSERT OR IGNORE INTO refs(path,key) VALUES(?,?)');
const save=db.prepare('INSERT OR REPLACE INTO files(path,identity,size,mtime,offset,state,session,created,skipped,archived) VALUES(?,?,?,?,?,?,?,?,?,?)');
const read=db.prepare('SELECT * FROM files WHERE path=?');
let totalBytes=0,doneBytes=0,readBytes=0,completedFiles=0,lastReport=0;
function report(extra={}){parentPort.postMessage({type:'progress',totalBytes,doneBytes,readBytes,completedFiles,...extra});lastReport=Date.now();}
async function indexCompressed(file,fileCount){
  const old=read.get(file.path);let cached;try{cached=JSON.parse(old?.state);}catch{}
  if(!workerData.rebuild&&old?.identity===file.identity&&old.size===file.size&&old.mtime===file.mtime&&cached?.complete&&cached.dimensionVersion===ANALYTICS_DIMENSION_VERSION&&cached.skillVersion===1){doneBytes+=file.size;completedFiles++;return;}
  const state=initialAnalyticsState();let position=0,carry=Buffer.alloc(0),discard=false,timeAtStart=Date.now();
  // A compressed stream has no cheap seek checkpoint. Commit its numeric records
  // together so a truncated frame or cancellation cannot erase a valid index.
  db.exec('BEGIN');
  try{
    db.prepare('DELETE FROM refs WHERE path=?').run(file.path);
    if(old)db.exec('DELETE FROM events WHERE key NOT IN (SELECT key FROM refs)');
    for await(const chunk of rolloutChunks(file.source,{onBytes:n=>{readBytes+=n;doneBytes+=n;}})){
      if(cancelled)throw Object.assign(new Error('cancelled'),{cancelled:true});
      position+=chunk.length;const bytes=carry.length?Buffer.concat([carry,chunk]):chunk,base=position-bytes.length;let start=0,end;
      while((end=bytes.indexOf(10,start))!==-1){
        const line=bytes.subarray(start,end);
        if(discard){state.skipped++;discard=false;}else if(line.length>MAX_LINE){state.skipped++;}
        else{try{for(const e of parseAnalyticsRecord(JSON.parse(line.toString('utf8')),state,base+start)){insertEvent.run(e.key,e.kind,e.time,e.session,e.input||0,e.cached||0,e.output||0,e.reasoning||0,e.tool||null,e.category||null,e.model||null,e.effort||null,e.tier||null,e.creditMeter?JSON.stringify(e.creditMeter):null);insertRef.run(file.path,e.key);}}catch{state.skipped++;}}
        start=end+1;
      }
      carry=bytes.subarray(start);if(carry.length>MAX_LINE){discard=true;carry=Buffer.alloc(0);}else if(discard)carry=Buffer.alloc(0);
      if(Date.now()-lastReport>500)report({fileCount,currentFile:path.basename(file.source)});
      const throttle=position/(24*1024*1024)*1000-(Date.now()-timeAtStart);await wait(Math.max(1,Math.min(50,throttle)));
    }
    if(cancelled)throw Object.assign(new Error('cancelled'),{cancelled:true});
    const after=await fs.promises.stat(file.source);
    if(after.size!==file.size||after.mtimeMs!==file.mtime)throw new Error('压缩日志读取期间发生变化');
    state.complete=true;save.run(file.path,file.identity,file.size,file.mtime,file.size,JSON.stringify(state),state.id,state.created,state.skipped,file.archived);
    db.exec('COMMIT');completedFiles++;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
try{
  const files=await inventory();if(cancelled)throw Object.assign(new Error('cancelled'),{cancelled:true});totalBytes=files.reduce((s,f)=>s+f.size,0);
  // Missing rollouts retain their numeric events and references as usage history.
  report({fileCount:files.length});
  for(const file of files){if(cancelled)break;if(file.compressed){await indexCompressed(file,files.length);continue;}let old=read.get(file.path),state,offset;
    const reset=workerData.rebuild||!old||old.identity!==file.identity||file.size<old.offset||(file.size===old.size&&file.mtime!==old.mtime);
    if(reset){db.prepare('DELETE FROM refs WHERE path=?').run(file.path);if(old)db.exec('DELETE FROM events WHERE key NOT IN (SELECT key FROM refs)');state=initialAnalyticsState();offset=0;}else {try{state=JSON.parse(old.state);}catch{state=initialAnalyticsState();}offset=old.offset;}
    if(!reset&&(state.dimensionVersion!==ANALYTICS_DIMENSION_VERSION||state.skillVersion!==1)){state=initialAnalyticsState();offset=0;}
    doneBytes+=offset;
    if(!reset&&state.complete&&file.size===old.size&&file.mtime===old.mtime){doneBytes+=file.size-offset;completedFiles++;continue;}state.complete=false;
    if(state.creditAccount===undefined&&file.mtime>=Date.now()-900000){
      const header=await fs.promises.open(file.path,'r');try{const bytes=Buffer.alloc(Math.min(file.size,MAX_LINE));const n=(await header.read(bytes,0,bytes.length,0)).bytesRead;const end=bytes.indexOf(10);if(end>=0&&end<n){const row=JSON.parse(bytes.subarray(0,end).toString('utf8'));if(row.type==='session_meta'){state.creditAccount=row.payload?.creator_account_id||null;state.creditProvider=row.payload?.model_provider||null;}}}catch{}finally{await header.close();}
    }
    const fd=await fs.promises.open(file.path,'r');let position=offset,committed=offset,lastSaved=-1,carry=Buffer.alloc(0),discard=false,readAtStart=readBytes,timeAtStart=Date.now();
    try{while(position<file.size&&!cancelled){const chunk=Buffer.allocUnsafe(Math.min(CHUNK,file.size-position));const n=(await fd.read(chunk,0,chunk.length,position)).bytesRead;if(!n)break;position+=n;readBytes+=n;doneBytes+=n;const bytes=carry.length?Buffer.concat([carry,chunk.subarray(0,n)]):chunk.subarray(0,n);const base=position-bytes.length;let start=0,end;db.exec('BEGIN');
      while((end=bytes.indexOf(10,start))!==-1){const line=bytes.subarray(start,end);if(discard){state.skipped++;discard=false;}else if(line.length>MAX_LINE){state.skipped++;}else {try{const record=JSON.parse(line.toString('utf8'));for(const e of parseAnalyticsRecord(record,state,base+start)){insertEvent.run(e.key,e.kind,e.time,e.session,e.input||0,e.cached||0,e.output||0,e.reasoning||0,e.tool||null,e.category||null,e.model||null,e.effort||null,e.tier||null,e.creditMeter?JSON.stringify(e.creditMeter):null);insertRef.run(file.path,e.key);}}catch{state.skipped++;}}committed=base+end+1;start=end+1;}
      carry=bytes.subarray(start);if(carry.length>MAX_LINE){discard=true;carry=Buffer.alloc(0);}else if(discard)carry=Buffer.alloc(0);
      // Checkpoints only advance to full line boundaries. No conversation text is persisted in this cache.
      if(committed!==lastSaved){save.run(file.path,file.identity,file.size,file.mtime,committed,JSON.stringify(state),state.id,state.created,state.skipped,file.archived);lastSaved=committed;}db.exec('COMMIT');
      if(Date.now()-lastReport>500)report({fileCount:files.length,currentFile:path.basename(file.path)});
      const throttle=(readBytes-readAtStart)/(24*1024*1024)*1000-(Date.now()-timeAtStart);await wait(Math.max(1,Math.min(50,throttle)));
    }}finally{await fd.close();}
    state.complete=position>=file.size&&!cancelled;save.run(file.path,file.identity,file.size,file.mtime,committed,JSON.stringify(state),state.id,state.created,state.skipped,file.archived);completedFiles++;
  }
  db.exec('DELETE FROM events WHERE key NOT IN (SELECT key FROM refs)');report({fileCount:files.length});parentPort.postMessage({type:'done',cancelled,at:new Date().toISOString()});
}catch(e){try{db.exec('ROLLBACK');}catch{}parentPort.postMessage(e.cancelled?{type:'done',cancelled:true,at:new Date().toISOString()}:{type:'failure',message:e.message});}finally{db.close();parentPort.close();}
