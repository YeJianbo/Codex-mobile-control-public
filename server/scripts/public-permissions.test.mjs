import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import selfsigned from 'selfsigned';
import WebSocket from 'ws';

// Real gateway authentication and dispatch, with a mock model process that never executes tools.
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-permissions-'));
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
const port=listener.address().port;await new Promise(r=>listener.close(r));
const base=`http://127.0.0.1:${port}`,admin=crypto.randomUUID(),secret=crypto.randomUUID();
const project=path.join(home,'project');await fs.mkdir(project);
const imageThread='88888888-8888-8888-8888-888888888888';
const image=path.join(project,'preview.png'),outside=path.join(home,'outside.png'),fake=path.join(project,'fake.png');
const imageBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2kAAAAASUVORK5CYII=','base64');
await fs.writeFile(image,imageBytes);await fs.writeFile(outside,imageBytes);await fs.writeFile(fake,'private HTML');
await fs.mkdir(path.join(home,'sessions'));
await fs.writeFile(path.join(home,'sessions',`rollout-${imageThread}.jsonl`),[
 {type:'session_meta',payload:{id:imageThread,cwd:project}},
 {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:`![图](<${image}>)\n![外部](<${outside}>)\n![伪装](<${fake}>)`}]}}
].map(x=>JSON.stringify({...x,timestamp:new Date().toISOString()})).join('\n')+'\n');
await fs.writeFile(path.join(home,'server.json'),JSON.stringify({host:'127.0.0.1',port,token:admin,projectRoots:[project]}));
await fs.writeFile(path.join(home,'public-access.json'),JSON.stringify({proxySecret:secret}));
await fs.writeFile(path.join(home,'config.toml'),'model = "test-model"\n');
const calls=path.join(home,'calls.jsonl'),mock=path.join(home,'mock.mjs');
await fs.writeFile(mock,`
import readline from 'node:readline';import fs from 'node:fs';
let n=0;const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line),p=m.params||{};
 if(!m.id)return;
 fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(m)+'\\n');
 if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'public-test-'+(++n)}}});
 if(m.method==='thread/resume')return send({id:m.id,result:{thread:{id:p.threadId}}});
 if(m.method==='model/list')return send({id:m.id,result:{data:[{model:'test-model',supportedReasoningEfforts:[],defaultReasoningEffort:'medium'}]}});
 if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn-'+(++n)}}});setTimeout(()=>send({method:'turn/completed',params:{threadId:p.threadId,turn:{status:'completed'}}}),100);return;}
 send({id:m.id,result:{}});
});`);
let gateway,socket,token;
const cert=await selfsigned.generate([{name:'commonName',value:'permission test'}],{keySize:2048});
function proof(method,target){const time=String(Date.now()),nonce=crypto.randomUUID();return {'X-Device-Time':time,'X-Device-Nonce':nonce,'X-Device-Signature':crypto.sign('sha256',Buffer.from(`${method}\n${target}\n${time}\n${nonce}`),cert.private).toString('base64')};}
async function api(method,target,body,remote=false){const response=await fetch(base+target,{method,headers:{Authorization:`Bearer ${remote?token:admin}`,...(body===undefined?{}:{'Content-Type':'application/json'}),...(remote?{'X-Public-Proxy-Secret':secret,...proof(method,target)}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.status,200,`${method} ${target}`);return response.json();}
async function until(fn){for(let i=0;i<150;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out');}
async function recorded(){return (await fs.readFile(calls,'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(JSON.parse);}
try{
 gateway=spawn(process.execPath,['dist/index.js'],{cwd:path.resolve(import.meta.dirname,'..'),windowsHide:true,env:{...process.env,CODEX_HOME:home,CODEX_MOBILE_CONTROL_HOME:home,CODEX_MOBILE_CONTROL_CODEX_BIN:process.execPath,CODEX_MOBILE_CONTROL_CODEX_ARG_PREFIX:JSON.stringify([mock]),CODEX_MOBILE_CONTROL_AGENTS:'codex'},stdio:'ignore'});
 await until(()=>fetch(base+'/health').then(r=>r.ok).catch(()=>false));
 const pair=await api('POST','/api/pair/start');
 const claimResponse=await fetch(base+'/api/pair/claim',{method:'POST',headers:{'Content-Type':'application/json',...proof('POST','/api/pair/claim')},body:JSON.stringify({code:pair.code,certificate:Buffer.from(cert.cert).toString('base64'),name:'isolated permissions test'})});
 assert.equal(claimResponse.status,200);token=(await claimResponse.json()).token;
 const imageHistory=await api('GET',`/api/threads/${imageThread}/events?count=20`);
 const imageEvent=imageHistory.events.find(x=>x.type==='message.delta');assert(imageEvent);
 for(const [file,expected] of [[image,200],[outside,403],[fake,403],[path.join(project,'secret.txt'),403]]){
   const target=`/api/threads/${imageThread}/output-file/preview.png?eventId=${encodeURIComponent(imageEvent.eventId)}&path=${encodeURIComponent(file)}`;
   const response=await fetch(base+target,{headers:{Authorization:`Bearer ${token}`,'X-Public-Proxy-Secret':secret,...proof('GET',target)}});
   assert.equal(response.status,expected);
   if(expected===200){assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),imageBytes);}
 }
 const target='/ws?device=Android&token='+encodeURIComponent(token);
 socket=new WebSocket(base.replace('http:','ws:')+target,{headers:{Authorization:`Bearer ${token}`,'X-Public-Proxy-Secret':secret,...proof('GET',target)}});
 const messages=[];socket.on('message',raw=>messages.push(JSON.parse(raw.toString())));
 await until(()=>messages.some(m=>m.type==='connected'));
 for(const permission of ['ask','auto','full']){
   socket.send(JSON.stringify({type:'thread.start',projectPath:project,model:'test-model',permission,mode:'plan',fast:true,initialText:permission,requestId:permission}));
   const turn=await until(async()=> (await recorded()).find(m=>m.method==='turn/start'&&m.params.input.some(i=>i.text===permission)));
   assert.equal(turn.params.approvalPolicy,permission==='full'?'never':'on-request');
   assert.equal(turn.params.approvalsReviewer,permission==='auto'?'auto_review':'user');
   assert.equal(turn.params.sandboxPolicy.type,permission==='full'?'dangerFullAccess':'workspaceWrite');
   assert.equal(turn.params.collaborationMode.mode,'plan');
   assert.equal(turn.params.collaborationMode.settings.model,'test-model');
   assert.equal(turn.params.collaborationMode.settings.developer_instructions,null);
   assert.equal(turn.params.serviceTier,'fast');
   const queued=await api('POST',`/api/threads/${turn.params.threadId}/queue`,{id:crypto.randomUUID(),text:'queued-'+permission,permission,mode:'default',fast:false},true);
   assert.equal(queued.message.permission,permission);
   const next=await until(async()=>(await recorded()).find(m=>m.method==='turn/start'&&m.params.input.some(i=>i.text==='queued-'+permission)));
   assert.deepEqual(next.params.sandboxPolicy,turn.params.sandboxPolicy);
   assert.equal(next.params.approvalsReviewer,turn.params.approvalsReviewer);
   assert.equal(next.params.collaborationMode.mode,'default');
   assert.equal(next.params.serviceTier,'default');
 }
 const denied=await fetch(base+'/api/projects',{headers:{Authorization:`Bearer ${token}`,'X-Public-Proxy-Secret':secret}});
 assert.equal(denied.status,401);
 const turn=(await recorded()).find(m=>m.method==='turn/start');
 const queueBase=`/api/threads/${turn.params.threadId}/queue`;
 const localId=crypto.randomUUID();await api('POST',queueBase,{id:localId,text:'local queue'});
 for(const [method,suffix,body] of [['PATCH','',{text:'overwrite'}],['DELETE','',undefined],['POST','/move',{direction:'up'}],['POST','/retry',{}],['POST','/steer',{}]]){
   const target=`${queueBase}/${localId}${suffix}`;
   const denied=await fetch(base+target,{method,headers:{Authorization:`Bearer ${token}`,'X-Public-Proxy-Secret':secret,...proof(method,target),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
   assert.notEqual(denied.status,200);assert.match((await denied.json()).error,/公网只能处理/);
 }
 const remoteId=crypto.randomUUID();await api('POST',queueBase,{id:remoteId,text:'remote queue'},true);
 await api('PATCH',`${queueBase}/${remoteId}`,{text:'updated remote queue'},true);
 await api('POST',`${queueBase}/${remoteId}/move`,{direction:'up'},true);
 await api('DELETE',`${queueBase}/${remoteId}`,undefined,true);
 await api('DELETE',`${queueBase}/${localId}`);
 console.log('PASS: signed public device ask/auto/full forwarded to direct and queued turns; unsigned requests and public edits/moves/cancels/retries/steers of local queue entries rejected.');
}finally{
 socket?.terminate();
 if(gateway){gateway.kill();await new Promise(r=>{gateway.once('exit',r);setTimeout(r,3000).unref()});}
 await fs.rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
