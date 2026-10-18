import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {json} from './store.mjs';

export function portListening(port){
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port});
    const finish=(error,listening)=>{socket.destroy();if(error)reject(error);else resolve(listening);};
    socket.once('connect',()=>finish(null,true));
    socket.once('error',error=>finish(error.code==='ECONNREFUSED'?null:error,false));
    socket.setTimeout(1200,()=>finish(new Error('本机端口探测超时，暂不启动新实例')));
  });
}

export class GatewayService {
  constructor({root, configFile, codexHome, logDir, fetchImpl=fetch}={}) {
    this.root=root||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../gateway');
    this.codexHome=codexHome||process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
    const defaultHome=path.join(os.homedir(),'.codex');
    const mobileHome=process.env.CODEX_MOBILE_CONTROL_HOME||(path.resolve(this.codexHome)===path.resolve(defaultHome)?path.join(os.homedir(),'.codex-mobile-control'):path.join(this.codexHome,'mobile-control'));
    this.configFile=configFile||path.join(mobileHome,'server.json');
    this.logDir=logDir||path.join(path.dirname(this.configFile),'console-logs');
    this.fetch=fetchImpl;
    this.pending=null;
    this.lastError=null;
  }
  config(){
    const c=json(this.configFile);
    if(!c?.token||!Number.isInteger(c.port)||c.port<1||c.port>65535)throw new Error('网关配置缺失，请先配置 Codex 手机控制台');
    return c;
  }
  origin(){const c=this.config();return `${c.https?.enabled?'https':'http'}://127.0.0.1:${c.port}`;}
  async request(pathname,{headers,signal,method='GET',body}={}){
    const config=this.config();
    const url=this.origin()+pathname;
    const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
    const requestHeaders={...headers,...(bytes?{'Content-Type':'application/json','Content-Length':String(bytes.length)}:{})};
    if(this.fetch!==fetch)return this.fetch(url,{headers:requestHeaders,signal,method,body:bytes,redirect:'error'});
    return new Promise((resolve,reject)=>{
      const req=(config.https?.enabled?https:http).request(url,{...(config.https?.enabled?{ca:fs.readFileSync(config.https.certPath)}:{}),headers:requestHeaders,signal,method},response=>{
        let body='';
        response.setEncoding('utf8');
        response.on('data',chunk=>{
          body+=chunk;
          if(body.length>1048576)req.destroy(new Error('本机网关响应过大'));
        });
        response.on('error',reject);
        response.on('end',()=>resolve({ok:response.statusCode>=200&&response.statusCode<300,json:async()=>JSON.parse(body)}));
      });
      req.on('error',reject);
      req.end(bytes);
    });
  }
  async status(){
    let origin=null;
    try{
      origin=this.origin();
      const r=await this.request('/health',{signal:AbortSignal.timeout(1200)});
      const h=await r.json();
      if(!r.ok||!h.ok||!h.capabilities?.includes('pairing')||!h.capabilities?.includes('websocket-heartbeat'))throw new Error('端口上的服务不是兼容的 Codex 网关');
      return {running:true,origin,protocol:h.protocolVersion,capabilities:h.capabilities,sourceAvailable:fs.existsSync(path.join(this.root,'dist/index.js')),lastError:null};
    }catch(e){return {running:false,origin,sourceAvailable:fs.existsSync(path.join(this.root,'dist/index.js')),lastError:this.lastError||'网关尚未运行，或当前连接无法验证'};}
  }
  async ensure(){
    if(this.pending)return this.pending;
    this.pending=(async()=>{
      // Share the health check as well as startup across concurrent callers.
      if((await this.status()).running)return {running:true,reused:true};
      return this.launch();
    })();
    try{const result=await this.pending;this.lastError=null;return result;}
    catch(e){this.lastError=e.message;throw e;}
    finally{this.pending=null;}
  }
  async launch(){
    const config=this.config();
    // A busy event loop can miss HTTP health checks while still owning sessions.
    if(await portListening(config.port))throw new Error('网关端口仍有服务监听，但健康检查未通过，暂不启动新实例');
    const entry=path.join(this.root,'dist/index.js');
    if(!fs.existsSync(entry))throw new Error('后台监听模块尚未构建');
    fs.mkdirSync(this.logDir,{recursive:true});
    const log=path.join(this.logDir,'gateway.log');
    if(fs.existsSync(log)&&fs.statSync(log).size>5242880)fs.renameSync(log,log+'.previous');
    const fd=fs.openSync(log,'a');
    try{
      const child=spawn(process.execPath,[entry],{cwd:this.root,detached:true,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,CODEX_HOME:this.codexHome,CODEX_MOBILE_CONTROL_HOME:path.dirname(this.configFile)}});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(new Error('无法启动后台监听模块')));});
      child.unref();
      this.startedPid=child.pid;
    }finally{fs.closeSync(fd);}
    for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));if((await this.status()).running)return {running:true,reused:false};}
    throw new Error('后台监听启动超时，请检查 gateway.log');
  }
  async runtime(){
    const status=await this.status();
    if(!status.running)return status;
    const c=this.config();
    const r=await this.request('/api/codex/status',{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(3000)});
    // Older gateway versions can still be healthy without this optional endpoint.
    if(!r.ok)return status;
    const value=await r.json();
    return {...status,runtime:{running:value.codex?.running??value.running,initialized:value.codex?.initialized??value.initialized}};
  }
}
