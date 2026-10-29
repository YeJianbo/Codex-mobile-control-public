import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,createSign,randomUUID} from 'node:crypto';
import selfsigned from 'selfsigned';
import WebSocket,{WebSocketServer} from 'ws';
import {deviceProofTarget,verifyDeviceProof} from '../dist/services/deviceProof.js';
import {PublicServices} from './public-services.mjs';

test('public entry gates prefixes, forwards signed HTTP/WS and reloads a changed prefix',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'public-prefix-'));
  const issued=await selfsigned.generate([{name:'commonName',value:'localhost'}],{keySize:2048,extensions:[{name:'subjectAltName',altNames:[{type:2,value:'localhost'}]}]});
  const certificate=Buffer.from(issued.cert).toString('base64'),proxy='test-proxy-'.repeat(5),prefix='a'.repeat(64);
  const sockets=new Set();let child;
  const websocket=new WebSocketServer({noServer:true});
  const gateway=https.createServer({key:issued.private,cert:issued.cert},(req,res)=>{
    const signed=req.url==='/api/pair/claim'||req.url==='/api/projects?scope=a%2Fb';
    if(signed&&!verifyDeviceProof(certificate,req.method,deviceProofTarget(req.url,req.headers,proxy),req.headers)){res.writeHead(401).end();return;}
    if(req.url==='/downloads/android.apk'){res.end('test-apk');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({route:req.url,original:req.headers['x-public-request-target']}));
  });
  gateway.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  gateway.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/ws?token=test'||!verifyDeviceProof(certificate,'GET',deviceProofTarget(req.url,req.headers,proxy),req.headers)){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
    websocket.handleUpgrade(req,socket,head,ws=>{ws.send('connected');});
  });
  t.after(async()=>{
    if(child&&child.exitCode===null){child.kill();await once(child,'exit');}
    for(const client of websocket.clients)client.terminate();
    websocket.close();for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>gateway.close(resolve));
    await fs.rm(home,{recursive:true,force:true});
  });
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  const portReservation=http.createServer();await new Promise(resolve=>portReservation.listen(0,'127.0.0.1',resolve));
  const port=portReservation.address().port;await new Promise(resolve=>portReservation.close(resolve));
  const config={port,proxySecret:proxy,passwordSha256:createHash('sha256').update('test-password').digest('hex'),publicUrl:'https://phone.example.com/'+prefix};
  await fs.writeFile(path.join(home,'cert.pem'),issued.cert);
  await fs.writeFile(path.join(home,'server.json'),JSON.stringify({port:gateway.address().port,https:{enabled:true,certPath:path.join(home,'cert.pem')}}));
  const save=()=>fs.writeFile(path.join(home,'public-access.json'),JSON.stringify(config));await save();
  child=spawn(process.execPath,['scripts/public-entry.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,CODEX_MOBILE_CONTROL_HOME:home},stdio:['ignore','pipe','pipe'],windowsHide:true});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Entry did not listen')),10000);
    child.stdout.on('data',chunk=>{if(String(chunk).includes('listening')){clearTimeout(timer);resolve();}});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Entry exited '+code));});
    child.stderr.on('data',chunk=>{clearTimeout(timer);reject(Error(String(chunk)));});
  });
  function proof(target,method='GET'){
    const time=String(Date.now()),nonce=randomUUID(),signer=createSign('sha256');
    signer.update(`${method}\n${target}\n${time}\n${nonce}`);signer.end();
    return {'x-device-time':time,'x-device-nonce':nonce,'x-device-signature':signer.sign(issued.private).toString('base64')};
  }
  function request(target,headers={},method='GET'){
    return new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port,path:target,method,headers},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});
      req.on('error',reject);req.end();
    });
  }
  const auth={'x-remote-password':'test-password'};
  const services=new PublicServices({mobileHome:home});
  assert.equal(await services.entryHealthy(),true,'supervisor probes the prefixed health path without a password');
  for(const target of ['/health','/api/projects','/wrong/health','/'+prefix+'x/health','/'+prefix+'/../health','/'+prefix+'/%2e%2e/health'])assert.equal((await request(target,auth)).status,404,target);
  assert.equal((await request('/'+prefix+'/health')).status,401);
  assert.equal((await request('/'+prefix+'/health',auth)).status,200);
  const target='/'+prefix+'/api/projects?scope=a%2Fb';
  const good=await request(target,{...auth,...proof(target),'x-public-request-target':'/forged','x-public-proxy-secret':'forged'});
  assert.equal(good.status,200);assert.deepEqual(JSON.parse(good.body),{route:'/api/projects?scope=a%2Fb',original:target});
  assert.equal((await request(target,{...auth,...proof('/api/projects?scope=a%2Fb')})).status,401,'prefix is signed too');
  // Pair claims use the same trusted external target before a device token exists.
  assert.equal((await request('/'+prefix+'/api/pair/claim',auth,'POST')).status,401);
  const claim='/'+prefix+'/api/pair/claim';
  assert.equal((await request(claim,{...auth,...proof(claim,'POST')},'POST')).status,200);
  assert.equal((await request('/downloads/android.apk')).body,'test-apk');
  await new Promise((resolve,reject)=>{
    const target='/'+prefix+'/ws?token=test',ws=new WebSocket(`ws://127.0.0.1:${port}${target}`,{headers:{...auth,...proof(target)},handshakeTimeout:5000});
    ws.once('message',message=>{assert.equal(message.toString(),'connected');ws.close();resolve();});ws.once('error',reject);
  });
  const log=await fs.readFile(path.join(home,'public-connection.log'),'utf8');
  assert.equal(log.includes(prefix),false,'logs never contain the secret prefix');
  const entries=log.trim().split('\n').map(line=>JSON.parse(line));
  assert(entries.some(entry=>entry.route==='/health'&&entry.status===200));
  assert(entries.some(entry=>entry.route==='/ws'&&entry.status===101));
  config.publicUrl='https://phone.example.com/'+'b'.repeat(64);await save();
  assert.equal(await services.entryHealthy(),true);
  assert.equal((await request('/'+prefix+'/health',auth)).status,404);
  assert.equal((await request('/'+'b'.repeat(64)+'/health',auth)).status,200);
  config.publicUrl='https://phone.example.com';await save();
  assert.equal((await request('/health',auth)).status,200,'removing a prefix restores legacy clients');
});
