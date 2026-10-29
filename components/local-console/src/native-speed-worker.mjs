import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {parentPort,workerData} from 'node:worker_threads';
import {nativeSpeedDb,nativeSpeedRow,nativeDimensionsAt,nativeSessionTitle} from './native-speed.mjs';
let cancelled=false;parentPort.on('message',m=>{if(m==='cancel')cancelled=true;});
const cache=nativeSpeedDb(workerData.file);let history,state,analytics,encoder;
function newest(prefix){return fs.readdirSync(workerData.home).filter(n=>new RegExp('^'+prefix+'_[0-9]+[.]sqlite$').test(n)).sort((a,b)=>Number(b.match(/_(\d+)[.]sqlite$/)[1])-Number(a.match(/_(\d+)[.]sqlite$/)[1]))[0];}
try{
  const historyName=newest('thread_history'),stateName=newest('state');
  if(!historyName||!stateName){parentPort.postMessage({running:false,available:false});}
  else {
    history=new DatabaseSync(path.join(workerData.home,historyName),{readOnly:true});state=new DatabaseSync(path.join(workerData.home,stateName),{readOnly:true});
    for(const db of [history,state])db.exec('PRAGMA busy_timeout=1000;');
    if(fs.existsSync(workerData.analyticsFile))analytics=new DatabaseSync(workerData.analyticsFile,{readOnly:true});
    const columns=new Set(state.prepare('PRAGMA table_info(threads)').all().map(c=>c.name));
    const optional=['name','preview','first_user_message','agent_nickname','agent_role','agent_path'].map(c=>columns.has(c)?c:'NULL AS '+c).join(',');
    const threads=state.prepare('SELECT id,title,cwd,model_provider,'+optional+' FROM threads ORDER BY updated_at DESC').all();
    const query=history.prepare("SELECT thread_id,turn_id,item_id,item_json,started_at_ms,completed_at_ms,updated_at_ordinal FROM thread_items WHERE thread_id=? AND item_type='agentMessage' AND updated_at_ordinal>? ORDER BY updated_at_ordinal,item_id LIMIT 250");
    const reasoningQuery=history.prepare("SELECT thread_id,turn_id,item_id,item_type,started_at_ms,completed_at_ms,updated_at_ordinal FROM thread_items WHERE thread_id=? AND item_type='reasoning' AND updated_at_ordinal>? ORDER BY updated_at_ordinal,item_id LIMIT 250");
    const reasoningCursor=cache.prepare('INSERT OR REPLACE INTO reasoning_cursors VALUES(?,?)');
    const save=cache.prepare('INSERT OR REPLACE INTO items(session,item,turn_id,model,start_ms,end_ms,tokens,characters,reason,tier,effort,phase) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'),cursor=cache.prepare('INSERT OR REPLACE INTO cursors VALUES(?,?)'),title=cache.prepare('INSERT INTO sessions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,cwd=excluded.cwd,provider=excluded.provider WHERE sessions.title IS NOT excluded.title OR sessions.cwd IS NOT excluded.cwd OR sessions.provider IS NOT excluded.provider');
    let completedThreads=0,items=0,lastReport=0;
    for(const thread of threads){if(cancelled)break;title.run(thread.id,nativeSessionTitle(thread),thread.cwd||'',thread.model_provider||'');
      let offset=cache.prepare('SELECT ordinal FROM cursors WHERE session=?').get(thread.id)?.ordinal??-1;
      const max=history.prepare('SELECT MAX(updated_at_ordinal) n FROM thread_items WHERE thread_id=?').get(thread.id)?.n;if(max!=null&&max<offset)offset=-1;
      let reasoningOffset=cache.prepare('SELECT ordinal FROM reasoning_cursors WHERE session=?').get(thread.id)?.ordinal??-1;
      if(max!=null&&max<reasoningOffset)reasoningOffset=-1;
      const missing=cache.prepare('SELECT item,turn_id,end_ms FROM items WHERE session=? AND (model IS NULL OR tier IS NULL OR effort IS NULL)').all(thread.id);
      if((max==null||max===offset)&&(!analytics||!missing.length)&&(max==null||reasoningOffset===max)){completedThreads++;continue;}
      // 只按主键前缀找需要的 turn；+kind/+time 避免 SQLite 为排序选择日志时间索引而全表扫描。
      const events=new Map(),dimensionsAt=(turn,end)=>{if(analytics&&!events.has(turn)){const prefix='token:'+turn+':';try{events.set(turn,analytics.prepare("SELECT time,model,tier,effort FROM events WHERE key>=? AND key<? AND session=? AND +kind='token' AND (model IS NOT NULL OR tier IS NOT NULL) ORDER BY +time").all(prefix,prefix+'\uffff',thread.id));}catch{events.set(turn,[]);}}return nativeDimensionsAt(events,turn,end);};
      while(!cancelled){const batch=query.all(thread.id,offset);if(!batch.length){if(max!=null&&max!==offset)cursor.run(thread.id,max);break;}if(!encoder)encoder=(await import('tiktoken')).get_encoding('o200k_base');cache.exec('BEGIN');try{for(const row of batch){const dimensions=dimensionsAt(row.turn_id,row.completed_at_ms);const r=nativeSpeedRow(row,dimensions.model,text=>encoder.encode(text,[],[]).length,dimensions.tier,dimensions.effort);save.run(r.session,r.item,r.turn,r.model,r.start??null,r.end??null,r.tokens,r.characters,r.reason,r.tier,r.effort,r.phase);offset=row.updated_at_ordinal;items++;}cursor.run(thread.id,offset);cache.exec('COMMIT');}catch(e){cache.exec('ROLLBACK');throw e;}await new Promise(resolve=>setTimeout(resolve,5));}
      // Reasoning timestamps fill per-request speed gaps without reading or
      // retaining hidden reasoning text, and without re-tokenizing older answers.
      while(!cancelled){
        const batch=reasoningQuery.all(thread.id,reasoningOffset);
        if(!batch.length){if(max!=null&&max!==reasoningOffset)reasoningCursor.run(thread.id,max);break;}
        cache.exec('BEGIN');
        try{
          for(const row of batch){
            const dimensions=dimensionsAt(row.turn_id,row.completed_at_ms),r=nativeSpeedRow(row,dimensions.model,null,dimensions.tier,dimensions.effort);
            save.run(r.session,r.item,r.turn,r.model,r.start??null,r.end??null,r.tokens,r.characters,r.reason,r.tier,r.effort,r.phase);
            reasoningOffset=row.updated_at_ordinal;items++;
          }
          reasoningCursor.run(thread.id,reasoningOffset);cache.exec('COMMIT');
        }catch(error){cache.exec('ROLLBACK');throw error;}
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      const updates=[];
      for(const row of cache.prepare('SELECT item,turn_id,end_ms,model,tier,effort FROM items WHERE session=? AND (model IS NULL OR tier IS NULL OR effort IS NULL)').all(thread.id)){
        const {model,tier,effort}=dimensionsAt(row.turn_id,row.end_ms);
        if(row.model==null&&model||row.tier==null&&tier||row.effort==null&&effort)updates.push([model,tier,effort,thread.id,row.item]);
      }
      if(updates.length){
        const fill=cache.prepare('UPDATE items SET model=COALESCE(model,?),tier=COALESCE(tier,?),effort=COALESCE(effort,?) WHERE session=? AND item=?');
        cache.exec('BEGIN');try{for(const values of updates)fill.run(...values);cache.exec('COMMIT');}catch(error){cache.exec('ROLLBACK');throw error;}
      }
      completedThreads++;if(Date.now()-lastReport>500){parentPort.postMessage({running:true,available:true,completedThreads,totalThreads:threads.length,items});lastReport=Date.now();}await new Promise(resolve=>setTimeout(resolve,5));
    }
    parentPort.postMessage({running:false,available:true,completedThreads,totalThreads:threads.length,items,cancelled,at:new Date().toISOString()});
  }
}catch(e){parentPort.postMessage({running:false,error:e.message});}finally{encoder?.free();history?.close();state?.close();analytics?.close();cache.close();parentPort.close();}
