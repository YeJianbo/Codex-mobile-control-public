import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{if(pid>0){process.kill(pid,0);return true;}}catch(error){return error.code==='EPERM';}return false;};
const workspaceKey=cwd=>process.platform==='win32'?path.resolve(cwd).toLowerCase():path.resolve(cwd);
async function context(configPath){
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  const {WebSocket,WebSocketServer}=createRequire(path.join(config.gatewayRoot,'package.json'))('ws');
  return {config,WebSocket,WebSocketServer,directory:path.dirname(configPath),endpointPath:path.join(path.dirname(configPath),'endpoint.json')};
}
async function open(ctx){
  const endpoint=JSON.parse(await fs.readFile(ctx.endpointPath,'utf8'));
  if(!/^ws:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url)||typeof endpoint.token!=='string'||endpoint.token.length<32)throw Error('ZCode 共享端点无效');
  const socket=new ctx.WebSocket(endpoint.url,{headers:{Authorization:'Bearer '+endpoint.token},handshakeTimeout:1000,perMessageDeflate:false});
  socket.on('error',()=>{});
  try{await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);socket.once('close',()=>reject(Error('ZCode 共享连接关闭')));});return socket;}
  catch(error){socket.terminate();throw error;}
}
export async function connectSharedZcode(configPath){
  const ctx=await context(configPath);
  try{return await open(ctx);}catch{}
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--serve',configPath],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){try{return await open(ctx);}catch{}await sleep(100);}
  throw Error('ZCode 共享后端启动超时');
}
export async function readSharedZcodeStatus(configPath){
  const ctx=await context(configPath);let socket;
  try{socket=await open(ctx);}catch{return null;}
  try{return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('ZCode shared status timed out')),3000);
    socket.once('message',data=>{clearTimeout(timer);try{resolve(JSON.parse(data.toString()));}catch(error){reject(error);}});
    socket.once('close',()=>{clearTimeout(timer);reject(Error('ZCode shared status closed'));});
    socket.send(JSON.stringify({type:'status'}));
  });}finally{socket.close();}
}

