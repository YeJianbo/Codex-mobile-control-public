import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';

process.env.CODEX_MOBILE_CONTROL_WS_HEARTBEAT_MS='50';
const {EventHub}=await import('../dist/services/eventHub.js');

test('real socket closures distinguish peer, missing pong and revoked access without logging payloads',{timeout:10000},async()=>{
  const records=[],clients=[];
  const hub=new EventHub({events:[],appendEvent:async()=>{}},()=>false,row=>records.push(row));
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});
  let authorized=true;
  server.on('connection',(socket,request)=>hub.add(socket,()=>authorized,true,'private-thread',request.url==='/public'?'public':'local'));
  await once(server,'listening');
  const wait=async predicate=>{
    const limit=performance.now()+3000;
    while(!predicate()){assert(performance.now()<limit,'expected connection diagnostic');await new Promise(resolve=>setTimeout(resolve,5));}
  };
  const connect=async (route,options)=>{
    const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}/${route}`,options);clients.push(socket);
    await once(socket,'open');return socket;
  };
  try{
    const normal=await connect('public');
    normal.send('private message body');normal.close(1000,'secret-token=do-not-record');
    await wait(()=>records.some(row=>row.event==='closed'));
    const peer=records.find(row=>row.event==='closed');
    assert.equal(peer.cause,'peer_close');assert.equal(peer.closeCode,1000);assert.equal(peer.route,'public');

    await connect('local',{autoPong:false});
    await wait(()=>records.some(row=>row.cause==='heartbeat_timeout'));
    const timedOut=records.find(row=>row.cause==='heartbeat_timeout');
    assert.equal(timedOut.route,'local');assert(timedOut.pingAgeMs>=0);assert(timedOut.heartbeatDelayMs>=0);

    await connect('local');authorized=false;hub.closeUnauthorized();
    await wait(()=>records.some(row=>row.cause==='unauthorized'));
    assert.equal(records.find(row=>row.cause==='unauthorized').closeCode,1008);
    assert.equal(records.filter(row=>row.event==='opened').length,3);
    assert.equal(records.filter(row=>row.event==='closed').length,3,'a terminate followed by close is logged once');
    for(const row of records){assert.equal(row.stream,'thread');assert(row.durationMs>=0);assert(row.bufferedBytes>=0);}
    const encoded=JSON.stringify(records);
    for(const secret of ['private-thread','private message body','secret-token','do-not-record'])assert(!encoded.includes(secret));
  }finally{
    for(const socket of clients)socket.terminate();
    for(const socket of server.clients)socket.terminate();
    await new Promise(resolve=>server.close(resolve));
  }
});
