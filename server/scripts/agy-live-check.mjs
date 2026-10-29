import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';
import selfsigned from 'selfsigned';

// Default: isolated real gateway and AGY. --installed exercises the configured public entry.
const installed=process.argv.includes('--installed');
const home=installed?path.join(os.homedir(),'.codex-mobile-control'):await fs.mkdtemp(path.join(os.tmpdir(),'cmc-agy-'));
let gateway,socket,device,threadId,base,config,entry,project,fixtureDirectory;
const events=[],logs=[];
const cert=await selfsigned.generate([{name:'commonName',value:'temporary AGY check'}],{keySize:2048});
const model=process.env.CODEX_AGY_TEST_MODEL||'antigravity::gemini-3.8-flash';
const effort=process.env.CODEX_AGY_TEST_EFFORT||'medium';
function proof(method,target){const time=String(Date.now()),nonce=crypto.randomUUID();return {'X-Device-Time':time,'X-Device-Nonce':nonce,'X-Device-Signature':crypto.sign('sha256',Buffer.from(`${method}\n${target}\n${time}\n${nonce}`),cert.private).toString('base64')};}
async function until(fn,timeout=180000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('AGY check timed out');}
async function request(method,target,body,remote=false,pairing=false){
  const url=new URL((remote&&installed?entry.publicUrl:base).replace(/\/$/,'')+target);
  const text=body===undefined?undefined:JSON.stringify(body);
  const headers={Authorization:`Bearer ${remote?device.token:config.token}`,...(text===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}),...((remote||pairing)?proof(method,url.pathname+url.search):{}),...(remote?(installed?{'X-Remote-Password':entry.password}:{'X-Public-Proxy-Secret':entry.proxySecret}):{})};
  return new Promise((resolve,reject)=>{
    const req=(url.protocol==='https:'?https:http).request(url,{method,headers,...(!remote&&config.https?.enabled?{ca:config.ca,servername:'localhost'}:{}),timeout:10000},res=>{let result='';res.setEncoding('utf8');res.on('data',x=>result+=x);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(result||'{}')})}catch{reject(Error(`Non-JSON HTTP ${res.statusCode}`))}})});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP timeout')));req.end(text);
  });
}
async function connect(){
  const target='/ws?device=AGY-check&token='+encodeURIComponent(device.token);
  const socketUrl=new URL((installed?entry.publicUrl:base).replace(/\/$/,'').replace(/^http/,'ws')+target);
  socket=new WebSocket(socketUrl,{headers:{...proof('GET',socketUrl.pathname+socketUrl.search),...(installed?{'X-Remote-Password':entry.password}:{'X-Public-Proxy-Secret':entry.proxySecret})}});
  const mark=events.length;socket.on('message',raw=>{const e=JSON.parse(raw.toString());if(!e.replayed){events.push(e);if(e.threadId&&e.threadId===threadId&&['turn.started','turn.completed','tool.started','error'].includes(e.type))console.log(new Date().toISOString(),e.type,e.status||e.title||e.message||'');}});
  await Promise.race([until(()=>events.slice(mark).some(e=>e.type==='connected'),15000),new Promise((_,reject)=>socket.once('error',reject))]);
}
async function rejectCommand(command,pattern){const mark=events.length;socket.send(JSON.stringify(command));const e=await until(()=>events.slice(mark).find(e=>e.type==='error'),45000);assert.match(e.message,pattern);assert(!events.slice(mark).some(e=>e.type==='thread.started'));}
async function completed(number){await until(()=>{const turns=events.filter(e=>e.threadId===threadId&&e.type==='turn.completed');if(turns.some(e=>e.status!=='completed'))throw Error(events.filter(e=>e.threadId===threadId&&e.type==='error').map(e=>e.message).join('\n')||'AGY turn failed');return turns.length>=number;});assert.equal(events.filter(e=>e.threadId===threadId&&e.type==='turn.completed')[number-1].status,'completed');}
async function startGateway(){gateway=spawn(process.execPath,['dist/index.js'],{cwd:path.resolve(import.meta.dirname,'..'),windowsHide:true,env:{...process.env,CODEX_HOME:home,CODEX_MOBILE_CONTROL_HOME:home,CODEX_MOBILE_CONTROL_CODEX_BIN:process.execPath,CODEX_MOBILE_CONTROL_CODEX_ARG_PREFIX:JSON.stringify([path.join(home,'mock.mjs')]),CODEX_MOBILE_CONTROL_AGENTS:'antigravity'},stdio:['ignore','ignore','pipe']});gateway.stderr.on('data',x=>logs.push(x.toString()));await until(()=>request('GET','/health').then(r=>r.status===200).catch(()=>false),15000);}
async function stopGateway(){if(!gateway)return;const stopped=new Promise(r=>gateway.once('exit',r));if(process.platform==='win32'){const kill=spawn('taskkill.exe',['/PID',String(gateway.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>kill.once('exit',r));}else gateway.kill();await stopped;gateway=undefined;}
try{
  if(installed){
    config=JSON.parse(await fs.readFile(path.join(home,'server.json'),'utf8'));base=`${config.https?.enabled?'https':'http'}://127.0.0.1:${config.port}`;if(config.https?.enabled)config.ca=await fs.readFile(config.https.certPath);
    entry=JSON.parse(await fs.readFile(path.join(home,'public-access.json'),'utf8'));entry.password=(await fs.readFile(path.join(home,'public-password.txt'),'utf8')).trim();assert.match(entry.publicUrl,/^https:\/\//);
    const projects=await request('GET','/api/projects');assert.equal(projects.status,200);const root=projects.body.projects.find(p=>path.resolve(p.path).toLowerCase()===path.resolve(import.meta.dirname,'../..').toLowerCase());assert(root,'Repository must already be an allowed project');project=root.path;fixtureDirectory=await fs.mkdtemp(path.join(project,'artifacts','agy-live-'));
  }else{
    const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
    project=path.join(home,'project');await fs.mkdir(project);fixtureDirectory=project;config={host:'127.0.0.1',port,token:crypto.randomUUID(),projectRoots:[project]};base=`http://127.0.0.1:${port}`;entry={proxySecret:crypto.randomUUID()};
    await fs.writeFile(path.join(home,'server.json'),JSON.stringify(config));await fs.writeFile(path.join(home,'public-access.json'),JSON.stringify(entry));
    await fs.writeFile(path.join(home,'mock.mjs'),`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',s=>{const m=JSON.parse(s);if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:m.method==='model/list'?{data:[]}:{}})+'\\n')});`);await startGateway();
  }
  const marker='AGY_'+crypto.randomBytes(8).toString('hex');await fs.writeFile(path.join(fixtureDirectory,'marker.txt'),marker);const markerPath=path.relative(project,path.join(fixtureDirectory,'marker.txt')).replaceAll('\\','/');
  const pair=await request('POST','/api/pair/start');assert.equal(pair.status,200);const paired=await request('POST','/api/pair/claim',{code:pair.body.code,certificate:Buffer.from(cert.cert).toString('base64'),name:'Temporary AGY check'},false,true);assert.equal(paired.status,200);device=paired.body;
  await connect();console.log('Connected signed device; checking AGY public dispatch boundaries.');
  for(const agent of ['claude','grok'])await rejectCommand({type:'thread.start',model:agent+'::default',projectPath:project,initialText:'denied'},/公网仅支持/);
  await rejectCommand({type:'thread.start',model,effort:'invalid',permission:'auto',projectPath:project,initialText:'invalid effort'},/推理强度/);
  await rejectCommand({type:'thread.start',model,projectPath:project,initialText:'image',images:[{id:crypto.randomUUID(),name:'image.png'}]},/不支持图片/);
  await rejectCommand({type:'thread.start',model,projectPath:path.parse(project).root,initialText:'outside'},/工作目录|工作区|项目|允许/);
  console.log('Public AGY boundaries passed; starting real tool read and queued follow-up.');
  socket.send(JSON.stringify({type:'thread.start',requestId:'agy-live',model,effort,permission:'auto',projectPath:project,initialText:`请用工具读取 ${JSON.stringify(markerPath)}，只回复文件中的标记。不要修改文件。`}));threadId=(await until(()=>events.find(e=>e.type==='thread.started'&&e.requestId==='agy-live'),45000)).threadId;
  const queued=await request('POST',`/api/threads/${threadId}/queue`,{id:crypto.randomUUID(),text:'只回复刚才文件中的标记。使用对话记忆，不要再调用工具。',permission:'auto'},true);assert.equal(queued.status,200);await completed(2);console.log('Real AGY tool read and queued follow-up completed.');
  assert(events.some(e=>e.threadId===threadId&&e.type==='tool.started'));
  for(const tool of events.filter(e=>e.threadId===threadId&&e.type==='tool.started'))assert(events.some(e=>e.type==='tool.completed'&&e.itemId===tool.itemId),'Tool lifecycle must close');
  const replies=events.filter(e=>e.threadId===threadId&&e.type==='message.delta').reduce((map,e)=>map.set(e.turnId,(map.get(e.turnId)||'')+e.text),new Map());assert.equal(replies.size,2);for(const text of replies.values())assert(text.includes(marker),text);
  let history=await request('GET',`/api/threads/${threadId}/events`,undefined,true);assert.equal(history.status,200);assert.equal(history.body.settings.model,model);assert.equal(history.body.settings.effort,effort);assert.equal((await request('POST',`/api/threads/${threadId}/resume`,{},true)).status,200);
  if(!installed){socket.terminate();await stopGateway();await startGateway();await connect();socket.send(JSON.stringify({type:'turn.start',threadId,text:'只回复 marker.txt 中之前读到的标记。使用对话记忆，不要调用工具。',permission:'auto'}));await completed(3);const last=events.filter(e=>e.threadId===threadId&&e.type==='message.delta').at(-1)?.turnId;assert(events.filter(e=>e.turnId===last&&e.type==='message.delta').map(e=>e.text).join('').includes(marker));history=await request('GET',`/api/threads/${threadId}/events`,undefined,true);assert.equal(history.body.settings.effort,effort);assert.equal(history.body.events.filter(e=>e.type==='user.message').length,3);}
  console.log(`PASS: real AGY ${installed?'public endpoint':'isolated signed public dispatch'} (${model}, ${effort}); tool read, queued recall, resume and saved model/effort${installed?'':', restart and third-turn recall'}; other agents, invalid effort, images and outside workspace rejected.`);
}catch(error){console.error(error.message);console.error('Observed:',JSON.stringify({turns:events.filter(e=>e.threadId===threadId&&e.type==='turn.completed').map(e=>e.status),tools:events.filter(e=>e.threadId===threadId&&e.type==='tool.started').length,errors:events.filter(e=>e.threadId===threadId&&e.type==='error').map(e=>e.message)}));if(!installed&&logs.length)console.error(logs.join('').slice(-1500));process.exitCode=1;}
finally{
  if(threadId&&socket?.readyState===WebSocket.OPEN&&events.filter(e=>e.threadId===threadId&&e.type==='turn.started').length>events.filter(e=>e.threadId===threadId&&e.type==='turn.completed').length){const count=events.filter(e=>e.threadId===threadId&&e.type==='turn.completed').length;socket.send(JSON.stringify({type:'turn.interrupt',threadId}));await until(()=>events.filter(e=>e.threadId===threadId&&e.type==='turn.completed').length>count,15000).catch(()=>{});}
  socket?.terminate();if(installed){if(threadId)await request('DELETE',`/api/threads/${threadId}`).catch(()=>{});if(device?.device?.id)await request('DELETE',`/api/devices/${encodeURIComponent(device.device.id)}`).catch(()=>{});if(fixtureDirectory){assert.equal(path.dirname(path.resolve(fixtureDirectory)),path.resolve(project,'artifacts'));assert(path.basename(fixtureDirectory).startsWith('agy-live-'));await fs.rm(fixtureDirectory,{recursive:true,force:true});}}else{await stopGateway();assert.equal(path.dirname(path.resolve(home)),path.resolve(os.tmpdir()));assert(path.basename(home).startsWith('cmc-agy-'));await fs.rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
