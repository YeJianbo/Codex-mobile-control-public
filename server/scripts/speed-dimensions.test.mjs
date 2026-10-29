import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenSpeedStats} from '../../components/local-console/src/token-speed.mjs';
import {nativeSpeedDb,nativeSpeedRow,nativeDimensionsAt} from '../../components/local-console/src/native-speed.mjs';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {registerMobileStatistics} from '../dist/services/mobileStatistics.js';

test('speed groups keep Fast, reasoning effort and response phase distinct',()=>{
  const row={model:'gpt-6.1-sol',provider:'openai',status:200,outputTokens:100,durationMs:1000,tier:'fast',effort:'high',phase:'final_answer'};
  const stats=tokenSpeedStats([row,{...row,tier:'standard'},{...row,effort:'ultra'},{...row,phase:'commentary'}]);
  assert.equal(stats.groups.length,4);
  assert.equal(stats.totals.samples,4);
  assert.equal(stats.groups.filter(g=>g.tier==='fast'&&g.effort==='high'&&g.phase==='final_answer').length,1);
});

test('first text timing is not replaced by thinking or tool output timing',()=>{
  const row={model:'model',status:200,outputTokens:50,durationMs:1000,firstOutputMs:100,firstTextMs:700};
  const stats=tokenSpeedStats([row,{...row,firstTextMs:null}]);
  assert.equal(stats.totals.p50FirstOutputMs,100);
  assert.equal(stats.totals.p50FirstTextMs,700);
  assert.equal(stats.totals.firstTextSamples,1);
  assert.equal(stats.recent[1].firstTextMs,null);
});

test('native item timing and dimensions remain tied to the same turn',()=>{
  const events=new Map([['turn',[{time:1000,model:'model',tier:'fast',effort:'ultra'}]]]);
  const dimensions=nativeDimensionsAt(events,'turn',1200);
  assert.deepEqual(dimensions,{model:'model',tier:'fast',effort:'ultra'});
  assert.deepEqual(nativeDimensionsAt(events,'other',1200),{model:null,tier:null,effort:null});
  const row=nativeSpeedRow({thread_id:'thread',turn_id:'turn',item_id:'item',started_at_ms:1000,completed_at_ms:2000,item_json:JSON.stringify({text:'reply',phase:'final_answer'})},dimensions.model,()=>2,dimensions.tier,dimensions.effort);
  assert.equal(row.phase,'final_answer');assert.equal(row.effort,'ultra');assert.equal(row.tokens,2);
  assert.equal(nativeSpeedRow({started_at_ms:1000,completed_at_ms:1000},null,()=>{throw Error('Not a valid measurement')}).reason,'missing-stream-time');
});

test('speed cache migration only resets the derived index cursor',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'speed-dimensions-')),file=path.join(directory,'speed.sqlite');
  const old=new DatabaseSync(file);
  old.exec('CREATE TABLE items(session TEXT,item TEXT,turn_id TEXT,model TEXT,start_ms INTEGER,end_ms INTEGER,tokens INTEGER,characters INTEGER,reason TEXT,tier TEXT,PRIMARY KEY(session,item));CREATE TABLE cursors(session TEXT PRIMARY KEY,ordinal INTEGER);INSERT INTO items(session,item,tokens) VALUES(\'s\',\'i\',5);INSERT INTO cursors VALUES(\'s\',10)');old.close();
  const db=nativeSpeedDb(file);
  try{
    assert.deepEqual(db.prepare('PRAGMA table_info(items)').all().filter(c=>['effort','phase'].includes(c.name)).map(c=>c.name),['effort','phase']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cursors').get().n,0);
    assert.equal(db.prepare('SELECT tokens FROM items').get().tokens,5);
  }finally{db.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(file+suffix,{force:true});fs.rmdirSync(directory);}
});

test('mobile speed API preserves effort, phase and first text timing',async()=>{
  const app=Fastify();
  registerMobileStatistics(app,{managementRequest:async()=>({totals:{p50FirstTextMs:700},groups:[{model:'model',tier:'fast',effort:'high',phase:'final_answer',samples:1,sessions:[]}],recent:[{model:'model',effort:'high',phase:'final_answer',firstTextMs:700}]})});
  try{
    const response=await app.inject('/api/mobile-management/statistics/speed?source=native&range=today');
    assert.equal(response.statusCode,200);const data=response.json();
    assert.equal(data.groups[0].effort,'high');assert.equal(data.groups[0].phase,'final_answer');
    assert.equal(data.totals.p50FirstTextMs,700);assert.equal(data.recent[0].firstTextMs,700);
  }finally{await app.close();}
});
