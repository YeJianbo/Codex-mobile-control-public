import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
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
if(m.method==='model/list')return result(m.id,{data:['gpt-6-sol','gpt-6-astra'].map(model=>({model,displayName:model,supportedReasoningEfforts:['medium','high'].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:'medium'})),nextCursor:null});
if(m.method==='thread/start'){const id='local-fixture-'+(++created);ids.set(id,{id,cwd:p.cwd,turns:[]});save();setTimeout(()=>result(m.id,{thread:ids.get(id)}),400);return;}
if(m.method==='thread/resume'||m.method==='thread/read')return result(m.id,{thread:ids.get(p.threadId)||{id:p.threadId,turns:[]}});
if(m.method==='turn/start'){turns++;requests.push({threadId:p.threadId,model:p.model,effort:p.effort});save();result(m.id,{turn:{id:'turn-'+turns}});notice('turn/started',{threadId:p.threadId,turn:{id:'turn-'+turns}});setTimeout(()=>{notice('item/agentMessage/delta',{threadId:p.threadId,itemId:'reply-'+turns,delta:'模拟后端回复：任务可见。'});notice('turn/completed',{threadId:p.threadId,turn:{id:'turn-'+turns,status:'completed'}});},1200);return;}
if(m.method==='thread/loaded/list')return result(m.id,{data:[...ids.keys()]});
if(m.method==='thread/list')return result(m.id,{data:[...ids.values()],nextCursor:null});
return result(m.id,{});});`);
const gateway=spawn(process.execPath,['dist/index.js'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CODEX_HOME:codexHome,CODEX_MOBILE_CONTROL_HOME:home,CODEX_MOBILE_CONTROL_CODEX_BIN:process.execPath,CODEX_MOBILE_CONTROL_CODEX_ARG_PREFIX:JSON.stringify([mock]),CODEX_MOBILE_CONTROL_AGENTS:'codex',CODEX_MOBILE_CONTROL_AUTO_RESTART:'0'}});
let output='';gateway.stdout.on('data',c=>output+=c);gateway.stderr.on('data',c=>output+=c);
const artifacts=path.join(root,'artifacts','remote-sessions');await fs.mkdir(artifacts,{recursive:true});
const checks=[],errors=[];
let browser,context;
const wait=async(predicate,timeout=10000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await predicate())return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out waiting for isolated fixture');};
const api=async(method,url,body)=>{const r=await fetch(base+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 await wait(async()=>{try{return (await fetch(base+'/health')).ok;}catch{return false;}});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 context=await browser.newContext({viewport:{width:1440,height:960}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/console');await page.evaluate(token=>localStorage.setItem('cmc.token',token),token);await page.reload();
 await page.locator('#openDrawer').click();
 await wait(()=>page.locator('#cloudSnapshotImportBtn').isVisible());
 await check('Web imports a stale cloud snapshot and shows fixed provenance/time without controls',async()=>{
  await page.locator('#cloudSnapshotImportBtn').click();
  const captured=new Date(Date.now()-600000).toISOString();
  await page.getByLabel('快照 JSON',{exact:true}).fill(JSON.stringify({schemaVersion:1,snapshots:[{externalId:'cloud-demo',title:'云端任务示例',projectPath:project,updatedAt:captured,status:'running',messages:[{role:'user',text:'这是经过筛选的请求'},{role:'assistant',text:'这是导入时的可见进展，<script>alert(1)</script>'}]}]}));
  await page.locator('dialog.snapshot-import').getByRole('button',{name:'导入',exact:true}).click();
  await wait(()=>page.locator('#snapshotNotice').isVisible());
  assert.match(await page.locator('#snapshotNotice').innerText(),/只读快照/);assert.match(await page.locator('#snapshotNotice').innerText(),/已过期/);assert.match(await page.locator('#snapshotNotice').innerText(),/非实时/);
  assert.equal(await page.locator('#composer').isVisible(),false);assert.equal(await page.locator('#sendBtn').isVisible(),false);
  assert.equal((await api('GET','/api/threads')).body.threads.filter(t=>t.id==='cloud-snapshot:cloud-demo').length,1);
  await page.screenshot({path:path.join(artifacts,'cloud-snapshot-desktop.png')});
  await page.setViewportSize({width:390,height:780});await page.screenshot({path:path.join(artifacts,'cloud-snapshot-mobile.png')});await page.setViewportSize({width:1440,height:960});
 });
 await check('Gateway rejects every cloud snapshot mutation and direct websocket send',async()=>{
  const id='cloud-snapshot:cloud-demo';
  for(const [method,suffix,body] of [['POST','/resume',{}],['POST','/compact',{}],['PATCH','',{title:'bad'}],['POST','/pin',{pinned:true}],['PATCH','/goal',{objective:'bad'}],['POST','/queue',{id:'bad',text:'bad'}],['DELETE','',{}]])assert.equal((await api(method,'/api/threads/'+encodeURIComponent(id)+suffix,body)).status,403);
  const socket=new WebSocket(base.replace('http:','ws:')+'/ws?token='+token);const rejected=new Promise((resolve,reject)=>{socket.on('message',raw=>{const event=JSON.parse(raw);if(event.type==='connected')socket.send(JSON.stringify({type:'turn.start',requestId:'snapshot-attack',threadId:id,text:'must reject'}));if(event.type==='error'&&event.requestId==='snapshot-attack')resolve(event);});socket.on('error',reject);});
  assert.match((await rejected).message,/仅供查看/);socket.close();
  const state=await fs.readFile(metrics,'utf8').then(JSON.parse).catch(()=>({created:0,turns:0}));assert.equal(state.created,0);assert.equal(state.turns,0);
 });
 await check('Parallel local API retries start one visible task with Sol/high and preserve messages',async()=>{
  const body={requestId:'api-idempotent',projectPath:project,text:'独立本地任务'};
  const results=await Promise.all([api('POST','/api/local-tasks',body),api('POST','/api/local-tasks',body)]);assert(results.every(r=>r.status===202));assert.equal(results[0].body.request.threadId,results[1].body.request.threadId);
  const state=JSON.parse(await fs.readFile(metrics));assert.equal(state.created,1);assert.equal(state.turns,1);assert.equal(state.requests[0].model,'gpt-6-sol');assert.equal(state.requests[0].effort,'high');
  const receipt=(await api('GET','/api/local-tasks/api-idempotent')).body.request;assert.equal(receipt.state,'accepted');
  const thread=(await api('GET','/api/threads')).body.threads.find(t=>t.id===receipt.threadId);assert.equal(thread.source,'localCodex');assert.equal(thread.readOnly,undefined);
  await wait(async()=>((await api('GET','/api/threads/'+receipt.threadId+'/events')).body.events.some(e=>e.type==='message.delta')));
 });
 await check('Browser rapid clicks and reload during creation recover the original submission',async()=>{
  await page.locator('#newThreadBtn').click();await page.locator('#prompt').fill('断线恢复测试');
  await page.locator('#sendBtn').click();
  await wait(async()=>JSON.parse(await fs.readFile(metrics)).created===2);
  await page.reload();
  await wait(async()=>{const state=JSON.parse(await fs.readFile(metrics));return state.created===2&&state.turns===2;});
  await wait(()=>page.locator('#events').getByText('断线恢复测试',{exact:true}).isVisible(),15000);
  assert.equal(await page.evaluate(()=>localStorage.getItem('cmc.pendingSubmit')),'');
  await page.screenshot({path:path.join(artifacts,'local-task-recovered.png')});
  const state=JSON.parse(await fs.readFile(metrics));assert.equal(state.created,2);assert.equal(state.turns,2);
 });
 await check('Known task IDs import as labeled summaries, not live cloud history',async()=>{
  const snapshots=JSON.parse(await fs.readFile(path.join(root,'..','deliverables','remote-task-summaries.json'),'utf8'));
  if(!await page.locator('#cloudSnapshotImportBtn').isVisible())await page.locator('#openDrawer').click();
  await page.locator('#cloudSnapshotImportBtn').click();
  await page.getByLabel('快照 JSON',{exact:true}).fill(JSON.stringify(snapshots));
  await page.locator('dialog.snapshot-import').getByRole('button',{name:'导入',exact:true}).click();
  await wait(()=>page.locator('#snapshotNotice').isVisible());assert.match(await page.locator('#snapshotNotice').innerText(),/人工整理/);
  for(const snapshot of snapshots.snapshots){
   const result=await api('GET','/api/threads/'+encodeURIComponent('cloud-snapshot:'+snapshot.externalId)+'/events');
   assert.equal(result.status,200);assert.equal(result.body.readOnly,true);assert.equal(result.body.snapshot.snapshotContentKind,'summary');assert.equal(result.body.events[0].text,snapshot.messages[0].text);
  }
  await page.screenshot({path:path.join(artifacts,'cloud-summary-known-task.png')});
 });
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(artifacts,'verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),backend:'isolated mocked Codex; zero model requests',browser:'installed Chrome on user Windows computer',checks,errors},null,2));
}catch(error){await fs.writeFile(path.join(artifacts,'failure.txt'),String(error)+'\n'+output.slice(-3000));throw error;}
finally{await context?.close();await browser?.close();gateway.kill('SIGTERM');}
