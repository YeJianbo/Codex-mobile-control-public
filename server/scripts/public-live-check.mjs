import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import selfsigned from 'selfsigned';
import WebSocket from 'ws';

const home=path.join(os.homedir(),'.codex-mobile-control');
const gateway=JSON.parse(fs.readFileSync(path.join(home,'server.json'),'utf8'));
const entry=JSON.parse(fs.readFileSync(path.join(home,'public-access.json'),'utf8'));
const password=fs.readFileSync(path.join(home,'public-password.txt'),'utf8').trim();
const remoteUrl=process.argv[2]?new URL(process.argv[2]):undefined;
if(remoteUrl&&remoteUrl.protocol!=='https:')throw new Error('Remote check requires HTTPS');
const certificate=await selfsigned.generate([{name:'commonName',value:'temporary public check'}],{keySize:2048});
const encodedCertificate=Buffer.from(certificate.cert).toString('base64');
function request(publicEntry,method,target,headers={},payload){
  const body=payload===undefined?undefined:JSON.stringify(payload);
  const transport=publicEntry&&!remoteUrl?http:https;
  return new Promise((resolve,reject)=>{
    const req=transport.request({
      hostname:publicEntry&&remoteUrl?remoteUrl.hostname:'127.0.0.1',
      port:publicEntry?(remoteUrl?Number(remoteUrl.port||443):entry.port):gateway.port,path:target,method,
      ...(!publicEntry?{ca:fs.readFileSync(gateway.https.certPath),servername:'localhost'}:{}),
      headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)})},
      timeout:target.startsWith('/api/models')?30000:10000,
    },response=>{
      let text='';response.setEncoding('utf8');response.on('data',part=>text+=part);
    response.on('end',()=>{
      try { resolve({status:response.statusCode,body:text?JSON.parse(text):{}}); }
      catch { reject(new Error(`Public check received non-JSON HTTP ${response.statusCode}: ${text.slice(0,120)}`)); }
    });
    });
    req.on('timeout',()=>req.destroy(new Error(`request timeout: ${method} ${target.split('?')[0]}`)));
    req.on('error',reject);
    req.end(body);
  });
}
function requestBytes(target,headers){
  const transport=remoteUrl?https:http;
  return new Promise((resolve,reject)=>{
    const req=transport.request({
      hostname:remoteUrl?remoteUrl.hostname:'127.0.0.1',
      port:remoteUrl?Number(remoteUrl.port||443):entry.port,
      path:target,method:'GET',headers,timeout:10000,
    },response=>{
      const chunks=[];
      response.on('data',part=>chunks.push(part));
      response.on('end',()=>resolve({status:response.statusCode,bytes:Buffer.concat(chunks)}));
    });
    req.on('timeout',()=>req.destroy(new Error(`request timeout: GET ${target.split('?')[0]}`)));
    req.on('error',reject);
    req.end();
  });
}
function proof(method,target){
  const time=String(Date.now()),nonce=crypto.randomBytes(18).toString('base64url');
  const signer=crypto.createSign('sha256');signer.update(`${method}\n${target}\n${time}\n${nonce}`);signer.end();
  return {'X-Device-Time':time,'X-Device-Nonce':nonce,'X-Device-Signature':signer.sign(certificate.private).toString('base64')};
}
function checkSocket(target,headers){
  const base=remoteUrl??new URL(`http://127.0.0.1:${entry.port}`);
  const url=new URL(target,base);
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(url,{headers,handshakeTimeout:10000});
    const timer=setTimeout(()=>{socket.terminate();reject(new Error('WebSocket connected event timeout'));},10000);
    socket.once('message',raw=>{
      try{assert.equal(JSON.parse(raw.toString()).type,'connected');clearTimeout(timer);socket.close();resolve();}
      catch(error){clearTimeout(timer);socket.terminate();reject(error);}
    });
    socket.once('error',error=>{clearTimeout(timer);reject(error);});
    socket.once('close',(code,reason)=>{if(code===1008){clearTimeout(timer);reject(new Error(`WebSocket rejected: ${reason}`));}});
  });
}
const admin={Authorization:`Bearer ${gateway.token}`};
let device;
try {
  const pairing=await request(false,'POST','/api/pair/start',admin);
  assert.equal(pairing.status,200);
  const configuredPublicUrl=/^https:\/\/[^/?#]+\/?$/.test(entry.publicUrl||'')?entry.publicUrl.replace(/\/$/,''):'';
  assert.equal(pairing.body.publicUrl,configuredPublicUrl);
  assert.ok(pairing.body.setupUrl.includes('certSha256=')&&pairing.body.setupUrl.includes('publicUrl='));
  const claimTarget='/api/pair/claim';
  const claim=await request(true,'POST',claimTarget,{'X-Remote-Password':password,...proof('POST',claimTarget)},{code:pairing.body.code,certificate:encodedCertificate,name:'Temporary public security check'});
  assert.equal(claim.status,200);
  device=claim.body.device;
  const credentials={Authorization:`Bearer ${claim.body.token}`,'X-Remote-Password':password};
  assert.equal((await request(true,'GET','/api/projects',{'X-Remote-Password':'wrong'})).status,401);
  assert.equal((await request(true,'GET','/api/projects',credentials)).status,401);
  const projects=await request(true,'GET','/api/projects',{...credentials,...proof('GET','/api/projects')});
  assert.equal(projects.status,200);
  assert.ok(Array.isArray(projects.body.projects));
  const modelsTarget='/api/models?agents=all';
  const models=await request(true,'GET',modelsTarget,{...credentials,...proof('GET',modelsTarget)});
  assert.equal(models.status,200);
  assert.ok(models.body.models?.length>0,'Public model list must not be empty');
  for(const model of models.body.models){assert.equal(typeof model.model,'string');for(const effort of model.supportedReasoningEfforts||[])assert.equal(typeof effort.reasoningEffort,'string');}
  const sample=fs.readdirSync(path.join(home,'uploads'),{withFileTypes:true}).find(file=>file.isFile()&&/^[a-f\d-]{36}\.(png|jpe?g|webp|gif)$/.test(file.name));
  if(sample){
    const target=`/api/uploads/images/${sample.name}`;
    const image=await requestBytes(target,{...credentials,...proof('GET',target)});
    assert.equal(image.status,200,'Paired public device must be able to load image bytes');
    assert.deepEqual(image.bytes,fs.readFileSync(path.join(home,'uploads',sample.name)));
  }
  if(process.env.CODEX_PUBLIC_IMAGE_TARGET){
    const target=process.env.CODEX_PUBLIC_IMAGE_TARGET;
    if(!target.startsWith('/api/threads/')||!target.includes('/history-image?'))throw new Error('Invalid public image diagnostic target');
    const image=await requestBytes(target,{...credentials,...proof('GET',target)});
    assert.equal(image.status,200,'Paired public device must be able to load a historical image');
    assert.ok(image.bytes.length>0);
  }
  const searchTarget='/api/threads/search?q=CMC_NO_MATCH_CHECK_0627';
  const search=await request(true,'GET',searchTarget,{...credentials,...proof('GET',searchTarget)});
  assert.equal(search.status,200);
  assert.ok(Array.isArray(search.body.matches));
  const socketTarget=`/ws?token=${encodeURIComponent(claim.body.token)}&device=public-live-check`;
  await checkSocket(socketTarget,{'X-Remote-Password':password,...proof('GET',socketTarget)});
  assert.equal((await request(true,'GET','/console',{...credentials,...proof('GET','/console')})).status,404);
  assert.equal((await request(true,'GET','/api/terminal/history',{...credentials,...proof('GET','/api/terminal/history')})).status,404);
  assert.equal((await request(true,'POST','/api/projects',{...credentials,...proof('POST','/api/projects')},{path:'C:/outside'})).status,404);
  const project=projects.body.projects[0];
  if(project){
    const listTarget=`/api/projects/${encodeURIComponent(project.id)}/files`;
    assert.equal((await request(true,'GET',listTarget,{...credentials,...proof('GET',listTarget)})).status,200);
    const escapeTarget=`/api/projects/${encodeURIComponent(project.id)}/file?path=..%2Foutside.txt`;
    assert.notEqual((await request(true,'GET',escapeTarget,{...credentials,...proof('GET',escapeTarget)})).status,200);
  }
  console.log(`Public entry live check passed: ${models.body.models.length} models, password, device proof, image bytes, WebSocket, API allowlist and workspace boundary.`);
}finally{
  if(device?.id)await request(false,'DELETE',`/api/devices/${encodeURIComponent(device.id)}`,admin);
}
