import net from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {appHome} from './paths.js';

export type AgentHostInfo={port:number;token:string;pid:number;version:string;startedAt:string};
export type AgentHostEvent={seq:number;event:unknown};
type Request={type:'request';id:string;method:string;params:unknown[]};
type Hello={type:'hello';token:string};
type Ack={type:'ack';seq:number};
type Ready={type:'ready';version:string;pid:number;running:string[];seq:number};
type Response={type:'response';id:string;ok:boolean;result?:unknown;error?:string};
type EventMessage={type:'event';seq:number;event:unknown};
type ThreadCreated={type:'thread-created';requestId?:string;threadId:string};
type ServerMessage=Response|EventMessage|Ready|ThreadCreated;
type ClientMessage=Request|Hello|Ack;

export function agentHostInfoPath(scope=process.env.CODEX_MOBILE_CONTROL_AGENT_HOST_SCOPE||''){
  if(scope&&!/^[a-z][a-z0-9-]{0,40}$/.test(scope))throw Error('执行器分组无效');
  return path.join(appHome(),`agent-host${scope?'-'+scope:''}.json`);
}
export function readAgentHostInfo(scope?:string):AgentHostInfo|null{
  try{const value=JSON.parse(fs.readFileSync(agentHostInfoPath(scope),'utf8')) as AgentHostInfo;return typeof value.port==='number'&&typeof value.token==='string'&&typeof value.pid==='number'?value:null;}catch{return null;}
}
function packageVersion(){
  try{return String((JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {version?:string}).version||'');}catch{return '';}
}
function alive(pid:number){try{process.kill(pid,0);return true;}catch{return false;}}

export class AgentHostServer{
  private seq=0;
  private pending:AgentHostEvent[]=[];
  private sockets=new Set<net.Socket>();
  private server?:net.Server;
  private readonly startedAt=new Date().toISOString();
  constructor(private readonly token:string,private readonly version:string,private readonly handle:(method:string,params:unknown[])=>Promise<unknown>,private readonly running:()=>string[],private readonly created:(requestId:string|undefined,threadId:string)=>void){}
  async listen(){
    this.server=net.createServer(socket=>this.accept(socket));
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(0,'127.0.0.1',()=>resolve());});
    const address=this.server.address();
    if(!address||typeof address==='string')throw Error('无法获取执行器端口');
    const info:AgentHostInfo={port:address.port,token:this.token,pid:process.pid,version:this.version,startedAt:this.startedAt};
    const file=agentHostInfoPath();await fsp.mkdir(path.dirname(file),{recursive:true});
    await fsp.writeFile(file+'.tmp',JSON.stringify(info));
    await fsp.rename(file+'.tmp',file);
    return info;
  }
  private accept(socket:net.Socket){
    let authed=false;
    let buffer='';const decoder=new StringDecoder('utf8');
    const write=(message:ServerMessage)=>socket.write(JSON.stringify(message)+'\n');
    socket.on('data',chunk=>{
      buffer+=decoder.write(chunk);
      for(let index=buffer.indexOf('\n');index>=0;index=buffer.indexOf('\n')){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
        if(!line.trim())continue;
        let message:ClientMessage;
        try{message=JSON.parse(line) as ClientMessage;}catch{continue;}
        if(message.type==='hello'){
          if(message.token!==this.token){socket.destroy();return;}
          authed=true;this.sockets.add(socket);
          write({type:'ready',version:this.version,pid:process.pid,running:this.running(),seq:this.seq});
          for(const entry of this.pending)write({type:'event',seq:entry.seq,event:entry.event});
          continue;
        }
        if(!authed)return void socket.destroy();
        if(message.type==='ack'){
          this.pending=this.pending.filter(entry=>entry.seq>message.seq);
          continue;
        }
        if(message.type!=='request')continue;
        void this.handle(message.method,message.params).then(
          result=>write({type:'response',id:message.id,ok:true,result}),
          error=>write({type:'response',id:message.id,ok:false,error:String((error as Error)?.message||error)}),
        );
      }
    });
    socket.on('close',()=>this.sockets.delete(socket));
    socket.on('error',()=>this.sockets.delete(socket));
  }
  publish(event:unknown){
    const entry={seq:++this.seq,event};
    this.pending.push(entry);
    if(this.pending.length>4000)this.pending.splice(0,this.pending.length-4000);
    for(const socket of this.sockets)socket.write(JSON.stringify({type:'event',...entry})+'\n');
  }
  threadCreated(requestId:string|undefined,threadId:string){
    this.created(requestId,threadId);
    for(const socket of this.sockets)socket.write(JSON.stringify({type:'thread-created',requestId,threadId})+'\n');
  }
  get clients(){return this.sockets.size;}
  close(){
    for(const socket of this.sockets)socket.destroy();
    this.server?.close();
  }
}

