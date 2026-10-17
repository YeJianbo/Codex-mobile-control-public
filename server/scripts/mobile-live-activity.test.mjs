import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {WebSocket,WebSocketServer} from 'ws';
import {EventHub} from '../dist/services/eventHub.js';

test('opted sockets defer live and replay details without changing persistence or other events',async()=>{
 const events=[],listeners=[],store={events,appendEvent:async event=>events.push(event)};
 const hub=new EventHub(store),server=new WebSocketServer({port:0,host:'127.0.0.1'});
 const sockets=[];
 hub.subscribe(event=>listeners.push(event));
 server.on('connection',(socket,request)=>hub.add(socket,()=>true,request.url==='/deferred'));
 await once(server,'listening');
 async function connect(route){
  const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}${route}`),messages=[],signal=new EventEmitter();sockets.push(socket);
  socket.on('message',bytes=>{messages.push(JSON.parse(bytes));signal.emit('row')});
  const wait=async predicate=>{while(!messages.some(predicate))await once(signal,'row');return messages.find(predicate)};
  await wait(row=>row.type==='connected');return {wait,messages};
 }
 try{
  const full=await connect('/full'),mobile=await connect('/deferred');
  const output={type:'tool.completed',threadId:'codex-test',eventId:'tool',itemId:'item',turnId:'turn',requestId:'request',subagent:true,status:'ok',detail:'command output\n'.repeat(10000)};
  hub.publish(output);
  const original=await full.wait(row=>row.eventId==='tool'),summary=await mobile.wait(row=>row.eventId==='tool');
  assert.equal(original.detail,output.detail);assert.equal(summary.detail,undefined);assert.equal(summary.detailsDeferred,true);
  for(const key of ['turnId','itemId','requestId','subagent'])assert.equal(summary[key],output[key]);
  assert.equal(events[0].detail,output.detail);assert.equal(listeners[0].detail,output.detail);
  hub.publish({type:'diff.updated',threadId:'codex-test',eventId:'diff',diff:'+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new\n'});
  assert.deepEqual((await mobile.wait(row=>row.eventId==='diff')).fileChanges,[{path:'test.ts',added:1,removed:1}]);
  for(const [index,type] of ['reasoning.summary','message.delta','approval.requested','plan.updated','turn.completed'].entries()){
   hub.publish({type,threadId:'codex-test',eventId:`plain-${index}`,text:'keep body',detail:'keep detail'});
   assert.deepEqual(await mobile.wait(row=>row.eventId===`plain-${index}`),await full.wait(row=>row.eventId===`plain-${index}`));
  }
  const replay=await connect('/deferred'),replayed=await replay.wait(row=>row.eventId==='tool');
  assert.equal(replayed.replayed,true);assert.equal(replayed.detailsDeferred,true);assert.equal(replayed.detail,undefined);
  console.log(JSON.stringify({fixture:'isolated-loopback',fullBytes:Buffer.byteLength(JSON.stringify(original)),summaryBytes:Buffer.byteLength(JSON.stringify(summary))}));
 }finally{for(const socket of sockets)socket.terminate();clearInterval(hub.heartbeatTimer);await new Promise(resolve=>server.close(resolve))}
});

test('detail lookup reads archived IDs in requested order and stays within its thread',async()=>{
 const root=path.resolve('D:/codex/build/Codex-mobile-control'),home=await fs.mkdtemp(path.join(root,'activity119-'));
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 const {StateStore}=await import('../dist/services/stateStore.js');const store=new StateStore();
 try{
  await store.load();
  for(const threadId of ['codex-test','opencode-test'])for(let index=0;index<2;index++)await store.appendEvent({type:'tool.completed',threadId,eventId:`${threadId}-${index}`,detail:`body-${index}`,createdAt:new Date().toISOString()});
  for(let index=0;index<1001;index++)await store.appendEvent({type:'connected',eventId:`filler-${index}`});
  for(const threadId of ['codex-test','opencode-test']){
   assert(!store.events.some(row=>row.threadId===threadId));
   assert.deepEqual(store.eventsForIds(threadId,[`${threadId}-1`,'missing',`${threadId}-0`]).map(row=>row.detail),['body-1','body-0']);
  }
  assert.deepEqual(store.eventsForIds('other',['codex-test-0','opencode-test-0']),[]);
 }finally{store.close();assert(home.startsWith(root+path.sep));await fs.rm(home,{recursive:true,force:true})}
});
