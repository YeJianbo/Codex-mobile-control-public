import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WebSocket,WebSocketServer} from 'ws';
import {EventHub} from '../dist/services/eventHub.js';

class Socket extends EventEmitter {
  OPEN=1;readyState=1;bufferedAmount=0;sent=[];
  send(raw,callback){this.sent.push(JSON.parse(raw));callback?.();}
  close(code,reason){this.code=code;this.reason=reason;this.readyState=3;this.emit('close',code);}
  terminate(){this.readyState=3;this.emit('close',1006);}
}

test('a failed client cannot interrupt persistence, subscribers or other clients',async()=>{
  const saved=[],observed=[],diagnostics=[];
  const hub=new EventHub({events:[],appendEvent:async event=>saved.push(event)},()=>false,row=>diagnostics.push(row));
  const broken=new Socket(),asynchronous=new Socket(),healthy=new Socket();
  try{
    hub.add(broken);hub.add(asynchronous);hub.add(healthy);hub.subscribe(event=>observed.push(event));
    broken.send=()=>{throw Object.assign(Error('private error body'),{code:'EPIPE'});};
    asynchronous.send=(raw,callback)=>queueMicrotask(()=>callback(Object.assign(Error('private'),{code:'secret-token=value'})));
    hub.publish({type:'message.delta',threadId:'fixture',text:'one',eventId:'one'});
    await new Promise(resolve=>setImmediate(resolve));
    hub.publish({type:'message.delta',threadId:'fixture',text:'two',eventId:'two'});
    assert.deepEqual(saved.map(event=>event.eventId),['one','two']);assert.deepEqual(observed.map(event=>event.eventId),['one','two']);
    assert.deepEqual(healthy.sent.filter(event=>event.type==='message.delta').map(event=>event.eventId),['one','two']);
    const closed=diagnostics.filter(row=>row.event==='closed');assert.equal(closed.length,2);
    assert.equal(closed[0].cause,'socket_error');assert.equal(closed[0].errorCode,'EPIPE');assert.equal(closed[1].errorCode,undefined);
    assert(!JSON.stringify(diagnostics).includes('private'));assert(!JSON.stringify(diagnostics).includes('secret-token'));
  }finally{clearInterval(hub.heartbeatTimer);}
});

test('backpressure closes explicitly instead of skipping a frame and continuing',()=>{
  const diagnostics=[],hub=new EventHub({events:[],appendEvent:async()=>{}},()=>false,row=>diagnostics.push(row));
  const slow=new Socket(),fast=new Socket();
  try{
    hub.add(slow);hub.add(fast);slow.bufferedAmount=8*1024*1024;
    for(let index=0;index<3;index++)hub.publish({type:'message.delta',threadId:'fixture',eventId:String(index),text:'text'},false);
    assert.equal(slow.code,1013);assert.match(slow.reason,/reconnect.*history/);
    assert.equal(slow.sent.length,1);assert.equal(fast.sent.filter(event=>event.type==='message.delta').length,3);
    assert.equal(diagnostics.filter(row=>row.cause==='backpressure').length,1);
  }finally{clearInterval(hub.heartbeatTimer);}
});

test('an idle connection accepts one large frame without a deterministic replay loop',()=>{
  const hub=new EventHub({events:[],appendEvent:async()=>{}}),client=new Socket();
  try{
    hub.add(client);hub.publish({type:'message.delta',threadId:'fixture',text:'x'.repeat(9*1024*1024)},false);
    assert.equal(client.code,undefined);assert.equal(client.sent.at(-1).text.length,9*1024*1024);
  }finally{clearInterval(hub.heartbeatTimer);}
});

test('a paused real client is isolated while complete ordered text survives SQLite reopen',{timeout:30000},async()=>{
  const root=path.resolve(os.tmpdir()),home=await fs.mkdtemp(path.join(root,'event-delivery-'));
  const previousHome=process.env.CODEX_MOBILE_CONTROL_HOME;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const {StateStore}=await import('../dist/services/stateStore.js');
  const store=new StateStore();await store.load();
  const diagnostics=[],hub=new EventHub(store,()=>false,row=>{
    diagnostics.push(row);if(row.cause==='backpressure')setImmediate(()=>slow?._socket.resume());
  });
  const server=new WebSocketServer({port:0,host:'127.0.0.1'}),clients=[];
  server.on('connection',socket=>hub.add(socket));await once(server,'listening');
  let slow;const received=[];
  const connect=async rows=>{
    const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}`);clients.push(socket);
    socket.on('message',raw=>rows.push(JSON.parse(raw)));await once(socket,'open');return socket;
  };
  const wait=async predicate=>{
    const limit=performance.now()+5000;while(!predicate()){assert(performance.now()<limit,'expected delivery');await new Promise(resolve=>setTimeout(resolve,5));}
  };
  try{
    const slowRows=[];slow=await connect(slowRows);slow._socket.pause();const closed=once(slow,'close');
    await connect(received);
    const count=4000,text='x'.repeat(4096),ids=Array.from({length:count},(_,index)=>'event-'+index);
    for(let index=0;index<count;index++){
      hub.publish({type:'message.delta',threadId:'codex-fixture',text,eventId:ids[index],createdAt:new Date(1700000000000+index).toISOString()});
      if(index%64===63)await new Promise(resolve=>setImmediate(resolve));
    }
    await wait(()=>received.filter(row=>row.type==='message.delta').length===count);
    const [code,reason]=await closed;assert.equal(code,1013);assert.match(reason.toString(),/reconnect.*history/);
    assert.deepEqual(received.filter(row=>row.type==='message.delta').map(row=>row.eventId),ids);
    const prefix=slowRows.filter(row=>row.type==='message.delta').map(row=>row.eventId);assert(prefix.length<count);assert.deepEqual(prefix,ids.slice(0,prefix.length));
    assert.equal(diagnostics.filter(row=>row.cause==='backpressure').length,1);
    assert.equal(hub.persistenceStatus().ok,true);
    store.close();await store.load();
    const recovered=store.eventsForThread('codex-fixture');assert.deepEqual(recovered.map(row=>row.eventId),ids);
    assert.equal(recovered.map(row=>row.text).join(''),text.repeat(count));
    const replay=[];await connect(replay);await wait(()=>replay.some(row=>row.eventId===ids.at(-1)));
    assert.deepEqual(replay.filter(row=>row.type==='message.delta').map(row=>row.eventId),ids.slice(-100));
    assert(replay.filter(row=>row.type==='message.delta').every(row=>row.replayed));
  }finally{
    for(const client of clients)client.terminate();for(const socket of server.clients)socket.terminate();
    clearInterval(hub.heartbeatTimer);await new Promise(resolve=>server.close(resolve));store.close();
    if(previousHome===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousHome;
    assert(home.startsWith(root+path.sep));await fs.rm(home,{recursive:true,force:true});
  }
});
