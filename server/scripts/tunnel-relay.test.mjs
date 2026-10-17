import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import net from 'node:net';
import {fragmentClientHello,createTunnelRelay} from './tunnel-relay.mjs';

const payload=Buffer.from(Array.from({length:120},(_,i)=>i));
const hello=Buffer.concat([Buffer.from([22,3,3,0,120]),payload]);
const subsequent=Buffer.from([23,3,3,0,2,8,9]);
function expected(){return Buffer.concat([Buffer.from([22,3,3,0,16]),payload.subarray(0,16),Buffer.from([22,3,3,0,104]),payload.subarray(16),subsequent]);}

test('TLS bytes survive every possible input packet boundary',async()=>{
  const input=Buffer.concat([hello,subsequent]);
  for(let cut=1;cut<input.length;cut++){
    const stream=fragmentClientHello(),chunks=[];
    stream.on('data',chunk=>chunks.push(chunk));
    const ended=once(stream,'end');
    stream.write(input.subarray(0,cut));stream.end(input.subarray(cut));
    await ended;assert.deepEqual(Buffer.concat(chunks),expected());
  }
});
test('truncated and invalid handshakes fail closed',async()=>{
  for(const data of [hello.subarray(0,2),hello.subarray(0,12),Buffer.from([1,3,3,255,255])]){
    const stream=fragmentClientHello();stream.resume();
    const error=once(stream,'error');stream.end(data);
    assert.match((await error)[0].message,/TLS ClientHello/);
  }
});
test('relay uses fixed edge CONNECT and preserves bidirectional bytes',async()=>{
  const sockets=new Set();let received=Buffer.alloc(0);
  const proxy=http.createServer();
  proxy.on('connect',(request,socket,head)=>{
    assert.equal(request.url,'region1.v2.argotunnel.com:7844');
    assert.equal(head.length,0);sockets.add(socket);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);if(received.length===expected().length)socket.write('edge-response');});
  });
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  const relay=createTunnelRelay({proxyPort:proxy.address().port,edgeHost:'region1.v2.argotunnel.com'});
  relay.listen(0,'127.0.0.1');await once(relay,'listening');
  const client=net.connect(relay.address().port,'127.0.0.1');
  try{
    await once(client,'connect');
    const answer=once(client,'data');client.write(Buffer.concat([hello,subsequent]));
    assert.equal((await answer)[0].toString(),'edge-response');assert.deepEqual(received,expected());
  }finally{client.destroy();for(const socket of sockets)socket.destroy();relay.close();proxy.close();}
});