export class AgentHostClient{
  private socket?:net.Socket;
  private ready=false;
  private buffer='';
  private nextId=0;
  private readonly waiting=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  private readonly events:(event:unknown)=>void;
  private readonly running:(ids:string[])=>void;
  private readonly created:(requestId:string|undefined,threadId:string)=>void;
  private connecting?:Promise<void>;
  private readyWait?:{resolve:()=>void;reject:(error:Error)=>void};
  private lastAck=0;
  version='';
  runningIds=new Set<string>();
  constructor(events:(event:unknown)=>void,running:(ids:string[])=>void,created:(requestId:string|undefined,threadId:string)=>void,private readonly onDisconnect?:()=>void,private readonly scope=''){this.events=events;this.running=running;this.created=created;}
  get connected(){return this.ready;}
  get outdated(){return this.version!==packageVersion();}
  async connect(){await this.ensure();}
  async restartIfIdle(){
    if(!this.outdated||this.runningIds.size)return;
    const info=readAgentHostInfo(this.scope);
    this.close();
    if(info&&alive(info.pid)){try{process.kill(info.pid,'SIGTERM');}catch{}await this.waitGone(info.pid);}
    await this.ensure();
  }
  private async ensure(){
    if(this.ready&&this.socket&&!this.socket.destroyed)return;
    if(this.connecting)return this.connecting;
    this.connecting=(async()=>{
      let info=readAgentHostInfo(this.scope);
      if(info&&alive(info.pid)){
        await this.attach(info);
        // Keep the old host while it still owns tasks; upgrade once it is idle.
        if(info.version===packageVersion()||this.runningIds.size)return;
        this.close();
        try{process.kill(info.pid,'SIGTERM');}catch{}
        await this.waitGone(info.pid);
      }
      info=await this.start();
      await this.attach(info);
    })().catch(error=>{throw error;}).finally(()=>{this.connecting=undefined;});
    return this.connecting;
  }
  private async waitGone(pid:number){
    const until=Date.now()+5000;
    while(Date.now()<until&&alive(pid))await new Promise(resolve=>setTimeout(resolve,100));
    if(!alive(pid))await fsp.rm(agentHostInfoPath(this.scope),{force:true}).catch(()=>{});
  }
  private async start():Promise<AgentHostInfo>{
    const file=agentHostInfoPath(this.scope);
    await fsp.mkdir(path.dirname(file),{recursive:true});
    const entry=file.replace(/\.json$/,'.lock');
    try{await fsp.writeFile(entry,String(process.pid),{flag:'wx'});}catch{
      const waitUntil=Date.now()+8000;
      while(Date.now()<waitUntil){
        const fresh=readAgentHostInfo(this.scope);
        if(fresh&&alive(fresh.pid))return fresh;
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      await fsp.rm(entry,{force:true}).catch(()=>{});
      await fsp.writeFile(entry,String(process.pid),{flag:'wx'}).catch(()=>{});
    }
    try{
      await fsp.rm(file,{force:true});
      const enabled=process.env.CODEX_MOBILE_CONTROL_AGENTS;
      const child=spawn(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.url)),'..','agentHost.js')],{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,CODEX_MOBILE_CONTROL_AGENT_HOST:'1',CODEX_MOBILE_CONTROL_AGENT_HOST_SCOPE:this.scope,
        ...(this.scope?{CODEX_MOBILE_CONTROL_AGENTS:!enabled||enabled.split(',').includes(this.scope)?this.scope:'none'}:{})}});
      child.unref();
      const waitUntil=Date.now()+15000;
      while(Date.now()<waitUntil){
        const fresh=readAgentHostInfo(this.scope);
        if(fresh&&alive(fresh.pid))return fresh;
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      throw Error('执行器启动超时，请重试');
    }finally{await fsp.rm(entry,{force:true}).catch(()=>{});}
  }
  private async attach(info:AgentHostInfo){
    await new Promise<void>((resolve,reject)=>{
      const socket=net.createConnection({host:'127.0.0.1',port:info.port});
      const timer=setTimeout(()=>{socket.destroy();reject(Error('执行器握手超时'));},8000);
      const fail=(error:Error)=>{clearTimeout(timer);socket.destroy();reject(error);};
      const ready=(error?:Error)=>{clearTimeout(timer);this.readyWait=undefined;if(error){socket.destroy();reject(error);}else{this.ready=true;resolve();}};
      this.readyWait={resolve:()=>ready(),reject:error=>ready(error)};
      socket.once('error',fail);
      socket.once('connect',()=>{
        socket.off('error',fail);
        socket.setNoDelay(true);
        this.socket=socket;this.buffer='';
        this.listen(socket);
        socket.write(JSON.stringify({type:'hello',token:info.token})+'\n');
      });
    });
  }
  private listen(socket:net.Socket){
    const decoder=new StringDecoder('utf8');
    socket.on('data',chunk=>{
      this.buffer+=decoder.write(chunk);
      for(let index=this.buffer.indexOf('\n');index>=0;index=this.buffer.indexOf('\n')){
        const line=this.buffer.slice(0,index);this.buffer=this.buffer.slice(index+1);
        if(!line.trim())continue;
        let message:ServerMessage;
        try{message=JSON.parse(line) as ServerMessage;}catch{continue;}
        if(message.type==='ready'){
          this.version=message.version;this.runningIds=new Set(message.running);this.running(message.running);
          if(this.lastAck)this.ack(this.lastAck);
          this.readyWait?.resolve();
          continue;
        }
        if(message.type==='event'){
          const event=message.event as {type?:string;threadId?:string};
          if(event.threadId){
            if(event.type==='turn.started')this.runningIds.add(event.threadId);
            else if(event.type==='turn.completed')this.runningIds.delete(event.threadId);
          }
          this.events(message.event);
          this.lastAck=Math.max(this.lastAck,message.seq);
          this.ack(message.seq);
          continue;
        }
        if(message.type==='thread-created'){this.created(message.requestId,message.threadId);continue;}
        const waiter=this.waiting.get(message.id);
        if(!waiter)continue;
        this.waiting.delete(message.id);
        if(message.ok)waiter.resolve(message.result);else waiter.reject(Error(message.error||'执行器请求失败'));
      }
    });
    const drop=()=>{
      if(this.socket!==socket)return;
      this.ready=false;this.socket=undefined;
      this.readyWait?.reject(Error('执行器连接已断开'));this.readyWait=undefined;
      for(const waiter of this.waiting.values())waiter.reject(Error('执行器连接已断开'));
      this.waiting.clear();this.onDisconnect?.();
    };
    socket.on('close',drop);socket.on('error',drop);
  }
  private ack(seq:number){if(this.socket?.writable)this.socket.write(JSON.stringify({type:'ack',seq})+'\n');}
  async request(method:string,params:unknown[]=[]):Promise<unknown>{
    await this.ensure();
    const socket=this.socket;
    if(!socket)throw Error('执行器未连接');
    const id=String(++this.nextId);
    return new Promise<unknown>((resolve,reject)=>{
      this.waiting.set(id,{resolve,reject});
      socket.write(JSON.stringify({type:'request',id,method,params})+'\n');
    });
  }
  close(){this.ready=false;this.socket?.destroy();this.socket=undefined;}
}
export function randomHostToken(){return randomUUID()+randomUUID();}
