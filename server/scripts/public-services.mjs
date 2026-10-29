import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';

function probe(url,timeout=1500) {
  return new Promise(resolve=>{
    const request=http.get(url,response=>{
      let body='';
      response.setEncoding('utf8');
      response.on('data',part=>{body+=part;if(body.length>16384)request.destroy();});
      response.on('error',()=>resolve(null));
      response.on('end',()=>resolve({status:response.statusCode,body}));
    });
    request.setTimeout(timeout,()=>request.destroy());
    request.on('error',()=>resolve(null));
  });
}

export class PublicServices {
  constructor({root,mobileHome,tunnelExecutable,systemMetricsPort=20241,managedMetricsPort=20242,startupTimeoutMs=30000}={}) {
    this.root=root;
    this.home=mobileHome||path.join(os.homedir(),'.codex-mobile-control');
    this.configFile=path.join(this.home,'public-access.json');
    this.tunnelConfig=path.join(this.home,'cloudflared.yml');
    this.tunnelExecutable=tunnelExecutable||[
      process.env.CLOUDFLARED_PATH,
      path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','cloudflared','cloudflared.exe'),
      path.join(process.env.ProgramFiles||'C:/Program Files','cloudflared','cloudflared.exe'),
    ].find(candidate=>candidate&&fs.existsSync(candidate));
    this.systemMetricsPort=systemMetricsPort;
    this.managedMetricsPort=managedMetricsPort;
    this.startupTimeoutMs=startupTimeoutMs;
    this.pending={};
  }
  configured() { return fs.existsSync(this.configFile); }
  settings() {
    const value=JSON.parse(fs.readFileSync(this.configFile,'utf8'));
    if(!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw new Error('Invalid public entry port');
    return value;
  }
  async entryHealthy() {
    if(!this.configured())return false;
    // Check the entry itself so a restarting Gateway cannot cause entry restart loops.
    const settings=this.settings();
    const prefix=settings.publicUrl?new URL(settings.publicUrl).pathname.replace(/\/$/,''):'';
    const result=await probe(`http://127.0.0.1:${settings.port}${prefix}/health`);
    return result?.status===401;
  }
  async tunnelHealthy() {
    const results=await Promise.all([this.systemMetricsPort,this.managedMetricsPort].map(port=>probe(`http://127.0.0.1:${port}/ready`)));
    return results.some(result=>{
      if(result?.status!==200)return false;
      try{return JSON.parse(result.body).readyConnections>0;}catch{return false;}
    });
  }
  async launch(name,executable,args,healthy) {
    if(this.pending[name])return this.pending[name];
    this.pending[name]=(async()=>{
      fs.mkdirSync(this.home,{recursive:true});
      const log=path.join(this.home,`${name}.log`);
      if(fs.existsSync(log)&&fs.statSync(log).size>1048576){
        fs.rmSync(log+'.previous',{force:true});fs.renameSync(log,log+'.previous');
      }
      const fd=fs.openSync(log,'a');
      let child;
      try{
        child=spawn(executable,args,{cwd:this.root,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});
        await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
        child.unref();
      }finally{fs.closeSync(fd);}
      const deadline=Date.now()+this.startupTimeoutMs;
      while(Date.now()<deadline){
        if(await healthy())return {reused:false,pid:child.pid};
        if(child.exitCode!==null)throw new Error(`${name} exited with code ${child.exitCode}; see ${name}.log`);
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      child.kill();
      throw new Error(`${name} readiness timed out; see ${name}.log`);
    })();
    try{return await this.pending[name];}finally{delete this.pending[name];}
  }
  async ensureEntry() {
    if(await this.entryHealthy())return {reused:true};
    return this.launch('public-entry',process.execPath,[path.join(this.root,'scripts','public-entry.mjs')],()=>this.entryHealthy());
  }
  async ensureTunnel() {
    if(await this.tunnelHealthy())return {reused:true};
    if(!this.tunnelExecutable||!fs.existsSync(this.tunnelConfig))throw new Error('Existing Cloudflared executable or configuration is missing');
    const settings=this.settings();
    const relay=settings.tunnelRelay;
    const direct=relay?.enabled===false;
    if(!direct&&(!relay?.enabled||!Array.isArray(relay.ports)||relay.ports.length!==2||!relay.ports.every(port=>Number.isInteger(port)&&port>=1024&&port<=65535)))throw new Error('Existing tunnel relay configuration is missing');
    return this.launch('public-tunnel',this.tunnelExecutable,[
      '--config',this.tunnelConfig,'--metrics',`127.0.0.1:${this.managedMetricsPort}`,
      '--protocol','http2',...(direct?[]:relay.ports.flatMap(port=>['--edge',`127.0.0.1:${port}`])),'tunnel','run',
    ],()=>this.tunnelHealthy());
  }
}
