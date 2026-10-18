import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync, backup} from 'node:sqlite';
import {createZstdCompress} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {once} from 'node:events';
import {atomicWrite} from './catalog.mjs';
import {resolveRollout,rolloutChunks} from './rollout-reader.mjs';

const ROUTER='aimami_local';
const read=(p,fallback)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
async function firstMeta(file){
  const parts=[];let size=0;for await(const chunk of rolloutChunks(file)){const piece=chunk.subarray(0,1024*1024-size);parts.push(piece);size+=piece.length;if(size>=1024*1024)break;}
  const b=Buffer.concat(parts),end=b.indexOf(10);if(end<0)throw new Error('会话首行缺失或超过 1 MB');const row=JSON.parse(b.subarray(0,end).toString().replace(/^\uFEFF/,''));if(row.type!=='session_meta'||!row.payload?.id)throw new Error('会话缺少 session_meta');let firstModel=null;const tail=b.subarray(end+1).toString();for(const line of tail.split('\n').slice(0,-1)){try{const item=JSON.parse(line);if(item.type==='turn_context'&&typeof item.payload?.model==='string'){firstModel=item.payload.model;break;}}catch{}}return {...row.payload,firstModel};
}

// Oversized message lines pass through unchanged; metadata edits use bounded memory.
async function rewrite(file,temp,id,source,target,fallback,onBytes=()=>{},router=ROUTER,allowedModels=null){
  const compressed=file.endsWith('.jsonl.zst'),out=compressed?createZstdCompress():fs.openSync(temp,'wx');
  const pumping=compressed?pipeline(out,fs.createWriteStream(temp,{flags:'wx'})):null;pumping?.catch(()=>{});
  const write=async data=>{if(compressed){if(!out.write(data))await once(out,'drain');}else fs.writeSync(out,data);};
  let parts=[],size=0,passing=false,changes=0;
  const flush=async()=>{for(const p of parts)await write(p);parts=[];size=0;};
  try{for await(const chunk of rolloutChunks(file,{onBytes})){
    let start=0;while(start<chunk.length){const end=chunk.indexOf(10,start),last=end<0,piece=chunk.subarray(start,last?chunk.length:end+1);start=last?chunk.length:end+1;
      if(passing){await write(piece);if(!last)passing=false;continue;}
      parts.push(piece);size+=piece.length;if(size>1024*1024){await flush();passing=last;continue;}if(last)continue;
      const raw=Buffer.concat(parts);let row;try{row=JSON.parse(raw.toString().replace(/^\uFEFF/,''));}catch{}
      let changed=false;
      if(row?.type==='session_meta'&&row.payload?.id===id&&(row.payload.model_provider||'openai')===source){row.payload.model_provider=target;changed=true;}
      if(fallback&&row?.type==='turn_context'&&typeof row.payload?.model==='string'&&(allowedModels?!allowedModels.includes(row.payload.model):((target===router&&!row.payload.model.includes('::'))||(target!==router&&row.payload.model.includes('::'))))){row.payload.model=fallback;changed=true;}
      if(changed){await write(JSON.stringify(row)+(raw.at(-2)===13?'\r\n':'\n'));changes++;parts=[];size=0;}else await flush();
    }
  }await flush();if(compressed){out.end();await pumping;const fd=fs.openSync(temp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}else fs.fsyncSync(out);return changes;}finally{if(compressed){out.destroy();await pumping.catch(()=>{});}else fs.closeSync(out);}
}

export class ThreadMigration {
  constructor(store,{providerId=ROUTER,ledgerName='providers.json'}={}){this.store=store;this.providerId=providerId;this.dir=path.join(store.dir,'thread-migration');if(!['providers.json','official-http-providers.json'].includes(ledgerName))throw new Error('无效迁移账本');this.ledger=path.join(this.dir,ledgerName);this.pending=path.join(this.dir,'pending.json');}
  inventory(){
    const rows=[],dbs=[];
    for(const name of fs.readdirSync(this.store.home).filter(n=>/^state_\d+\.sqlite$/.test(n))){const file=fs.realpathSync.native(path.join(this.store.home,name));if(dbs.includes(file))continue;dbs.push(file);const db=new DatabaseSync(file,{readOnly:true});try{const cols=db.prepare('PRAGMA table_info(threads)').all().map(c=>c.name);if(!cols.includes('model_provider')||!cols.includes('rollout_path'))throw new Error('会话数据库结构不支持迁移');rows.push(...db.prepare(`SELECT id,model_provider,rollout_path${cols.includes('model')?',model':''} FROM threads`).all().map(r=>({...r,db:file,hasModel:cols.includes('model')})));}finally{db.close();}}
    const files=new Set();
    for(const name of ['sessions','archived_sessions']){const root=path.join(this.store.home,name);if(!fs.existsSync(root))continue;const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(e.isFile()&&/\.jsonl(?:\.zst)?$/.test(e.name))files.add(resolveRollout(file));}};walk(root);}
    // The database is authoritative for relocated rollout files, including junction targets.
    for(const r of rows){try{if(r.rollout_path){r.resolvedRollout=resolveRollout(r.rollout_path);files.add(r.resolvedRollout);}}catch(e){if(e.code!=='ENOENT')throw e;}}
    return {rows,files:[...files],dbs};
  }
  async plan(enabled,fallback,{rewriteExisting=false,allowOfficial=false,sourceProviders=null,allowedModels=null,restoreTo=null}={}){
    if(fs.existsSync(this.pending))throw new Error('上次迁移未完成，请先恢复迁移');
    const ledger=read(this.ledger,{version:1,originals:{}}),inventory=this.inventory(),files=[],rows=[];
    const ROUTER=this.providerId;
    const target=(id,p,file)=>enabled?(p===ROUTER?(rewriteExisting?ROUTER:null):(!sourceProviders||sourceProviders.includes(p)?ROUTER:null)):(p===ROUTER?(restoreTo||(file&&ledger.fileOriginals?.[file])||ledger.originals[id]||'openai'):null);
    const metadata=new Map();for(const file of inventory.files){const meta=await firstMeta(file);metadata.set(file,meta);const to=target(meta.id,meta.model_provider||'openai',file);if(!to)continue;const st=fs.statSync(file);files.push({file,id:meta.id,source:meta.model_provider||'openai',target:to,firstModel:meta.firstModel,size:st.size,mtime:st.mtimeMs});}
    for(const r of inventory.rows){const to=target(r.id,r.model_provider||'openai');if(!to)continue;if(!r.resolvedRollout)throw new Error(`会话 ${r.id} 的文件缺失，未执行迁移`);const changeModel=allowedModels?r.hasModel&&r.model&&!allowedModels.includes(r.model):enabled?!allowOfficial&&r.hasModel&&r.model&&!r.model.includes('::'):r.hasModel&&r.model?.includes('::');rows.push({...r,target:to,nextModel:changeModel?(enabled||allowedModels?fallback:ledger.models?.[r.id]||fallback):r.model});}
    // Historical rollout copies can share an ID while retaining different providers.
    // Restore those files individually; only the database-owned rollout must agree.
    const originals={},fileOriginals={},models={},fileModels={};
    for(const f of files){if(f.source!==ROUTER)fileOriginals[f.file]=f.source;if(enabled&&f.firstModel&&!f.firstModel.includes('::'))fileModels[f.file]=f.firstModel;}
    for(const r of rows){if(r.model_provider!==ROUTER)originals[r.id]=r.model_provider||'openai';if(enabled&&r.model&&!r.model.includes('::'))models[r.id]=r.model;const meta=metadata.get(r.resolvedRollout);if(meta.id!==r.id||(meta.model_provider||'openai')!==(r.model_provider||'openai'))throw new Error(`会话 ${r.id} 的索引与当前文件不一致`);}
    return {enabled,fallback,allowOfficial,allowedModels,files,rows,dbs:inventory.dbs,ledger,originals,fileOriginals,models,fileModels,bytes:files.reduce((n,f)=>n+f.size,0)};
  }
  async apply(plan,changeConfig,onProgress=()=>{}){
    let bytesDone=0,filesDone=0;const report=(phase,extra={})=>onProgress({phase,bytesDone,bytesTotal:plan.bytes,filesDone,filesTotal:plan.files.length,...extra});report('backup');
    if(!plan.files.length&&!plan.rows.length)return {...await changeConfig(),migration:{threads:0,files:0,bytes:0}};
    fs.mkdirSync(this.dir,{recursive:true});const run=path.join(this.dir,String(Date.now()));fs.mkdirSync(run);const configBefore=fs.readFileSync(this.store.config,'utf8');
    const journal={phase:'preparing',configBefore,ledgerBefore:plan.ledger,ledgerName:path.basename(this.ledger),rows:plan.rows,files:plan.files.map((f,i)=>({...f,temp:path.join(path.dirname(f.file),`.local-console-${path.basename(run)}-${i}.tmp`),original:path.join(path.dirname(f.file),`.local-console-${path.basename(run)}-${i}.bak`)}))};
    atomicWrite(this.pending,journal);
    try{
      for(let i=0;i<plan.dbs.length;i++){const db=new DatabaseSync(plan.dbs[i],{readOnly:true});try{await backup(db,path.join(run,`state-${i}.sqlite`));}finally{db.close();}}
      for(const f of journal.files){const st=fs.statSync(f.file);if(st.size!==f.size||st.mtimeMs!==f.mtime)throw new Error('会话文件变化，请重新执行');report('files',{currentFile:path.basename(f.file)});const model=plan.allowedModels?plan.fallback:plan.enabled?(plan.allowOfficial?null:plan.fallback):plan.ledger.fileModels?.[f.file]||plan.ledger.models?.[f.id]||plan.fallback;await rewrite(f.file,f.temp,f.id,f.source,f.target,model,n=>{bytesDone+=n;report('files',{currentFile:path.basename(f.file)});},this.providerId,plan.allowedModels);filesDone++;report('files');const after=fs.statSync(f.file);if(after.size!==f.size||after.mtimeMs!==f.mtime)throw new Error('迁移期间会话仍被写入，请关闭 Codex');}
      report('commit');journal.phase='applying';atomicWrite(this.pending,journal);
      for(const f of journal.files){fs.renameSync(f.file,f.original);fs.renameSync(f.temp,f.file);}
      for(const file of plan.dbs){const db=new DatabaseSync(file);try{db.exec('BEGIN IMMEDIATE');for(const r of plan.rows.filter(r=>r.db===file)){const result=r.hasModel?db.prepare('UPDATE threads SET model_provider=?,model=? WHERE id=? AND model_provider IS ? AND model IS ?').run(r.target,r.nextModel??null,r.id,r.model_provider,r.model??null):db.prepare('UPDATE threads SET model_provider=? WHERE id=? AND model_provider IS ?').run(r.target,r.id,r.model_provider);if(result.changes!==1)throw new Error('会话数据库变化，请重新执行');}db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}}
      report('config');const result=await changeConfig();const ledger=plan.enabled?{version:1,originals:{...plan.originals,...plan.ledger.originals},fileOriginals:{...plan.fileOriginals,...plan.ledger.fileOriginals},models:{...plan.models,...plan.ledger.models},fileModels:{...plan.fileModels,...plan.ledger.fileModels}}:{version:1,originals:{}};atomicWrite(this.ledger,ledger);
      journal.phase='committed';atomicWrite(this.pending,journal);this.finish(journal);return {...result,migration:{threads:new Set([...plan.files,...plan.rows].map(r=>r.id)).size,files:plan.files.length,bytes:plan.bytes,backupDirectory:run}};
    }catch(e){if(journal.phase!=='committed'){report('rollback');this.recover();}throw e;}
  }
  finish(j){for(const f of j.files)for(const p of [f.temp,f.original])if(fs.existsSync(p))fs.unlinkSync(p);fs.unlinkSync(this.pending);}
  recover(){
    const j=read(this.pending,null);if(!j)return {recovered:false};if(j.phase==='committed'){this.finish(j);return {recovered:true};}
    for(const file of new Set(j.rows.map(r=>r.db))){const db=new DatabaseSync(file);try{db.exec('BEGIN IMMEDIATE');for(const r of j.rows.filter(r=>r.db===file)){if(r.hasModel)db.prepare('UPDATE threads SET model_provider=?,model=? WHERE id=? AND model_provider=?').run(r.model_provider,r.model??null,r.id,r.target);else db.prepare('UPDATE threads SET model_provider=? WHERE id=? AND model_provider=?').run(r.model_provider,r.id,r.target);}db.exec('COMMIT');}finally{db.close();}}
    for(const f of j.files){if(fs.existsSync(f.original)){if(fs.existsSync(f.file))fs.unlinkSync(f.file);fs.renameSync(f.original,f.file);}if(fs.existsSync(f.temp))fs.unlinkSync(f.temp);}
    if(j.ledgerName&&!['providers.json','official-http-providers.json'].includes(j.ledgerName))throw new Error('无效迁移账本');
    this.store.writeConfig(j.configBefore);atomicWrite(j.ledgerName?path.join(this.dir,j.ledgerName):this.ledger,j.ledgerBefore);fs.unlinkSync(this.pending);return {recovered:true};
  }
}

