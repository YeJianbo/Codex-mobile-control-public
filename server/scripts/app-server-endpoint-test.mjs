import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import WebSocket,{WebSocketServer} from 'ws';
import {CodexAppServerClient} from '../dist/codex/appServerClient.js';
// Real loopback transports, isolated endpoint files and synthetic RPCs only.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mobile-endpoint-'));
const previous=process.env.CODEX_MOBILE_CONTROL_HOME;
const previousRestart=process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART;
process.env.CODEX_MOBILE_CONTROL_HOME=root;
process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART='0';
const directory=path.join(root,'desktop-bridge');fs.mkdirSync(directory);
fs.writeFileSync(path.join(directory,'enabled.json'),'{}');
fs.writeFileSync(path.join(directory,'shared-backend.mjs'),'await new Promise(resolve=>setTimeout(resolve,60));');
const endpointPath=path.join(directory,'endpoint.json');
const write=endpoint=>fs.writeFileSync(endpointPath,JSON.stringify(endpoint));
const clients=[],servers=[];
const waitFor=async predicate=>{
 const deadline=Date.now()+5000;
 while(!predicate()){assert(Date.now()<deadline,'condition did not recover within 5 seconds');await new Promise(r=>setTimeout(r,10));}
};
async function backend(name){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});servers.push(server);await once(server,'listening');
 const state={name,server,token:name.repeat(40),calls:[],connections:0,onInitialize:null};
 state.endpoint=()=>({url:`ws://127.0.0.1:${server.address().port}`,token:state.token,approvalUrl:`ws://127.0.0.1:${server.address().port}/approval`});
 server.on('connection',(socket,request)=>{
  if(request.headers.authorization!==`Bearer ${state.token}`){socket.close(1008);return;}
  if(request.url==='/approval')return;
  state.connections++;
  socket.on('message',async data=>{
   const rpc=JSON.parse(data);if(rpc.id===undefined)return;
   state.calls.push(rpc.method);
   if(rpc.method==='hold')return;
   if(rpc.method==='initialize'&&state.onInitialize){if(await state.onInitialize()===false)return;}
   if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:rpc.id,result:{backend:name,method:rpc.method}}));
  });
 });
 return state;
}
function client(){const value=new CodexAppServerClient();clients.push(value);return value;}
try{
 const a=await backend('a'),b=await backend('b'),c=client();write(a.endpoint());
 await c.start();await waitFor(()=>c.approvalSocket?.readyState===WebSocket.OPEN);
 await Promise.all(Array.from({length:8},()=>c.start()));assert.equal(a.connections,1);
 console.log('PASS unchanged endpoint reuses one initialized connection');
 const oldSocket=c.socket,oldApproval=c.approvalSocket;
 const held=c.request('hold',{}).then(()=>{throw new Error('stale request unexpectedly resolved');},error=>error);
 await waitFor(()=>a.calls.includes('hold'));
 write(b.endpoint());
 const results=await Promise.all(Array.from({length:8},()=>c.request('thread/resume',{threadId:'isolated'})));
 assert(results.every(result=>result.backend==='b'));assert.equal(b.connections,1);
 assert.match((await held).message,/断开/);assert.equal(c.pending.size,0);
 await waitFor(()=>c.approvalSocket?.readyState===WebSocket.OPEN);
 let staleNotifications=0;c.on('notification',()=>staleNotifications++);
 oldSocket.emit('message',Buffer.from('{"method":"stale"}'));
 oldApproval.emit('message',Buffer.from('{"type":"resolved","id":"old"}'));
 let rejected=false;c.pendingDesktopResolutions.set('desktop:isolated',{timer:setTimeout(()=>{},5000),resolve(){},reject(){rejected=true;}});
 oldApproval.emit('close');assert.equal(rejected,false);assert.equal(staleNotifications,0);
 c.rejectDesktopResolutions();
 assert.deepEqual(await c.request('turn/start',{threadId:'isolated',input:[]}),{backend:'b',method:'turn/start'});
 console.log('PASS port replacement rejects old RPCs, ignores old callbacks and serializes resume/send');
 b.token='rotated'.repeat(8);write(b.endpoint());
 assert.equal((await c.request('thread/resume',{threadId:'isolated'})).backend,'b');
 assert.equal(b.connections,2);assert.equal(c.desktopEndpoint.token,b.token);
 assert.equal((await c.request('turn/start',{threadId:'isolated',input:[]})).backend,'b');
 console.log('PASS token-only rotation authenticates a new connection');
 const closing=c.request('hold',{}).catch(error=>error);await waitFor(()=>c.pending.size===1);
 c.socket.terminate();assert.match((await closing).message,/中断/);
 await c.request('thread/resume',{threadId:'isolated'});assert.equal(b.connections,3);
 console.log('PASS closed connection rejects pending RPCs and reconnects');
 fs.unlinkSync(endpointPath);await assert.rejects(c.request('thread/resume',{threadId:'isolated'}),/尚未就绪/);
 assert.equal(c.socket,null);assert.equal(c.pending.size,0);
 write(a.endpoint());await c.request('thread/resume',{threadId:'isolated'});
 console.log('PASS temporarily missing endpoint disconnects stale transport and recovers');
 await c.stop();a.onInitialize=async()=>{write(b.endpoint());};write(a.endpoint());
 const before=b.connections;
 assert.equal((await c.request('thread/resume',{threadId:'isolated'})).backend,'b');
 assert.equal(b.connections,before+1);a.onInitialize=null;
 console.log('PASS endpoint replaced during initialize reconnects before user RPC');
 await c.stop();a.onInitialize=async()=>{write(b.endpoint());return false;};write(a.endpoint());
 const hungStart=Date.now();assert.equal((await c.request('thread/resume',{threadId:'isolated'})).backend,'b');
 assert(Date.now()-hungStart<5000);a.onInitialize=null;
 console.log('PASS hung initialize on retired endpoint recovers without waiting for RPC timeout');
 await c.stop();write(a.endpoint());
 const starting=c.start();await c.stop();await assert.rejects(starting,/取消/);
 assert.equal(c.socket,null);await c.start();
 console.log('PASS stop cancels in-flight helper/startup without resurrecting a connection');
 await c.stop();process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART='1';const automatic=client();
 fs.unlinkSync(endpointPath);await assert.rejects(automatic.start(),/尚未就绪/);
 assert(automatic.restartTimer);write(b.endpoint());await waitFor(()=>automatic.initialized);
 assert.equal((await automatic.request('thread/resume',{threadId:'isolated'})).backend,'b');
 console.log('PASS failed startup retries after endpoint returns');
}finally{
 await Promise.all(clients.map(c=>c.stop()));
 for(const server of servers){for(const peer of server.clients)peer.terminate();await new Promise(resolve=>server.close(resolve));}
 if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
 if(previousRestart===undefined)delete process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART;else process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART=previousRestart;
 fs.rmSync(root,{recursive:true,force:true});
}
