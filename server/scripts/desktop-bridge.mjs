import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import readline from 'node:readline';
import {resolveDesktopCli} from './desktop-cli-resolver.mjs';

const [configPath,...args]=process.argv.slice(2);
const config=JSON.parse(await fs.readFile(configPath,'utf8'));
config.realCli=await resolveDesktopCli(config.realCli);
const env={...process.env,CODEX_CLI_PATH:config.realCli,PATH:path.dirname(config.realCli)+path.delimiter+(process.env.PATH||'')};
const commandIndex=args.indexOf('app-server');
const subcommands=new Set(['daemon','proxy','generate-ts','generate-json-schema','help']);
if(commandIndex<0||subcommands.has(args[commandIndex+1])||args.includes('--help')||args.includes('-h')) {
  const child=spawn(config.realCli,args,{stdio:'inherit',windowsHide:true,env});
  child.once('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code??1;});
} else {
  const require=createRequire(path.join(config.gatewayRoot,'package.json'));
  const WebSocket=require('ws');
  const directory=path.dirname(configPath);
  const endpointPath=path.join(directory,'endpoint.json');
  const ownerPath=path.join(directory,'owner.lock');
  async function attachExisting(){
    try{
      const endpoint=JSON.parse(await fs.readFile(endpointPath,'utf8'));
      if(!/^ws:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url)||typeof endpoint.token!=='string'||endpoint.token.length<32)return null;
      const socket=new WebSocket(endpoint.url,{headers:{Authorization:`Bearer ${endpoint.token}`},handshakeTimeout:1000});
      try{await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);socket.once('close',()=>reject(Error('closed')));});return socket;}
      catch{socket.terminate();return null;}
    }catch{return null;}
  }
  let secondary=await attachExisting();
  let owner=false;
  const deadline=Date.now()+20000;
  while(!secondary&&!owner){
    try{
      const lock=await fs.open(ownerPath,'wx',0o600);
      await lock.writeFile(String(process.pid));await lock.close();owner=true;
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      secondary=await attachExisting();
      if(secondary)break;
      let pid=0;try{pid=Number(await fs.readFile(ownerPath,'utf8'));}catch{}
      let alive=false;try{if(pid>0){process.kill(pid,0);alive=true;}}catch(e){alive=e.code==='EPERM';}
      if(pid>0&&!alive){try{await fs.unlink(ownerPath);}catch{}}
      if(Date.now()>deadline)throw Error('shared app-server startup timed out');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  if(secondary){
    const reader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
    reader.on('line',line=>secondary.send(line));
    secondary.on('message',data=>process.stdout.write(data.toString()+'\n'));
    let expectedClose=false;
    process.stdin.once('end',()=>{expectedClose=true;reader.close();secondary.close();});
    secondary.once('close',()=>{reader.close();process.exitCode=expectedClose?0:1;});
  }else{
  const tokenPath=path.join(directory,`transport-token-${process.pid}`);
  const token=crypto.randomBytes(32).toString('hex');
  await fs.writeFile(tokenPath,token,{mode:0o600});
  const approvalMethods=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput']);
  const approvalPeers=new Set();
  const pendingApprovals=new Map();
  const resolvedApprovals=new Set();
  const approvalServer=new WebSocket.Server({host:'127.0.0.1',port:0,verifyClient:({req})=>req.headers.authorization===`Bearer ${token}`});
  await new Promise((resolve,reject)=>{approvalServer.once('listening',resolve);approvalServer.once('error',reject);});
  const approvalUrl=`ws://127.0.0.1:${approvalServer.address().port}`;
  const broadcastApproval=message=>{const wire=JSON.stringify(message);for(const peer of approvalPeers)if(peer.readyState===WebSocket.OPEN)peer.send(wire);};
  const finishApproval=(key,skipPeer)=>{const request=pendingApprovals.get(key);if(!request)return;pendingApprovals.delete(key);resolvedApprovals.add(String(request.id));if(resolvedApprovals.size>100)resolvedApprovals.delete(resolvedApprovals.values().next().value);const wire=JSON.stringify({type:'resolved',id:key,threadId:request.params?.threadId||'unknown'});for(const peer of approvalPeers)if(peer!==skipPeer&&peer.readyState===WebSocket.OPEN)peer.send(wire);};
  approvalServer.on('connection',peer=>{
    approvalPeers.add(peer);
    peer.send(JSON.stringify({type:'snapshot',requests:[...pendingApprovals.values()].map(request=>({id:request.key,method:request.method,params:request.params}))}));
    peer.on('message',data=>{
      let message;try{message=JSON.parse(data.toString());}catch{return;}
      if(message?.type!=='resolve'||typeof message.id!=='string'||!message.result||typeof message.result!=='object')return;
      const request=pendingApprovals.get(message.id);
      if(!request||socket?.readyState!==WebSocket.OPEN){peer.send(JSON.stringify({type:'resolution',id:message.id,ok:false}));return;}
      socket.send(JSON.stringify({id:request.id,result:message.result}),error=>{
        if(!error)finishApproval(message.id,peer);
        if(peer.readyState===WebSocket.OPEN)peer.send(JSON.stringify({type:'resolution',id:message.id,ok:!error}));
      });
    });
    peer.once('close',()=>approvalPeers.delete(peer));
  });
  const port=await new Promise((resolve,reject)=>{
    const probe=net.createServer();probe.once('error',reject);
    probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(error=>error?reject(error):resolve(port));});
  });
  const url=`ws://127.0.0.1:${port}`;
  const childArgs=[];
  for(let i=0;i<args.length;i++){
    if(i>commandIndex&&args[i]==='--listen'){i++;continue;}
    if(i>commandIndex&&(args[i]==='--stdio'||args[i].startsWith('--listen=')))continue;
    childArgs.push(args[i]);
  }
  childArgs.push('--listen',url,'--ws-auth','capability-token','--ws-token-file',tokenPath);
  const child=spawn(config.realCli,childArgs,{stdio:['ignore','ignore','pipe'],windowsHide:true,env});
  let closed=false,childExited=false,socket;
  const input=[];
  let inputBytes=0;
  const reader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  async function shutdown(code=0){
    if(closed)return;
    closed=true;
    try{const current=JSON.parse(await fs.readFile(endpointPath,'utf8'));if(current.bridgePid===process.pid)await fs.unlink(endpointPath);}catch{}
    try{const pid=Number(await fs.readFile(ownerPath,'utf8'));if(pid===process.pid)await fs.unlink(ownerPath);}catch{}
    reader.close();socket?.close();approvalServer.close();
    if(!childExited)child.kill();
    setTimeout(()=>process.exit(code),250).unref();
  }
  reader.on('line',line=>{
    try{const message=JSON.parse(line);if(message.id!==undefined&&!message.method){const request=[...pendingApprovals.values()].find(item=>item.id===message.id);if(request)finishApproval(request.key);else if(resolvedApprovals.has(String(message.id)))return;}}catch{}
    if(socket?.readyState===WebSocket.OPEN)socket.send(line);
    else {inputBytes+=Buffer.byteLength(line);if(inputBytes>64*1024*1024){process.stderr.write('Desktop bridge input exceeded capacity\n');void shutdown(1);}else input.push(line);}
  });
  process.stdin.once('end',()=>void shutdown());
  process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
  child.stderr.on('data',data=>process.stderr.write(data));
  child.once('error',error=>{process.stderr.write(error.message+'\n');void shutdown(1);});
  child.once('exit',code=>{childExited=true;void shutdown(code??1);});
  try {
    const deadline=Date.now()+20000;
    while(!closed&&!socket){
      try{
        const candidate=new WebSocket(url,{headers:{Authorization:`Bearer ${token}`},handshakeTimeout:1000});
        candidate.on('error',()=>{});
        await new Promise((resolve,reject)=>{candidate.once('open',resolve);candidate.once('error',reject);candidate.once('close',()=>reject(new Error('connection closed')));});
        socket=candidate;
      }catch(error){if(Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
    }
    if(!closed){
      socket.on('message',data=>{
        const line=data.toString();
        try{const message=JSON.parse(line);if(message.id!==undefined&&approvalMethods.has(message.method)){
          const key=`desktop:${process.pid}:${String(message.id)}`;
          const request={key,id:message.id,method:message.method,params:message.params||{}};
          pendingApprovals.set(key,request);
          broadcastApproval({type:'request',request:{id:key,method:request.method,params:request.params}});
        }else if(message.method==='serverRequest/resolved'){
          for(const request of pendingApprovals.values())if(request.id===message.params?.requestId)finishApproval(request.key);
        }}catch{}
        process.stdout.write(line+'\n');
      });
      socket.once('close',()=>void shutdown(1));
      const temporary=endpointPath+'.'+process.pid+'.tmp';
      await fs.writeFile(temporary,JSON.stringify({url,approvalUrl,token,bridgePid:process.pid,serverPid:child.pid,startedAt:new Date().toISOString()}),{mode:0o600});
      await fs.rename(temporary,endpointPath);
      await fs.writeFile(path.join(directory,'enabled.json'),'{}',{mode:0o600});
      for(const line of input)socket.send(line);
      input.length=0;
    }
  }catch{process.stderr.write('Desktop shared app-server failed to start\n');await shutdown(1);}
  }
}
