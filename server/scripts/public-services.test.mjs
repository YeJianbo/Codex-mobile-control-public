import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {PublicServices} from './public-services.mjs';

async function listen(server) {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return server.address().port;
}
test('entry launches once, preserves a healthy process, and recovers after exit',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-guard-'));
  const allocation=http.createServer();const port=await listen(allocation);
  await new Promise(resolve=>allocation.close(resolve));
  fs.mkdirSync(path.join(root,'scripts'));
  fs.writeFileSync(path.join(root,'public-access.json'),JSON.stringify({port}));
  fs.writeFileSync(path.join(root,'scripts','public-entry.mjs'),`import http from 'node:http';http.createServer((q,r)=>r.writeHead(401).end()).listen(${port},'127.0.0.1');`);
  const service=new PublicServices({root,mobileHome:root,startupTimeoutMs:5000});
  const children=[];
  try {
    const [first,concurrent]=await Promise.all([service.ensureEntry(),service.ensureEntry()]);
    children.push(first.pid);
    assert.equal(first.pid,concurrent.pid);
    assert.deepEqual(await service.ensureEntry(),{reused:true});
    process.kill(first.pid);
    for(let i=0;i<30&&await service.entryHealthy();i++)await new Promise(resolve=>setTimeout(resolve,50));
    const replacement=await service.ensureEntry();children.push(replacement.pid);
    assert.notEqual(replacement.pid,first.pid);
    assert.equal(await service.entryHealthy(),true);
  } finally {
    for(const pid of children)try{process.kill(pid);}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
test('tunnel readiness requires live connections and reuses either healthy connector',async()=>{
  let connections=0;
  const system=http.createServer((q,r)=>r.writeHead(connections?200:503).end(JSON.stringify({readyConnections:connections})));
  const managed=http.createServer((q,r)=>r.writeHead(200).end(JSON.stringify({readyConnections:2})));
  const systemMetricsPort=await listen(system),managedMetricsPort=await listen(managed);
  const service=new PublicServices({systemMetricsPort,managedMetricsPort});
  try {
    assert.equal(await service.tunnelHealthy(),true);
    assert.deepEqual(await service.ensureTunnel(),{reused:true});
    await new Promise(resolve=>managed.close(resolve));
    assert.equal(await service.tunnelHealthy(),false);
    connections=2;
    assert.equal(await service.tunnelHealthy(),true);
  } finally {
    system.close();managed.close();
  }
});

test('fresh installs can explicitly use normal networking while existing relay configuration stays intact',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-network-mode-'));fs.writeFileSync(path.join(root,'cloudflared.yml'),'fixture');
  const service=new PublicServices({root,mobileHome:root,tunnelExecutable:process.execPath});service.tunnelHealthy=async()=>false;let args;
  service.launch=async(_name,_exe,value)=>{args=value;return {pid:1};};
  try{
    fs.writeFileSync(path.join(root,'public-access.json'),JSON.stringify({port:48763,tunnelRelay:{enabled:false}}));await service.ensureTunnel();assert(!args.includes('--edge'));assert(args.includes('http2'));
    fs.writeFileSync(path.join(root,'public-access.json'),JSON.stringify({port:48763,tunnelRelay:{enabled:true,ports:[18985,18986]}}));await service.ensureTunnel();assert.equal(args.filter(a=>a==='--edge').length,2);assert(args.includes('127.0.0.1:18986'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
