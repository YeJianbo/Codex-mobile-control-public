import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WebSocketServer} from 'ws';
import {LoadedThreadSubscriptions} from '../dist/services/loadedThreadSubscriptions.js';
import {CodexAppServerClient} from '../dist/codex/appServerClient.js';

const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){const end=Date.now()+2000;while(!predicate()){assert(Date.now()<end,'background observation did not finish');await new Promise(resolve=>setTimeout(resolve,2));}}
function client(handler){
  const codex=new EventEmitter();codex.state={initialized:true,shared:true,generation:1};codex.calls=[];
  codex.connectionState=()=>({...codex.state});
  codex.request=async(method,params)=>{codex.calls.push({method,params});return handler(method,params);};
  return codex;
}

test('enabling an initialized desktop connection restores only loaded eligible threads, paginates and limits concurrency',async t=>{
  let active=0,max=0;const resumed=[],errors=[];
  const codex=client(async(method,params)=>{
    if(method==='thread/loaded/list')return params.cursor?{data:['b','c'],nextCursor:null}:{data:['a','b','closed','cloud:s','claude-external','unloaded'],nextCursor:'next'};
    if(method==='thread/read')return {thread:{status:{type:params.threadId==='unloaded'?'notLoaded':'active'}}};
    assert.equal(method,'thread/resume');assert.deepEqual(Object.keys(params).sort(),['excludeTurns','threadId']);assert.equal(params.excludeTurns,true);
    active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,5));resumed.push(params.threadId);active--;return {};
  });
  const observer=new LoadedThreadSubscriptions(codex,{concurrency:2,canSubscribe:id=>id!=='closed',onError:error=>errors.push(error)});t.after(()=>observer.close());
  observer.setEnabled(true);await until(()=>resumed.length===3);
  assert.deepEqual(resumed.sort(),['a','b','c']);assert.equal(max,2);assert.deepEqual(errors,[]);
  assert.deepEqual(codex.calls.filter(row=>row.method==='thread/loaded/list').map(row=>row.params),[{cursor:null,limit:100},{cursor:'next',limit:100}]);
  codex.emit('ready',codex.connectionState());await tick();await tick();
  assert.equal(resumed.length,3,'same-generation ready must not duplicate subscriptions');
  assert(codex.calls.every(row=>['thread/loaded/list','thread/read','thread/resume'].includes(row.method)),'observation must never submit turns or settings');
});

test('disable and close discard in-flight pages and remove listeners',async()=>{
  const first=deferred();let reads=0;
  const codex=client(async method=>{if(method==='thread/loaded/list'){reads++;return first.promise;}throw Error('no follow-up permitted');});
  const observer=new LoadedThreadSubscriptions(codex);observer.setEnabled(true);await until(()=>reads===1);
  observer.setEnabled(false);first.resolve({data:['old'],nextCursor:'more'});await tick();
  assert.equal(codex.calls.length,1);
  observer.close();codex.emit('ready');await tick();assert.equal(codex.calls.length,1);
  assert.equal(codex.listenerCount('ready'),0);assert.equal(codex.listenerCount('exit'),0);
});

test('a new connection generation restores subscriptions while old responses cannot continue',async t=>{
  const first=deferred();let pages=0;const resumed=[];
  const codex=client(async(method,params)=>{
    if(method==='thread/loaded/list')return ++pages===1?first.promise:{data:['new'],nextCursor:null};
    if(method==='thread/read')return {thread:{status:{type:'idle'}}};
    resumed.push(params.threadId);return {};
  });
  const observer=new LoadedThreadSubscriptions(codex);t.after(()=>observer.close());observer.setEnabled(true);await until(()=>pages===1);
  codex.state.initialized=false;codex.emit('exit');codex.state={initialized:true,shared:true,generation:2};codex.emit('ready');
  await until(()=>resumed.length===1);first.resolve({data:['stale'],nextCursor:'stale-page'});await tick();
  assert.deepEqual(resumed,['new']);assert.equal(pages,2);
  codex.state.generation=3;codex.emit('ready');await until(()=>resumed.length===2);assert.deepEqual(resumed,['new','new']);
});

test('a manual close or disabling during the loaded-state check prevents the queued resume',async()=>{
  for(const disable of [false,true]){
    const checking=deferred();let allowed=true;
    const codex=client(async method=>method==='thread/loaded/list'?{data:['root'],nextCursor:null}:checking.promise);
    const observer=new LoadedThreadSubscriptions(codex,{canSubscribe:()=>allowed});observer.setEnabled(true);await until(()=>codex.calls.length===2);
    if(disable)observer.setEnabled(false);else allowed=false;
    checking.resolve({thread:{status:{type:'idle'}}});await tick();
    assert.equal(codex.calls.filter(row=>row.method==='thread/resume').length,0);observer.close();
  }
});

test('uninitialized or managed connections are not observed; ready starts an enabled desktop observer',async t=>{
  const codex=client(async()=>({data:[],nextCursor:null}));codex.state.initialized=false;
  const observer=new LoadedThreadSubscriptions(codex);t.after(()=>observer.close());observer.setEnabled(true);await tick();assert.equal(codex.calls.length,0);
  codex.state={initialized:true,shared:false,generation:1};codex.emit('ready');await tick();assert.equal(codex.calls.length,0);
  codex.state={initialized:true,shared:true,generation:2};codex.emit('ready');await until(()=>codex.calls.length===1);
});

test('isolated websocket initialization emits ready and exposes a new generation on reconnect',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'loaded-subscriptions-'));
  const previousHome=process.env.CODEX_MOBILE_CONTROL_HOME,previousRestart=process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART;
  const directory=path.join(root,'desktop-bridge');fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory,'enabled.json'),'{}');fs.writeFileSync(path.join(directory,'shared-backend.mjs'),'');
  process.env.CODEX_MOBILE_CONTROL_HOME=root;process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART='0';
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  fs.writeFileSync(path.join(directory,'endpoint.json'),JSON.stringify({url:`ws://127.0.0.1:${server.address().port}`,token:'fixture'.repeat(8)}));
  server.on('connection',socket=>socket.on('message',raw=>{const message=JSON.parse(raw);if(message.id!==undefined)socket.send(JSON.stringify({id:message.id,result:{}}));}));
  const codex=new CodexAppServerClient(),ready=[];codex.on('ready',state=>ready.push(state));
  try{
    await codex.start();assert.equal(ready.length,1);assert.equal(ready[0].shared,true);assert.equal(ready[0].initialized,true);
    await codex.start();assert.equal(ready.length,1);
    await codex.stop();assert.equal(codex.connectionState().initialized,false);
    await codex.start();assert.equal(ready.length,2);assert(ready[1].generation>ready[0].generation);
  }finally{
    await codex.stop();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));
    if(previousHome===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousHome;
    if(previousRestart===undefined)delete process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART;else process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART=previousRestart;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
