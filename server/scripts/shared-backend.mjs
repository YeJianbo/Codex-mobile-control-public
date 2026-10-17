import fs from 'node:fs/promises';
import {openSync,closeSync,readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolveDesktopCli} from './desktop-cli-resolver.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function applyThreadConfigOverrides(message,directory){
  if(message?.method!=='thread/resume'||typeof message.params?.threadId!=='string')return message;
  let policy;
  try{policy=JSON.parse(readFileSync(path.join(directory,'thread-config-overrides.json'),'utf8'));}catch{return message;}
  const baseUrl=policy[message.params.threadId]?.openai_base_url;
  if(typeof baseUrl!=='string')return message;
  let url;try{url=new URL(baseUrl);}catch{return message;}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')return message;
  return {...message,params:{...message.params,config:{...message.params.config,openai_base_url:baseUrl}}};
}
const alive=pid=>{try{if(pid>0){process.kill(pid,0);return true;}}catch(error){return error.code==='EPERM';}return false;};
async function context(configPath){
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  const WebSocket=createRequire(path.join(config.gatewayRoot,'package.json'))('ws');
  const directory=path.dirname(configPath);
  return {config,WebSocket,directory,endpointPath:path.join(directory,'endpoint.json'),ownerPath:path.join(directory,'owner.lock')};
}
async function openSocket(WebSocket,url,token){
  const socket=new WebSocket(url,{headers:{Authorization:`Bearer ${token}`},handshakeTimeout:1000});
  socket.on('error',()=>{});
  try{await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);socket.once('close',()=>reject(Error('shared connection closed')));});return socket;}
  catch(error){socket.terminate();throw error;}
}
async function liveEndpoint(ctx){
  try{
    const endpoint=JSON.parse(await fs.readFile(ctx.endpointPath,'utf8'));
    if(!/^ws:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url)||typeof endpoint.token!=='string'||endpoint.token.length<32)return null;
    const socket=await openSocket(ctx.WebSocket,endpoint.url,endpoint.token);socket.close();return endpoint;
  }catch{return null;}
}
export async function ensureSharedBackend(configPath){
  const ctx=await context(configPath);
  // The console's existing migration progress record also suspends automatic
  // backend recreation while its process snapshot and history edits run.
  const home=ctx.config.env?.CODEX_HOME||process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  try{
    const progress=JSON.parse(await fs.readFile(path.join(home,'codexmate','local-console','routing-progress.json'),'utf8'));
    if(progress.running&&progress.holdSharedBackend&&alive(progress.ownerPid))throw Error('控制台正在迁移会话，共享后端将在迁移完成后恢复');
  }catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  const current=await liveEndpoint(ctx);if(current)return current;
  let owner=0;try{owner=Number(await fs.readFile(ctx.ownerPath,'utf8'));}catch{}
  if(!alive(owner)){
    const log=openSync(path.join(ctx.directory,'shared-backend.log'),'a',0o600);
    try{
      const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--serve',configPath],{detached:true,windowsHide:true,stdio:['ignore',log,log],env:process.env});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    }finally{closeSync(log);}
  }
  const deadline=Date.now()+25000;
  while(Date.now()<deadline){const endpoint=await liveEndpoint(ctx);if(endpoint)return endpoint;await sleep(200);}
  throw Error('共享后端启动失败，请查看电脑控制台的 shared-backend.log');
}
async function serve(configPath){
  const ctx=await context(configPath);const {WebSocket,config,directory,endpointPath,ownerPath}=ctx;
  for(;;){
    try{const lock=await fs.open(ownerPath,'wx',0o600);await lock.writeFile(String(process.pid));await lock.close();break;}
    catch(error){if(error.code!=='EEXIST')throw error;let pid=0;try{pid=Number(await fs.readFile(ownerPath,'utf8'));}catch{}
      if(alive(pid)||pid===0)return;try{await fs.unlink(ownerPath);}catch{}
    }
  }
  const token=crypto.randomBytes(32).toString('hex');
  const tokenPath=path.join(directory,`transport-token-${process.pid}`);
  await fs.writeFile(tokenPath,token,{mode:0o600});
  const verifyClient=({req})=>req.headers.authorization===`Bearer ${token}`;
  const desktopServer=new WebSocket.Server({host:'127.0.0.1',port:0,verifyClient});
  const approvalServer=new WebSocket.Server({host:'127.0.0.1',port:0,verifyClient});
  await Promise.all([desktopServer,approvalServer].map(server=>new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);})));
  const desktopUrl=`ws://127.0.0.1:${desktopServer.address().port}`;
  const approvalUrl=`ws://127.0.0.1:${approvalServer.address().port}`;
  const approvals=new Map(),contexts=new Set();let connectionId=0;
  const approvalMethods=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput']);
  const broadcast=message=>{const data=JSON.stringify(message);for(const peer of approvalServer.clients)if(peer.readyState===WebSocket.OPEN)peer.send(data);};
  const finish=key=>{const entry=approvals.get(key);if(!entry)return;approvals.delete(key);entry.context.resolved.add(String(entry.id));if(entry.context.resolved.size>100)entry.context.resolved.delete(entry.context.resolved.values().next().value);broadcast({type:'resolved',id:key,threadId:entry.params?.threadId||'unknown'});};
  approvalServer.on('connection',peer=>{
    peer.send(JSON.stringify({type:'snapshot',requests:[...approvals.values()].map(entry=>({id:entry.key,method:entry.method,params:entry.params}))}));
    peer.on('message',data=>{
      let message;try{message=JSON.parse(data.toString());}catch{return;}
      if(message?.type!=='resolve'||typeof message.id!=='string'||!message.result||typeof message.result!=='object')return;
      const entry=approvals.get(message.id);
      if(!entry||entry.context.upstream?.readyState!==WebSocket.OPEN){peer.send(JSON.stringify({type:'resolution',id:message.id,ok:false}));return;}
      entry.context.upstream.send(JSON.stringify({id:entry.id,result:message.result}),error=>{
        if(!error)finish(entry.key);
        if(peer.readyState===WebSocket.OPEN)peer.send(JSON.stringify({type:'resolution',id:message.id,ok:!error}));
      });
    });
  });
  let backendUrl=null,child=null,stopping=false,restartTimer=null,failures=0;
  desktopServer.on('connection',peer=>{
    if(!backendUrl){peer.close(1013,'shared backend restarting');return;}
    const state={id:++connectionId,upstream:null,resolved:new Set(),active:new Set(),closed:false,cleanupTimer:null};contexts.add(state);
    const upstream=new WebSocket(backendUrl,{headers:{Authorization:`Bearer ${token}`},handshakeTimeout:5000});state.upstream=upstream;
    const input=[];let inputBytes=0;
    const release=()=>{if(state.closed&&state.active.size===0&&![...approvals.values()].some(entry=>entry.context===state)){upstream.close();contexts.delete(state);}};
    peer.on('message',data=>{
      let line=data.toString();
      try{const message=JSON.parse(line);const configured=applyThreadConfigOverrides(message,directory);if(configured!==message)line=JSON.stringify(configured);if(message.id!==undefined&&!message.method){const entry=[...approvals.values()].find(item=>item.context===state&&item.id===message.id);if(entry)finish(entry.key);else if(state.resolved.has(String(message.id)))return;}}catch{}
      if(upstream.readyState===WebSocket.OPEN)upstream.send(line);
      else{inputBytes+=Buffer.byteLength(line);if(inputBytes>64*1024*1024){peer.close(1009);upstream.terminate();}else input.push(line);}
    });
    upstream.on('open',()=>{for(const line of input)upstream.send(line);input.length=0;});
    upstream.on('message',data=>{
      const line=data.toString();
      try{
        const message=JSON.parse(line);
        if(message.id!==undefined&&approvalMethods.has(message.method)){
          const key=`desktop:${process.pid}:${state.id}:${String(message.id)}`;
          const entry={key,id:message.id,method:message.method,params:message.params||{},context:state};approvals.set(key,entry);
          broadcast({type:'request',request:{id:key,method:entry.method,params:entry.params}});
        }else if(message.method==='serverRequest/resolved'){
          for(const entry of approvals.values())if(entry.context===state&&entry.id===message.params?.requestId)finish(entry.key);
        }
        if(message.method==='turn/started')state.active.add(message.params?.threadId);
        if(message.method==='turn/completed'){state.active.delete(message.params?.threadId);if(state.closed)release();}
      }catch{}
      if(peer.readyState===WebSocket.OPEN)peer.send(line);
    });
    upstream.on('error',()=>peer.close(1011,'shared backend unavailable'));
    upstream.on('close',()=>{clearTimeout(state.cleanupTimer);contexts.delete(state);for(const entry of approvals.values())if(entry.context===state)finish(entry.key);peer.close();});
    peer.on('error',()=>{});
    // Keep an active desktop turn and its approval channel alive after the window exits.
    peer.on('close',()=>{state.closed=true;state.cleanupTimer=setTimeout(release,30000);state.cleanupTimer.unref();});
  });
  async function clearEndpoint(){try{const endpoint=JSON.parse(await fs.readFile(endpointPath,'utf8'));if(endpoint.bridgePid===process.pid)await fs.unlink(endpointPath);}catch{}}
  function scheduleRestart(){if(stopping||restartTimer)return;const delay=Math.min(1000*2**failures++,15000);restartTimer=setTimeout(()=>{restartTimer=null;void startBackend();},delay);}
  async function startBackend(){
    if(stopping)return;
    try{
      const realCli=await resolveDesktopCli(config.realCli);
      let args=['-c','features.code_mode_host=true','app-server'];
      try{const saved=JSON.parse(await fs.readFile(path.join(directory,'startup-args.json'),'utf8'));if(Array.isArray(saved)&&saved.every(value=>typeof value==='string')&&saved.includes('app-server'))args=saved;}catch{}
      const commandIndex=args.indexOf('app-server'),clean=[];
      for(let i=0;i<args.length;i++){if(i>commandIndex&&['--listen','--ws-auth','--ws-token-file'].includes(args[i])){i++;continue;}if(i>commandIndex&&(args[i]==='--stdio'||/^(--listen|--ws-auth|--ws-token-file)=/.test(args[i])))continue;clean.push(args[i]);}
      const port=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(error=>error?reject(error):resolve(port));});});
      const url=`ws://127.0.0.1:${port}`;
      const launched=spawn(realCli,[...clean,'--listen',url,'--ws-auth','capability-token','--ws-token-file',tokenPath],{stdio:['ignore','ignore','pipe'],windowsHide:true,env:{...process.env,CODEX_CLI_PATH:realCli,PATH:path.dirname(realCli)+path.delimiter+(process.env.PATH||'')}});child=launched;
      let exited=false;
      launched.stderr.on('data',data=>process.stderr.write(data));
      launched.on('error',error=>process.stderr.write(error.message+'\n'));
      launched.once('exit',()=>{exited=true;if(child!==launched)return;child=null;backendUrl=null;void clearEndpoint().finally(scheduleRestart);});
      const deadline=Date.now()+20000;let ready=false;
      while(!stopping&&!exited&&Date.now()<deadline){try{const probe=await openSocket(WebSocket,url,token);probe.close();ready=true;break;}catch{await sleep(100);}}
      if(!ready){if(!exited)launched.kill();throw Error('shared backend did not become ready');}
      if(stopping)return;
      backendUrl=url;failures=0;
      const temporary=endpointPath+'.'+process.pid+'.tmp';
      await fs.writeFile(temporary,JSON.stringify({url,desktopUrl,approvalUrl,token,bridgePid:process.pid,serverPid:launched.pid,mode:'daemon',startedAt:new Date().toISOString()}),{mode:0o600});await fs.rename(temporary,endpointPath);
      await fs.writeFile(path.join(directory,'enabled.json'),'{}',{mode:0o600});
      process.stderr.write(`[shared backend] ready pid=${launched.pid}\n`);
    }catch(error){process.stderr.write(`[shared backend] ${error.message}\n`);scheduleRestart();}
  }
  async function shutdown(){if(stopping)return;stopping=true;clearTimeout(restartTimer);await clearEndpoint();try{if(Number(await fs.readFile(ownerPath,'utf8'))===process.pid)await fs.unlink(ownerPath);}catch{}child?.kill();for(const state of contexts)state.upstream?.terminate();desktopServer.close();approvalServer.close();await fs.unlink(tokenPath).catch(()=>{});setTimeout(()=>process.exit(0),200).unref();}
  process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
  await startBackend();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,configPath]=process.argv.slice(2);
  try{if(mode==='--serve')await serve(configPath);else if(mode==='--ensure')await ensureSharedBackend(configPath);else throw Error('Expected --ensure or --serve and config path');}
  catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
