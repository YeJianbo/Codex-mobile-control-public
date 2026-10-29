import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {RequestJournal} from '../../components/local-console/src/request-journal.mjs';
import {RequestRecords,requestRecord} from '../../components/local-console/src/request-records.mjs';
import http from 'node:http';
import {WebSocket} from 'ws';
import {attachResponsesWebSocket} from '../../components/local-console/src/responses-websocket.mjs';

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'request-records-'));fs.mkdirSync(path.join(directory,'analytics'));
  const journal=new RequestJournal(directory,path.join(directory,'legacy.jsonl'));
  const now=new Date(2026,9,20,12).getTime(),records=new RequestRecords({directory,usage:{journal:()=>journal},now:()=>now,refresh:async()=>{}});
  t.after(()=>{journal.close();fs.rmSync(directory,{recursive:true,force:true});});return {directory,journal,now,records};
}
test('indexed request pages keep identical timestamps, types, filters and missing timing',t=>{
  const f=fixture(t);
  for(let i=0;i<121;i++)f.journal.record({id:String(i).padStart(3,'0'),timestampMs:f.now-1000,model:i%2?'gpt-6.1-sol':'other',purpose:i===120?'warmup':'normal',status:200,inputTokens:100,outputTokens:20,cachedTokens:50,durationMs:i?1000:null});
  const rows=[];let cursor='';do{const page=f.records.read({range:'today',source:'router',cursor,limit:17});rows.push(...page.rows);cursor=page.nextCursor;}while(cursor);
  assert.equal(rows.length,121);assert.equal(new Set(rows.map(row=>row.id)).size,121);
  assert.equal(rows.find(row=>row.id==='router:000').averageTPS,null);
  assert.equal(rows.find(row=>row.id==='router:001').averageTPS,20);
  assert.equal(f.records.read({range:'today',purpose:'warmup'}).rows.length,1);
  assert(f.records.read({range:'today',model:'gpt-6.1-sol'}).rows.every(row=>row.model==='gpt-6.1-sol'));
  assert.throws(()=>f.records.read({cursor:'broken'}),/分页/);
  assert.throws(()=>f.records.read({url:'file:///secret'}),/参数/);
});
test('native and router overlap merges only a unique pair; AGY duplicates do not break pagination',t=>{
  const f=fixture(t),file=path.join(f.directory,'analytics','activity.sqlite'),native=new DatabaseSync(file);
  native.exec('CREATE TABLE events(key TEXT,kind TEXT,time REAL,session TEXT,input INTEGER,cached INTEGER,output INTEGER,reasoning INTEGER,model TEXT,effort TEXT,tier TEXT,dim_version INTEGER)');
  const put=native.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<80;i++){
    put.run('n'+i,'token',f.now-1000-i*10000,'s'+i,100,50,20,0,'gpt-6.1-sol',null,'fast',3);
    f.journal.record({id:'r'+i,timestampMs:f.now-1000-i*10000,sessionId:'s'+i,model:'gpt-6.1-sol',inputTokens:100,cachedTokens:50,outputTokens:20,status:200});
  }
  put.run('only','token',f.now-900000,'single',1,0,1,0,'gpt-6.1-sol',null,'standard',3);native.close();
  const agy=new DatabaseSync(path.join(f.directory,'analytics','agy-usage.sqlite'));
  agy.exec('CREATE TABLE usage(file TEXT,idx INTEGER,time REAL,data TEXT)');
  for(let i=0;i<70;i++)for(const copy of ['a','b','c'])agy.prepare('INSERT INTO usage VALUES(?,?,?,?)').run(copy,i,f.now-100-i,JSON.stringify({time:f.now-100-i,model:'gemini-3.8-flash',messageId:'m'+i,input:10,cached:2,cacheWrite:0,output:3}));agy.close();
  let cursor='',collected=[];do{const page=f.records.read({range:'today',cursor,limit:10});collected.push(...page.rows);cursor=page.nextCursor;}while(cursor);
  assert.equal(collected.filter(row=>row.source==='codex').length,1);assert.equal(collected.filter(row=>row.source==='router').length,80);assert.equal(collected.filter(row=>row.source==='agy').length,70);
  assert.equal(f.records.read({range:'today',source:'codex',limit:100}).rows.length,81);
});
test('metering preserves source semantics, small quotes and aggregate records',()=>{
  const row=requestRecord({time:1,model:'claude-sonnet-4-5',input:100,cacheRead:50,cacheWrite:25,output:10,requests:1},{id:'x',source:'claude'});
  assert.equal(row.inputTokens,175);assert.equal(row.totalTokens,185);assert.equal(row.durationMs,null);assert.equal(row.averageTPS,null);assert(row.cost.usd>0);
  assert.equal(requestRecord({requests:8,input:100,output:50},{id:'y',source:'hermes'}).kind,'aggregate');
  assert.equal(requestRecord({cost:{basis:'subscription_included',usd:null}},{id:'z',source:'hermes'}).cost.basis,'subscription_included');
});

test('request diagnostics distinguish native settings, measured stages and aggregate-only history',()=>{
  const row=requestRecord({inputTokens:100,cachedTokens:40,outputTokens:20,durationMs:2000,firstByteMs:80,firstOutputMs:1000,firstTextMs:1500,tier:'priority'},{id:'x',source:'router',router:true});
  assert.equal(row.cacheHitRate,.4);assert.equal(row.firstByteMs,80);assert.equal(row.afterFirstOutputMs,1000);assert.equal(row.averageTPS,10);assert.equal(row.tierBasis,'response');
  assert.equal(requestRecord({tier:'fast',durationMs:1000,input:10,output:5},{source:'codex'}).tierBasis,'native-setting');
  assert.equal(requestRecord({input:10,output:5},{source:'codex'}).tierBasis,'unknown');
  const aggregate=requestRecord({requests:4,durationMs:1000,firstTextMs:100,input:100,output:50},{source:'hermes'});
  assert.equal(aggregate.durationMs,null);assert.equal(aggregate.averageTPS,null);assert.equal(aggregate.firstTextMs,null);
});

test('WebSocket forwarding records metering, actual and requested tier and relay source',async t=>{
  const server=http.createServer();let result;
  const finished=new Promise(resolve=>{attachResponsesWebSocket(server,{authorize:()=>200,onFinish:value=>{result=value;resolve();},request:async(body,signal,headers,onRoute)=>{
    onRoute({provider:{id:'relay-test'}});
    return new Response(['data: '+JSON.stringify({type:'response.output_text.delta',delta:'ok'})+'\n\n',
      'data: '+JSON.stringify({type:'response.completed',response:{id:'r',service_tier:'default',output:[],usage:{input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:50}}}})+'\n\n'].join(''),{headers:{'content-type':'text/event-stream'}});
  }});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const peer=new WebSocket('ws://127.0.0.1:'+server.address().port+'/v1/responses',{headers:{'session-id':'s'}});
  t.after(async()=>{peer.terminate();await new Promise(resolve=>server.close(resolve));});
  await new Promise((resolve,reject)=>{peer.once('open',resolve);peer.once('error',reject);});
  peer.send(JSON.stringify({type:'response.create',model:'gpt-6.1-sol',service_tier:'priority',reasoning:{effort:'high'},input:[]}));
  await finished;
  assert.equal(result.usage.input_tokens,100);assert.equal(result.tier,'default');assert.equal(result.requestedTier,'priority');assert.equal(result.provider,'relay-test');assert.equal(result.sessionId,'s');assert.equal(result.effort,'high');assert(result.timings.firstTextMs>=0);assert(result.durationMs>0);
});
