import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import WebSocket from 'ws';
import {CodexAppServerClient} from '../src/codex/appServerClient.ts';

const realCli=process.argv[2];
if(!realCli)throw new Error('Specify the installed Codex executable');
const root=fileURLToPath(new URL('../',import.meta.url));
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-shared-'));
const directory=path.join(home,'desktop-bridge');
await fs.mkdir(directory);
process.env.CODEX_MOBILE_CONTROL_HOME=home;
const shim=path.join(directory,'codex-bridge.exe');
execFileSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',['/nologo','/r:System.Web.Extensions.dll',`/out:${shim}`,path.join(root,'scripts','DesktopCliShim.cs')],{windowsHide:true});
await fs.writeFile(path.join(directory,'config.json'),JSON.stringify({realCli,node:process.execPath,bridgeScript:path.join(root,'scripts','desktop-bridge.mjs'),gatewayRoot:root}));
const desktop=spawn(shim,['app-server'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
let stderr='';desktop.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-1800);});
const pending=new Map();const notifications=[];let sequence=1;
readline.createInterface({input:desktop.stdout}).on('line',line=>{
  let message;try{message=JSON.parse(line);}catch{return;}
  const item=pending.get(message.id);
  if(item){clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(new Error(JSON.stringify(message.error))):item.resolve(message.result);}
  else notifications.push(message);
});
function request(method,params={}){const id=sequence++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`desktop timeout: ${method}; ${stderr}`)),60000);pending.set(id,{resolve,reject,timer});desktop.stdin.write(JSON.stringify({id,method,params})+'\n');});}
async function until(test,timeout=60000){const end=Date.now()+timeout;while(!test()){if(Date.now()>end)throw new Error('shared response timed out');await new Promise(resolve=>setTimeout(resolve,100));}}
const gateway=new CodexAppServerClient();const updates=[];
gateway.on('notification',event=>updates.push(event));
try{
  await request('initialize',{clientInfo:{name:'cmc_desktop_test',version:'0.5.7'},capabilities:{experimentalApi:true}});
  console.log('desktop initialized');
  assert.equal(await fs.readFile(path.join(directory,'enabled.json'),'utf8'),'{}','normal desktop startup must enable sharing automatically');
  desktop.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  const endpoint=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));
  const secondary=spawn(shim,['app-server'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let secondaryResponse='';
  secondary.stdout.on('data',data=>{secondaryResponse+=data.toString();});
  secondary.stdin.write(JSON.stringify({id:991,method:'initialize',params:{clientInfo:{name:'cmc_second_desktop',version:'0.5.7'},capabilities:{experimentalApi:true}}})+'\n');
  await until(()=>secondaryResponse.includes('"id":991'));
  assert.equal(JSON.parse((await fs.readFile(path.join(directory,'endpoint.json'),'utf8'))).serverPid,endpoint.serverPid,'second desktop launch must share the first server');
  secondary.stdin.end();
  await new Promise(resolve=>secondary.once('exit',resolve));
  assert.equal(JSON.parse((await fs.readFile(path.join(directory,'endpoint.json'),'utf8'))).serverPid,endpoint.serverPid,'second desktop exit must preserve the shared endpoint');
  const denied=await new Promise(resolve=>{const ws=new WebSocket(endpoint.url);ws.on('error',()=>resolve(true));ws.on('open',()=>{ws.close();resolve(false);});});
  assert.equal(denied,true,'shared listener must reject clients without a token');
  assert.match(endpoint.approvalUrl,/^ws:\/\/127\.0\.0\.1:\d+$/,'desktop approval relay must use a local listener');
  const deniedApproval=await new Promise(resolve=>{const ws=new WebSocket(endpoint.approvalUrl);ws.on('error',()=>resolve(true));ws.on('open',()=>{ws.close();resolve(false);});});
  assert.equal(deniedApproval,true,'desktop approval relay must reject clients without a token');
  const approvalPeer=new WebSocket(endpoint.approvalUrl,{headers:{Authorization:`Bearer ${endpoint.token}`}});
  const approvalSnapshot=await new Promise((resolve,reject)=>{approvalPeer.once('message',data=>resolve(JSON.parse(data.toString())));approvalPeer.once('error',reject);});
  assert.equal(approvalSnapshot.type,'snapshot');
  assert.deepEqual(approvalSnapshot.requests,[]);
  approvalPeer.close();
  await gateway.start();
  console.log('gateway connected');
  const source=await request('thread/start',{cwd:home,sandbox:'read-only',approvalPolicy:'never'});
  const id=source.thread.id;
  console.log('test task started');
  const desktopTurn=await request('turn/start',{threadId:id,input:[{type:'text',text:'请先运行 PowerShell 命令 Start-Sleep -Seconds 4，然后只回复 OK。',text_elements:[]}],approvalPolicy:'never',sandboxPolicy:{type:'readOnly'}});
  await gateway.request('turn/steer',{threadId:id,expectedTurnId:desktopTurn.turn.id,input:[{type:'text',text:'补充：回复 OK 即可。',text_elements:[]}]});
  console.log('gateway steered a desktop-owned turn');
  await until(()=>notifications.some(event=>event.method==='turn/completed'&&event.params?.threadId===id));
  console.log('desktop turn completed');
  const resumed=await gateway.request('thread/resume',{threadId:id,excludeTurns:true});
  assert.equal(resumed.thread.id,id,'gateway must resume the original task ID');
  console.log('original task resumed');
  const sent=await gateway.request('turn/start',{threadId:id,input:[{type:'text',text:'只回复 OK，不调用工具。',text_elements:[]}],approvalPolicy:'never',sandboxPolicy:{type:'readOnly'}});
  await until(()=>updates.some(event=>event.method==='turn/completed'&&event.params?.turn?.id===sent.turn.id));
  assert(notifications.some(event=>event.method==='turn/started'&&event.params?.turn?.id===sent.turn.id),'desktop must receive the same turn');
  const complete=updates.find(event=>event.method==='turn/completed'&&event.params?.turn?.id===sent.turn.id);
  assert.equal(complete.params.turn.status,'completed',JSON.stringify(complete.params.turn.error));
  const read=await request('thread/read',{threadId:id,includeTurns:true});
  assert.equal(read.thread.id,id);
  assert(read.thread.turns.some(turn=>turn.id===sent.turn.id),'desktop must read the gateway turn from the original task');
  await gateway.stop();
  assert.equal((await request('thread/read',{threadId:id})).thread.id,id,'disconnecting the gateway must not stop the desktop server');
  await gateway.start();
  assert.equal((await gateway.request('thread/resume',{threadId:id,excludeTurns:true})).thread.id,id,'reconnection must preserve the task ID');
  const result={authenticated:true,sameTaskId:true,realTurnCompleted:true,desktopSawTurn:true,reconnectSameTask:true};
  await fs.writeFile(path.join(root,'../artifacts/desktop-bridge-check.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,secondDesktopReusedServer:true}));
  try{await request('thread/archive',{threadId:id});}catch{console.warn('Test task archive failed; history was retained.');}
}finally{
  await gateway.stop();desktop.stdin.end();
  for(const item of pending.values())clearTimeout(item.timer);
  await new Promise(resolve=>{desktop.once('exit',resolve);setTimeout(resolve,3000).unref();});
  if(desktop.exitCode===null)desktop.kill();
  if(path.dirname(home)===os.tmpdir())await fs.rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
