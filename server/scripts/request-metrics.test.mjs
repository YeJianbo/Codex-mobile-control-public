import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {generationTiming} from '../../components/local-console/src/agy-protobuf.mjs';
import {glmQuote,harnessSummary} from '../../components/local-console/src/harness-usage.mjs';
import {nativeSpeedDb} from '../../components/local-console/src/native-speed.mjs';
import {analyticsDb} from '../../components/local-console/src/analytics-db.mjs';
import {RequestRecords,requestRecord} from '../../components/local-console/src/request-records.mjs';
import {readOpenCodeUsage} from '../../components/local-console/src/opencode-usage.mjs';

test('GLM 5.3 shared quote counts cached input once and keeps recorded charges',()=>{
  const row={time:10,model:'zai/glm-5.3',input:1e6,cacheRead:2e5,output:1e5,requests:1,sessionId:'s'};
  assert.equal(glmQuote(row).usd,1.612);
  assert.equal(requestRecord(row,{id:'r',source:'zcode'}).cost.usd,1.612);
  assert.equal(harnessSummary('zcode',[row],{since:0,until:20},{}).cost.usd,1.612);
  assert.equal(harnessSummary('zcode',[{...row,cost:{usd:.25,basis:'provider_reported'}}],{since:0,until:20},{}).cost.usd,.25);
  assert.equal(glmQuote({...row,model:'glm-5.3-flash'}).usd,.176);
  assert.equal(glmQuote({...row,cacheRead:2e6}),null);
});

test('AGY native duration combines first-token waiting and streaming, without inventing missing fields',()=>{
  // Field 11: 2 seconds; field 12: 3 seconds.
  assert.deepEqual(generationTiming(Buffer.from([90,2,8,2,98,2,8,3])),{firstOutputMs:2000,streamingDurationMs:3000,durationMs:5000});
  assert.equal(generationTiming(Buffer.from([90,2,8,2])).durationMs,null);
});

test('Codex request speed uses matching visible tokens and rejects ambiguous neighboring requests',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'request-metrics-'));fs.mkdirSync(path.join(directory,'analytics'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const now=Date.now(),db=analyticsDb(path.join(directory,'analytics/activity.sqlite')),speed=nativeSpeedDb(path.join(directory,'native-speed.sqlite'));
  db.prepare("INSERT INTO events(key,kind,time,session,input,cached,output,model) VALUES(?,'token',?,'s',100,50,200,'gpt-6.1-sol')").run('token:turn:stamp:usage',now-100);
  speed.prepare("INSERT INTO items(session,item,turn_id,model,start_ms,end_ms,tokens) VALUES('s','item','turn','gpt-6.1-sol',?,?,20)").run(now-1100,now-100);
  const records=new RequestRecords({directory,usage:{journal:()=>({db:{prepare:()=>({all:()=>[]})}})},now:()=>now,refresh:async()=>{}});
  const row=records.read({range:'today',source:'codex'}).rows[0];
  assert.equal(row.averageTPS,20);assert.equal(row.outputTokens,200);assert.equal(row.timingBasis,'visible-text-estimate');
  speed.prepare("INSERT INTO items(session,item,turn_id,model,start_ms,end_ms,reason,phase) VALUES('s','thought','turn','gpt-6.1-sol',?,?,'reasoning-timing','reasoning')").run(now-2100,now-1100);
  const reasoning=records.read({range:'today',source:'codex'}).rows[0];
  assert.equal(reasoning.averageTPS,100);assert.equal(reasoning.timingBasis,'model-output-estimate');
  db.prepare("INSERT INTO events(key,kind,time,session,input,cached,output,model) VALUES(?,'token',?,'s',100,50,200,'gpt-6.1-sol')").run('token:turn:other:usage',now-100);
  assert(records.read({range:'today',source:'codex'}).rows.every(row=>row.averageTPS===null));
  db.close();speed.close();
});

test('OpenCode pairs each step start and finish so tool time cannot leak into another request',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'opencode-metrics-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const db=new DatabaseSync(path.join(directory,'opencode.db'));
  db.exec('CREATE TABLE session(id TEXT,time_created INTEGER);CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT);CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT)');
  db.prepare('INSERT INTO session VALUES(?,?)').run('s',1000);
  db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('m','s',1000,JSON.stringify({role:'assistant',time:{created:1000,completed:12000},modelID:'glm-5.3',providerID:'zai'}));
  const put=(id,at,data)=>db.prepare('INSERT INTO part VALUES(?,?,?,?,?,?)').run(id,'m','s',at,at,JSON.stringify(data));
  const usage={input:100,output:20};
  put('a',1000,{type:'step-start'});put('b',2000,{type:'step-finish',tokens:usage,cost:0});
  put('c',10000,{type:'step-start'});put('d',12000,{type:'step-finish',tokens:usage,cost:0});db.close();
  const result=readOpenCodeUsage(directory).rows;
  assert.deepEqual(result.map(row=>row.durationMs),[1000,2000]);
  assert.deepEqual(result.map(row=>requestRecord(row,{source:'opencode'}).averageTPS),[20,10]);
});