/** One runtime per workspace; disconnecting a UI never terminates another UI's turn. */
export class ZcodeWorkspaceBridge{
  constructor({child,cwd,idleMs=60000,onIdle=()=>{},legacyBlocked=()=>false}){
    this.child=child;this.cwd=cwd;this.idleMs=idleMs;this.onIdle=onIdle;
    this.peers=new Set();this.requests=new Map();this.reverse=new Map();this.owners=new Map();this.active=new Set();this.watched=new Set();
    this.seq=0;this.closed=false;this.idleTimer=null;this.startup=new Map();this.legacyBlocked=legacyBlocked;
    this.reader=createInterface({input:child.stdout});this.reader.on('line',line=>{try{this.receive(JSON.parse(line));}catch{}});
    child.stderr?.resume();
    child.once('exit',()=>this.dispose(false));child.once('error',()=>this.dispose(false));
  }
  write(message){if(!this.closed&&this.child.stdin?.writable)this.child.stdin.write(JSON.stringify(message)+'\n');}
  send(peer,message){if(this.peers.has(peer))peer.send(message);}
  attach(peer){
    if(this.closed)throw Error('ZCode 共享运行时已关闭');
    clearTimeout(this.idleTimer);peer.sessions=new Set();peer.subscriptions=new Set();this.peers.add(peer);
  }
  replayStartup(peer){for(const message of this.startup.values())this.send(peer,message);}
  request(peer,message){
    if(!this.peers.has(peer)||!message||typeof message!=='object')return;
    if(message.id!==undefined&&!message.method){
      const entry=this.reverse.get(String(message.id));
      if(!entry||entry.peer!==peer)return;
      this.reverse.delete(String(message.id));clearTimeout(entry.timer);
      this.write({...message,id:entry.originalId});return;
    }
    if(typeof message.method!=='string')return;
    if(this.legacyBlocked(message)){
      this.send(peer,{id:message.id,error:{code:-32010,message:'该会话仍在旧 ZCode 后端执行，结束后即可连接共享会话'}});return;
    }
    const sid=message.params?.sessionId;
    if(typeof sid==='string'){peer.sessions.add(sid);this.routeWaiting(sid);}
    // A desktop window may release a runtime it only observes. Keep running sessions.
    if(message.method==='session/close'&&this.active.has(sid)){
      this.send(peer,{id:message.id,error:{code:-32010,message:'Session is still running'}});return;
    }
    const wp=message.params?.workspace?.workspacePath;
    if(wp&&workspaceKey(wp)!==workspaceKey(this.cwd)){
      this.send(peer,{id:message.id,error:{code:-32602,message:'Workspace does not match shared runtime'}});return;
    }
    if(message.method==='session/subscribe'&&sid)peer.subscriptions.add(sid);
    const sends=message.method==='session/send'||message.method==='v4/command'&&message.params?.type==='sendText';
    const creates=message.method==='session/create';
    const previousOwner=this.owners.get(sid);
    if((sends||creates)&&sid)this.owners.set(sid,peer);
    if(message.id===undefined){this.write(message);return;}
    const id='bridge-'+(++this.seq);
    const timer=setTimeout(()=>{this.requests.delete(id);this.send(peer,{id:message.id,error:{code:-32022,message:'ZCode shared request timed out'}});this.idle();},180000);timer.unref?.();
    this.requests.set(id,{peer,id:message.id,method:message.method,sid,sends,claims:sends||creates,previousOwner,timer});
    this.write({...message,id});
  }
  receive(message){
    if(this.closed)return;
    if(message.id!==undefined&&typeof message.method==='string'){
      const sid=message.params?.sessionId;
      const entry={originalId:message.id,message,sid,peer:null,timer:null};
      const id='reverse-'+(++this.seq);
      entry.timer=setTimeout(()=>{if(!this.reverse.delete(id))return;this.write({id:entry.originalId,error:{code:-32022,message:'ZCode interaction timed out'}});this.idle();},180000);entry.timer.unref?.();
      this.reverse.set(id,entry);this.routeReverse(id,entry);return;
    }
    if(message.id!==undefined){
      const key=String(message.id),request=this.requests.get(key);if(!request)return;
      this.requests.delete(key);clearTimeout(request.timer);
      if(request.resolve){request.resolve(message);return;}
      const rejected=message.error||request.method==='v4/command'&&request.sends&&!['accepted','duplicate'].includes(message.result?.status);
      if(rejected&&request.claims&&this.owners.get(request.sid)===request.peer){if(request.previousOwner)this.owners.set(request.sid,request.previousOwner);else this.owners.delete(request.sid);}
      if(!message.error&&request.method==='session/close'){this.watched.delete(request.sid);this.owners.delete(request.sid);}
      if(!message.error&&['session/create','session/resume'].includes(request.method)&&request.sid&&!this.watched.has(request.sid)){
        this.watched.add(request.sid);
        // Observe lifecycle internally even when the desktop uses only V4 frames.
        const watchId='watch-'+(++this.seq);
        this.write({id:watchId,method:'session/subscribe',params:{sessionId:request.sid,deliveryKind:'desktop-continuous'}});
      }
      this.send(request.peer,{...message,id:request.id});this.idle();return;
    }
    if(message.method==='startup/storageState')this.startup.set(message.params?.databaseId||'session',message);
    if(message.method==='session/event'){
      const sid=message.params?.sessionId,type=message.params?.type;
      if(type==='turn.started')this.active.add(sid);
      if(type==='turn.completed'||type==='turn.failed')this.active.delete(sid);
      for(const peer of this.peers)if(peer.subscriptions.has(sid))this.send(peer,message);
    }else{
      for(const peer of this.peers)this.send(peer,message);
    }
    this.idle();
  }
  routeReverse(id,entry){
    const owner=this.owners.get(entry.sid);
    // Provider/preferences can arrive while session/create itself is still pending.
    const pending=[...this.requests.values()].reverse().find(request=>this.peers.has(request.peer)&&(!entry.sid||request.sid===entry.sid))?.peer;
    const eligible=[...this.peers].filter(peer=>!entry.sid||peer.sessions.has(entry.sid));
    const peer=this.peers.has(owner)?owner:pending||eligible.find(peer=>peer.role==='desktop')||eligible[0];
    if(!peer)return;
    entry.peer=peer;this.send(peer,{...entry.message,id});
  }
  routeWaiting(sid){for(const [id,entry]of this.reverse)if(!entry.peer&&(!entry.sid||entry.sid===sid))this.routeReverse(id,entry);}
  detach(peer){
    if(!this.peers.delete(peer))return;
    for(const [sid,owner]of this.owners)if(owner===peer)this.owners.delete(sid);
    for(const [id,entry]of this.reverse)if(entry.peer===peer){entry.peer=null;this.routeReverse(id,entry);}
    this.idle();
  }
  idle(){
    clearTimeout(this.idleTimer);
    if(this.closed||this.peers.size||this.active.size||this.reverse.size||this.requests.size)return;
    this.idleTimer=setTimeout(()=>void this.reclaim(),this.idleMs);this.idleTimer.unref?.();
  }
  async reclaim(){
    const snapshots=await Promise.all([...this.watched].map(sid=>new Promise(resolve=>{
      const id='idle-'+(++this.seq),timer=setTimeout(()=>{this.requests.delete(id);resolve(null);},5000);timer.unref?.();
      this.requests.set(id,{resolve,timer});this.write({id,method:'session/read',params:{sessionId:sid,contentProfile:'index'}});
    })));
    if(this.closed||this.peers.size||this.active.size||this.reverse.size||this.requests.size)return;
    const terminal=new Set(['completed','failed','cancelled','exited','done','terminated']);
    const busy=snapshots.some(row=>{
      if(row?.error?.code===-32004)return false; // Native resident pool already released it.
      const projection=row?.result?.projection;
      return !projection||['running','waiting'].includes(projection.status)||projection.target?.status==='active'
        ||projection.pendingPermissions?.length||projection.activeToolCalls?.some(tool=>['pending','running'].includes(tool.status))
        ||projection.backgroundJobs?.some(job=>!terminal.has(job.status||job.state));
    });
    if(busy){this.idle();return;}
    this.dispose();this.onIdle();
  }
  dispose(kill=true){
    if(this.closed)return;this.closed=true;clearTimeout(this.idleTimer);this.reader.close();
    for(const entry of this.requests.values()){clearTimeout(entry.timer);entry.resolve?.(null);}
    for(const entry of this.reverse.values())clearTimeout(entry.timer);
    this.requests.clear();this.reverse.clear();
    for(const peer of this.peers)peer.close();this.peers.clear();
    if(kill){
      this.child.stdin.end();
      const timer=setTimeout(()=>{
        if(process.platform==='win32'&&this.child.pid)spawn('taskkill.exe',['/PID',String(this.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
        else this.child.kill();
      },5000);timer.unref?.();this.child.once('exit',()=>clearTimeout(timer));
    }
  }
}

async function serve(configPath){
  const ctx=await context(configPath),lockPath=path.join(ctx.directory,'owner.lock');
  await fs.mkdir(ctx.directory,{recursive:true});
  for(;;){
    try{const lock=await fs.open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));await lock.close();break;}
    catch(error){if(error.code!=='EEXIST')throw error;let pid=0;try{pid=Number(await fs.readFile(lockPath,'utf8'));}catch{}if(!pid||alive(pid))return;await fs.unlink(lockPath).catch(()=>{});}
  }
  const token=crypto.randomBytes(32).toString('hex'),runtimes=new Map();
  const server=new ctx.WebSocketServer({host:'127.0.0.1',port:0,perMessageDeflate:false,maxPayload:32*1024*1024,verifyClient:({req})=>req.headers.authorization==='Bearer '+token});
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const endpoint={url:'ws://127.0.0.1:'+server.address().port,token,pid:process.pid};
  await fs.writeFile(ctx.endpointPath+'.pending',JSON.stringify(endpoint),{mode:0o600});await fs.rename(ctx.endpointPath+'.pending',ctx.endpointPath);
  server.on('connection',socket=>{
    let runtime,peer;
    const timeout=setTimeout(()=>socket.close(1008,'attach timeout'),5000);
    socket.on('error',()=>{});
    socket.on('message',data=>{
      let message;try{message=JSON.parse(data.toString());}catch{return void socket.close(1007);}
      if(!runtime){
        if(message.type==='status'){
          clearTimeout(timeout);socket.send(JSON.stringify({type:'status',pid:process.pid,runtimes:[...runtimes.values()].filter(runtime=>!runtime.closed).map(runtime=>({cwd:runtime.cwd,pid:runtime.child.pid,clients:runtime.peers.size,activeSessions:[...runtime.active],pendingInteractions:runtime.reverse.size}))}));socket.close();return;
        }
        if(message.type!=='attach'||!['desktop','gateway'].includes(message.role)||typeof message.cwd!=='string'||!path.isAbsolute(message.cwd))return void socket.close(1008);
        clearTimeout(timeout);const key=workspaceKey(message.cwd);
        runtime=runtimes.get(key);
        if(runtime?.closed){runtimes.delete(key);runtime=null;}
        if(!runtime){
          const env={...process.env,...ctx.config.env};
          // The override belongs to the desktop's process manager, not its native children.
          delete env.ZCODE_AGENT_SERVER_COMMAND;delete env.ZCODE_AGENT_SERVER_ARGS_JSON;
          for(const [name,value]of Object.entries(message.env||{}))if(/^ZCODE_/.test(name)&&!['ZCODE_AGENT_SERVER_COMMAND','ZCODE_AGENT_SERVER_ARGS_JSON'].includes(name)&&typeof value==='string')env[name]=value;
          const child=spawn(ctx.config.command,[...(ctx.config.args||[]),'app-server','--stdio','--surface','desktop'],{cwd:message.cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
          const legacyBlocked=request=>{
            const sid=request.params?.sessionId,topic=request.params?.topic;
            return(ctx.config.legacySessions||[]).some(id=>(id===sid||typeof topic==='string'&&topic.includes(id))&&(ctx.config.legacyOwners?.[id]||ctx.config.legacyPids||[]).some(alive));
          };
          runtime=new ZcodeWorkspaceBridge({child,cwd:message.cwd,legacyBlocked,onIdle:()=>{if(runtimes.get(key)===runtime)runtimes.delete(key);}});
          runtimes.set(key,runtime);
        }
        peer={role:message.role,send:value=>{if(socket.readyState===ctx.WebSocket.OPEN){if(socket.bufferedAmount>32*1024*1024)socket.close(1013,'consumer too slow');else socket.send(JSON.stringify(value));}},close:()=>socket.close(1011,'ZCode runtime exited')};
        if(runtime.closed)return void socket.close(1011,'ZCode runtime exited');
        runtime.attach(peer);peer.send({type:'attached',pid:runtime.child.pid});runtime.replayStartup(peer);return;
      }
      runtime.request(peer,message);
    });
    socket.on('close',()=>{clearTimeout(timeout);if(peer)runtime.detach(peer);});
  });
  const cleanup=async()=>{
    for(const runtime of runtimes.values())runtime.dispose();server.close();
    try{if(JSON.parse(await fs.readFile(ctx.endpointPath,'utf8')).pid===process.pid)await fs.unlink(ctx.endpointPath);}catch{}
    await fs.unlink(lockPath).catch(()=>{});
  };
  process.once('SIGTERM',()=>void cleanup().finally(()=>process.exit(0)));
  process.once('SIGINT',()=>void cleanup().finally(()=>process.exit(0)));
  let idleSince=Date.now();
  setInterval(()=>{for(const [key,runtime]of runtimes)if(runtime.closed)runtimes.delete(key);if(runtimes.size||server.clients.size)idleSince=Date.now();else if(Date.now()-idleSince>60000)void cleanup().finally(()=>process.exit(0));},10000).unref();
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--serve'){
  serve(process.argv[3]).catch(error=>{process.stderr.write(String(error.message)+'\n');process.exitCode=1;});
}
