import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {permittedPublicRequest,isPublicAndroidDownload} from './public-routes.mjs';
import {publicAccessRequestTarget} from '../dist/services/publicAccessUrl.js';
import {startTunnelRelays} from './tunnel-relay.mjs';

const home=process.env.CODEX_MOBILE_CONTROL_HOME||path.join(os.homedir(),'.codex-mobile-control');
const settings=JSON.parse(fs.readFileSync(path.join(home,'public-access.json'),'utf8'));
const gateway=JSON.parse(fs.readFileSync(path.join(home,'server.json'),'utf8'));
if(!gateway.https?.enabled)throw new Error('Gateway HTTPS must be enabled before public access');
const ca=fs.readFileSync(gateway.https.certPath);
const passwordHash=Buffer.from(settings.passwordSha256,'hex');
if(passwordHash.length!==32)throw new Error('Invalid public password hash');
if(typeof settings.proxySecret!=='string'||settings.proxySecret.length<40)throw new Error('Invalid public proxy secret');
const port=Number(settings.port);
if(!Number.isInteger(port)||port<1024||port>65535||port===gateway.port)throw new Error('Invalid public entry port');

function connectionLog(req,status,target=req.url) {
  // Record connection failures without addresses, query strings or credentials.
  const pathname=new URL(target||'/', 'http://localhost').pathname;
  if(status<400&&pathname!=='/health'&&pathname!=='/ws')return;
  const route=['/health','/ws'].includes(pathname)?pathname:'/api/*';
  const client=(req.headers['user-agent']||'').startsWith('okhttp/')?'android':'other';
  try{
    const file=path.join(home,'public-connection.log');
    if(fs.existsSync(file)&&fs.statSync(file).size>262144)fs.writeFileSync(file,'');
    fs.appendFileSync(file,JSON.stringify({time:new Date().toISOString(),route,status,client})+'\n');
  }catch{}
}

function authorized(req,current){
  const supplied=req.headers['x-remote-password'];
  const digest=crypto.createHash('sha256').update(typeof supplied==='string'?supplied:'').digest();
  try{
    const expected=Buffer.from(current.passwordSha256,'hex');
    return expected.length===32&&crypto.timingSafeEqual(expected,digest);
  }catch{return false;}
}
function publicRequest(req){
  try{
    const current=JSON.parse(fs.readFileSync(path.join(home,'public-access.json'),'utf8'));
    // Keep the already-public signed APK URL stable for existing update links.
    const target=isPublicAndroidDownload(req.method,req.url)?req.url:publicAccessRequestTarget(req.url||'/',current.publicUrl);
    return target&&permittedPublicRequest(req.method,target)?{target,current}:null;
  }catch{return null;}
}
function reject(socket,status,message){
  const body=JSON.stringify({error:message});
  socket.end(`HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n${body}`);
}
function upstreamHeaders(req){
  const headers={...req.headers,host:`localhost:${gateway.port}`};
  delete headers['x-remote-password'];
  delete headers['cf-access-jwt-assertion'];
  delete headers['cf-connecting-ip'];
  delete headers['x-forwarded-for'];
  headers['x-public-request-target']=req.url;
  headers['x-public-proxy-secret']=settings.proxySecret;
  return headers;
}
const server=http.createServer((req,res)=>{
  const route=publicRequest(req);
  res.once('finish',()=>connectionLog(req,res.statusCode,route?.target));
  if(!route){res.writeHead(404,{'Cache-Control':'no-store'}).end();return;}
  if(!isPublicAndroidDownload(req.method,route.target)&&!authorized(req,route.current)){res.writeHead(401,{'Cache-Control':'no-store'}).end();return;}
  const upstream=https.request({hostname:'localhost',port:gateway.port,path:route.target,method:req.method,headers:upstreamHeaders(req),ca,servername:'localhost'},response=>{
    res.writeHead(response.statusCode||502,response.headers);
    response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502).end();else res.destroy();});
  req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
  const route=publicRequest(req);
  if(!route){connectionLog(req,404);reject(socket,'404 Not Found','not_found');return;}
  if(!authorized(req,route.current)){connectionLog(req,401,route.target);reject(socket,'401 Unauthorized','unauthorized');return;}
  const upstream=https.request({hostname:'localhost',port:gateway.port,path:route.target,method:'GET',headers:upstreamHeaders(req),ca,servername:'localhost'});
  upstream.on('upgrade',(response,remote,remoteHead)=>{
    connectionLog(req,response.statusCode||101,route.target);
    socket.write(`HTTP/1.1 ${response.statusCode||101} Switching Protocols\r\n`);
    for(const [name,value] of Object.entries(response.headers))if(value)socket.write(`${name}: ${value}\r\n`);
    socket.write('\r\n');
    if(remoteHead.length)socket.write(remoteHead);
    if(head.length)remote.write(head);
    socket.pipe(remote).pipe(socket);
  });
  upstream.on('response',response=>{connectionLog(req,response.statusCode||502,route.target);reject(socket,`${response.statusCode||502} Rejected`,'upstream_rejected');});
  upstream.on('error',()=>{connectionLog(req,502,route.target);socket.destroy();});
  upstream.end();
});
await startTunnelRelays(settings.tunnelRelay);
server.listen(port,'127.0.0.1',()=>console.log(`Public API entry listening on 127.0.0.1:${port}`));
