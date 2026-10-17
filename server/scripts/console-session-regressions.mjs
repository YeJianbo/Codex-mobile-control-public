// Isolated HTTP/WebSocket session integration. No browser or real model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';

import WebSocket from 'ws';

const root=path.resolve(import.meta.dirname,'..');
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-remote-web-'));
const codexHome=path.join(home,'codex'),project=path.join(home,'project');
await fs.mkdir(codexHome);await fs.mkdir(project);
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const base=`http://127.0.0.1:${port}`,token='isolated-remote-test';
await fs.writeFile(path.join(home,'server.json'),JSON.stringify({host:'127.0.0.1',port,token,projectRoots:[project]}));
await fs.writeFile(path.join(codexHome,'config.toml'),'model="gpt-6-sol"\nmodel_reasoning_effort="high"\n');
const metrics=path.join(home,'metrics.json'),mock=path.join(home,'mock.mjs');
await fs.writeFile(mock,`import readline from 'node:readline';import fs from 'node:fs';
const metrics=${JSON.stringify(metrics)};let created=0,turns=0;const requests=[];const ids=new Map();const rl=readline.createInterface({input:process.stdin});rl.on('close',()=>process.exit());
const send=o=>console.log(JSON.stringify(o));const result=(id,result)=>send({id,result});const notice=(method,params)=>send({method,params});
const save=()=>fs.writeFileSync(metrics,JSON.stringify({created,turns,requests}));
rl.on('line',line=>{const m=JSON.parse(line),p=m.params||{};if(m.id===undefined)return;
if(m.method==='initialize')return result(m.id,{userAgent:'isolated-mock'});
if(m.method==='model/list')return result(m.id,{data:['gpt-6-sol','gpt-6.1-sol','gpt-6-astra'].map(model=>({model,displayName:model,supportedReasoningEfforts:['medium','high'].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:'medium'})),nextCursor:null});
if(m.method==='thread/start'){const id='local-fixture-'+(++created);ids.set(id,{id,cwd:p.cwd,turns:[]});save();setTimeout(()=>result(m.id,{thread:ids.get(id)}),400);return;}
if(m.method==='thread/resume'||m.method==='thread/read')return result(m.id,{thread:ids.get(p.threadId)||{id:p.threadId,turns:[]}});
if(m.method==='turn/start'){turns++;requests.push({threadId:p.threadId,model:p.model,effort:p.effort});save();result(m.id,{turn:{id:'turn-'+turns}});notice('turn/started',{threadId:p.threadId,turn:{id:'turn-'+turns}});setTimeout(()=>{notice('item/agentMessage/delta',{threadId:p.threadId,itemId:'reply-'+turns,delta:'模拟后端回复：任务可见。'});notice('turn/completed',{threadId:p.threadId,turn:{id:'turn-'+turns,status:'completed'}});},1200);return;}
if(m.method==='thread/loaded/list')return result(m.id,{data:[...ids.keys()]});
if(m.method==='thread/list')return result(m.id,{data:[...ids.values()],nextCursor:null});
return result(m.id,{});});`);
const gateway=spawn(process.execPath,['dist/index.js'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CODEX_HOME:codexHome,CODEX_MOBILE_CONTROL_HOME:home,CODEX_MOBILE_CONTROL_CODEX_BIN:process.execPath,CODEX_MOBILE_CONTROL_CODEX_ARG_PREFIX:JSON.stringify([mock]),CODEX_MOBILE_CONTROL_AGENTS:'codex',CODEX_MOBILE_CONTROL_AUTO_RESTART:'0'}});
let output='';gateway.stdout.on('data',c=>output+=c);gateway.stderr.on('data',c=>output+=c);
const checks=[];
const wait=async(predicate,timeout=10000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await predicate())return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out waiting for isolated fixture');};
const api=async(method,url,body)=>{const r=await fetch(base+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 await wait(async()=>{try{return (await fetch(base+'/health')).ok;}catch{return false;}});
 const snapshot={externalId:'cloud-demo',title:'isolated snapshot fixture',updatedAt:new Date(Date.now()-600000).toISOString(),status:'running',contentKind:'summary',messages:[{role:'user',text:'original earlier request'},{role:'assistant',text:'unchanged final'}]};
 assert.equal((await api('POST','/api/cloud-snapshots/import',{schemaVersion:1,snapshots:[snapshot]})).status,200);
 await check('Gateway rejects every cloud snapshot mutation and direct websocket send',async()=>{
  const id='cloud-snapshot:cloud-demo';
  for(const [method,suffix,body] of [['POST','/resume',{}],['POST','/compact',{}],['PATCH','',{title:'bad'}],['POST','/pin',{pinned:true}],['PATCH','/goal',{objective:'bad'}],['POST','/queue',{id:'bad',text:'bad'}],['DELETE','',{}]])assert.equal((await api(method,'/api/threads/'+encodeURIComponent(id)+suffix,body)).status,403);
  const socket=new WebSocket(base.replace('http:','ws:')+'/ws?token='+token);const rejected=new Promise((resolve,reject)=>{socket.on('message',raw=>{const event=JSON.parse(raw);if(event.type==='connected')socket.send(JSON.stringify({type:'turn.start',requestId:'snapshot-attack',threadId:id,text:'must reject'}));if(event.type==='error'&&event.requestId==='snapshot-attack')resolve(event);});socket.on('error',reject);});
  assert.match((await rejected).message,/仅供查看/);socket.close();
  const state=await fs.readFile(metrics,'utf8').then(JSON.parse).catch(()=>({created:0,turns:0}));assert.equal(state.created,0);assert.equal(state.turns,0);
 });
 await check('Parallel local API retries start one visible task with Sol/high and preserve messages',async()=>{
  const body={requestId:'api-idempotent',projectPath:project,text:'独立本地任务',model:'gpt-6.1-sol',effort:'high'};
  const results=await Promise.all([api('POST','/api/local-tasks',body),api('POST','/api/local-tasks',body)]);assert(results.every(r=>r.status===202));assert.equal(results[0].body.request.threadId,results[1].body.request.threadId);
  const state=JSON.parse(await fs.readFile(metrics));assert.equal(state.created,1);assert.equal(state.turns,1);assert.equal(state.requests[0].model,'gpt-6.1-sol');assert.equal(state.requests[0].effort,'high');
  const receipt=(await api('GET','/api/local-tasks/api-idempotent')).body.request;assert.equal(receipt.state,'accepted');
  const thread=(await api('GET','/api/threads')).body.threads.find(t=>t.id===receipt.threadId);assert.equal(thread.source,'localCodex');assert.equal(thread.readOnly,undefined);
  await wait(async()=>((await api('GET','/api/threads/'+receipt.threadId+'/events')).body.events.some(e=>e.type==='message.delta')));
 });

 await check('Correcting earlier snapshot text and metadata with the same timestamp survives a real API reload',async()=>{
   const corrected={...snapshot,status:'completed',contentKind:'messages',messages:[{role:'user',text:'corrected earlier request'},{role:'assistant',text:'unchanged final'}]};
   assert.equal((await api('POST','/api/cloud-snapshots/import',{schemaVersion:1,snapshots:[corrected]})).status,200);
   const read=await api('GET','/api/threads/'+encodeURIComponent('cloud-snapshot:cloud-demo')+'/events');
   assert.equal(read.status,200);assert.equal(read.body.events[0].text,'corrected earlier request');assert.equal(read.body.events.at(-1).text,'unchanged final');assert.equal(read.body.snapshot.snapshotStatus,'completed');assert.equal(read.body.snapshot.snapshotContentKind,'messages');assert.equal(read.body.snapshot.snapshotStale,true);
 });
 await check('An empty snapshot has explicit read-only metadata and zero fabricated messages',async()=>{
   assert.equal((await api('POST','/api/cloud-snapshots/import',{schemaVersion:1,snapshots:[{...snapshot,externalId:'empty',messages:[]}]})).status,200);
   const read=await api('GET','/api/threads/'+encodeURIComponent('cloud-snapshot:empty')+'/events');assert.equal(read.status,200);assert.deepEqual(read.body.events,[]);assert.equal(read.body.readOnly,true);assert.equal(read.body.snapshot.id,'cloud-snapshot:empty');
 });
 await check('Replaying an accepted creation receipt never duplicates the local session',async()=>{
   const body={requestId:'api-idempotent',projectPath:project,text:'独立本地任务',model:'gpt-6.1-sol',effort:'high'};
   assert.equal((await api('POST','/api/local-tasks',body)).status,202);
   const state=JSON.parse(await fs.readFile(metrics));assert.equal(state.created,1);assert.equal(state.turns,1);
 });
 await check('Expanded 200-message snapshots expose corrected first content at the retained client window',async()=>{
   const messages=Array.from({length:200},(_,index)=>({role:index===0?'user':'assistant',text:index===0?'old first message':`unchanged message ${index}`}));
   const large={...snapshot,externalId:'expanded',messages};
   assert.equal((await api('POST','/api/cloud-snapshots/import',{schemaVersion:1,snapshots:[large]})).status,200);
   messages[0]={...messages[0],text:'corrected first message'};
   assert.equal((await api('POST','/api/cloud-snapshots/import',{schemaVersion:1,snapshots:[large]})).status,200);
   const read=await api('GET','/api/threads/'+encodeURIComponent('cloud-snapshot:expanded')+'/events?count=360');
   assert.equal(read.status,200);assert.equal(read.body.events.length,200);assert.equal(read.body.events[0].text,'corrected first message');assert.equal(read.body.events.at(-1).text,'unchanged message 199');assert.equal(read.body.hasMore,false);
 });
 console.log(JSON.stringify({checks,errors:[],scope:'Windows isolated fixture; exact 0.6.126 source plus console iteration; mock Codex only; no real model requests'}));
 }catch(error){console.error(output.slice(-3000));throw error;}finally{
   if(process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(gateway.pid),'/T','/F'],{stdio:'ignore'});}catch{gateway.kill();}}else gateway.kill('SIGTERM');
   gateway.stdout.destroy();gateway.stderr.destroy();
 }
