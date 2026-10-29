import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AgentHostServer,AgentHostClient} from '../src/services/agentHostProtocol.ts';
import {RemoteAgentSessions} from '../src/services/remoteAgentSessions.ts';

test('agent host preserves fragmented long UTF-8 requests and tracks live turn ownership',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-host-framing-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
  process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const version=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).version;
  const requests=[],host=new AgentHostServer('fixture-token',version,async(method,params)=>{requests.push([method,params]);return params[0];},()=>[],()=>{});
  let socket,client;
  try{
    const info=await host.listen();
    socket=net.createConnection({host:'127.0.0.1',port:info.port});
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    const received=[];let buffer='';socket.setEncoding('utf8');socket.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){received.push(JSON.parse(buffer.slice(0,end)));buffer=buffer.slice(end+1);}});
    const wait=async condition=>{const until=Date.now()+5000;while(!condition()){assert(Date.now()<until,'host response timed out');await new Promise(resolve=>setTimeout(resolve,5));}};
    socket.write(JSON.stringify({type:'hello',token:'fixture-token'})+'\n');await wait(()=>received.some(message=>message.type==='ready'));
    const text='长消息'.repeat(25000)+'🙂中文';
    const wire=Buffer.from(JSON.stringify({type:'request',id:'fragmented',method:'echo',params:[text]})+'\n');
    const split=wire.indexOf(Buffer.from('🙂'))+1;
    socket.write(wire.subarray(0,split));await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(requests.length,0);socket.write(wire.subarray(split));
    await wait(()=>received.some(message=>message.id==='fragmented'));
    assert.equal(requests[0][1][0],text);assert.equal(received.find(message=>message.id==='fragmented').result,text);
    client=new AgentHostClient(()=>{},()=>{},()=>{});await client.connect();
    host.publish({type:'turn.started',threadId:'antigravity-fixture'});await wait(()=>client.runningIds.has('antigravity-fixture'));
    host.publish({type:'turn.completed',threadId:'antigravity-fixture',status:'completed'});await wait(()=>!client.runningIds.has('antigravity-fixture'));
  }finally{
    client?.close();socket?.destroy();host.close();
    if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});

test('opening an idle or finished harness conversation does not start a task',async()=>{
  const remote=new RemoteAgentSessions(()=>{});
  for(const status of ['idle','completed','error']){
    remote.track({type:'thread.started',threadId:'antigravity-fixture',thread:{status}});
    assert.equal(remote.owns('antigravity-fixture'),false);
  }
  remote.track({type:'turn.started',threadId:'antigravity-fixture'});assert(remote.owns('antigravity-fixture'));
  remote.track({type:'turn.completed',threadId:'antigravity-fixture',status:'completed'});assert(!remote.owns('antigravity-fixture'));
  await remote.close();
});
