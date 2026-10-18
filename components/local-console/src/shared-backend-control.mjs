import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import {parse} from 'smol-toml';
import {atomicWrite} from './catalog.mjs';
import {desktopTargets,sharedBackendTargets} from './windows-processes.mjs';

const alive=pid=>{try{if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);return true;}}catch(error){return error.code==='EPERM';}return false;};
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Read-only RPCs: never resume a thread or submit input while checking activity.
export async function backendActivity(endpoint,{timeoutMs=10000}={}){
  if(!/^ws:\/\/127\.0\.0\.1:\d+$/.test(endpoint?.url||'')||typeof endpoint.token!=='string')throw new Error('共享后端连接信息无效');
  const socket=new WebSocket(endpoint.url,{headers:{Authorization:`Bearer ${endpoint.token}`},handshakeTimeout:3000});
  const pending=new Map();let nextId=0,timer;
  const fail=()=>{for(const p of pending.values())p.reject(new Error('无法确认共享后端的运行任务，请稍后重试'));pending.clear();};
  socket.on('message',data=>{let message;try{message=JSON.parse(data);}catch{return;}const p=pending.get(message.id);if(!p)return;pending.delete(message.id);message.error?p.reject(new Error('读取共享后端状态失败')):p.resolve(message.result);});
  socket.on('error',fail);socket.on('close',fail);
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  try{
    return await Promise.race([
      (async()=>{
        await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',()=>reject(new Error('共享后端暂时无法连接')));socket.once('close',()=>reject(new Error('共享后端连接已关闭')));});
        await call('initialize',{clientInfo:{name:'local-console-backend-status',version:'1'},capabilities:{experimentalApi:true}});
        socket.send(JSON.stringify({method:'initialized'}));
        const threads=[];let cursor;
        do{
          const page=await call('thread/loaded/list',{limit:100,...(cursor?{cursor}:{})});
          for(const id of page.data||[]){
            const result=await call('thread/read',{threadId:id,includeTurns:false}),thread=result.thread;
            if(!thread||!['idle','active','systemError','notLoaded'].includes(thread.status?.type))throw new Error('无法确认会话是否空闲，请稍后重试');
            threads.push({id,name:thread.name||String(thread.preview||id).slice(0,80),status:thread.status.type});
          }
          cursor=page.nextCursor;
        }while(cursor);
        return threads;
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('检查共享后端状态超时')),timeoutMs);})
    ]);
  }finally{clearTimeout(timer);socket.terminate();}
}

export class SharedBackendControl{
  constructor(store,processAdapter,{activity=backendActivity,waitMs=25000}={}){
    this.store=store;this.processes=processAdapter;this.directory=processAdapter.bridgeDirectory;
    this.activity=activity;this.waitMs=waitMs;this.busy=false;this.plan=null;
    this.operationFile=path.join(store.dir,'backend-operation.json');
  }
  endpoint(){return this.directory?readJson(path.join(this.directory,'endpoint.json')):null;}
  summary(){
    const endpoint=this.endpoint(),running=alive(endpoint?.serverPid)&&alive(endpoint?.bridgePid);let catalogUpdatedAt=null;
    try{const config=parse(fs.readFileSync(this.store.config,'utf8'));if(config.model_catalog_json)catalogUpdatedAt=fs.statSync(path.resolve(this.store.home,config.model_catalog_json)).mtime.toISOString();}catch{}
    let operation=readJson(this.operationFile);
    if(operation?.state==='running'&&!this.busy)operation={...operation,state:'error',error:'上次重启状态未完成，请重新检查共享后端'};
    return {running,backendPid:running?endpoint.serverPid:null,startedAt:running?endpoint.startedAt:null,catalogUpdatedAt,
      catalogReloadPending:running&&!!catalogUpdatedAt&&Date.parse(catalogUpdatedAt)>Date.parse(endpoint.startedAt),
      operation};
  }
  async inspect(){
    const endpoint=this.endpoint();if(!endpoint)throw new Error('共享后端未运行，请先打开 Codex');
    const snapshot=await this.processes.snapshot();
    const managed=sharedBackendTargets(snapshot.processes,{endpoint,directory:this.directory});
    const managedIds=new Set(managed.map(p=>p.id));
    const targets=managed.filter(p=>p.id!==endpoint.bridgePid);
    const desktop=desktopTargets(snapshot.processes).filter(p=>!managedIds.has(p.id));
    if(desktop.length&&!snapshot.executable)throw new Error('Codex 桌面应用入口未注册，未执行重启');
    if(!targets.some(p=>p.id===endpoint.serverPid))throw new Error('共享后端进程已变化，请刷新后重试');
    const threads=await this.activity(endpoint);
    const fresh=this.endpoint();if(fresh?.serverPid!==endpoint.serverPid||fresh?.bridgePid!==endpoint.bridgePid||fresh?.url!==endpoint.url||fresh?.token!==endpoint.token)throw new Error('共享后端已重启，请刷新后重试');
    return {endpoint,targets,desktop,executable:snapshot.executable,threads,blockingThreads:threads.filter(t=>t.status!=='idle')};
  }
  async preview(){
    if(this.busy)throw new Error('共享后端正在重启');
    const state=await this.inspect();
    this.plan={id:crypto.randomUUID(),serverPid:state.endpoint.serverPid,url:state.endpoint.url,token:state.endpoint.token,desktop:state.desktop.filter(p=>p.depth===0).map(p=>`${p.id}:${p.createdAt}`).sort().join('|'),expires:Date.now()+300000};
    return {...this.summary(),planId:this.plan.id,canRestart:state.blockingThreads.length===0,blockingThreads:state.blockingThreads,desktopRunning:state.desktop.length>0,restartScope:state.desktop.length?'desktop-and-cli':'cli-only'};
  }
  async restart(planId){
    if(this.busy)throw new Error('共享后端正在重启');
    const plan=this.plan;if(!plan||plan.id!==planId||plan.expires<Date.now())throw new Error('重启预览已过期，请重新检查');
    this.busy=true;this.plan=null;
    let operation,desktopStopped=false,desktopRestored=false,desktopExecutable;
    try{
      const before=await this.inspect();if(before.endpoint.serverPid!==plan.serverPid)throw new Error('共享后端已变化，请重新预览');
      if(before.endpoint.url!==plan.url||before.endpoint.token!==plan.token||before.desktop.filter(p=>p.depth===0).map(p=>`${p.id}:${p.createdAt}`).sort().join('|')!==plan.desktop)throw new Error('Codex 运行状态已变化，请重新预览');
      if(before.blockingThreads.length)throw new Error(`仍有 ${before.blockingThreads.length} 个会话正在运行或状态异常，请等待任务结束后重试`);
      operation={state:'running',at:new Date().toISOString(),previousPid:before.endpoint.serverPid,restartScope:before.desktop.length?'desktop-and-cli':'cli-only'};atomicWrite(this.operationFile,operation);
      desktopExecutable=before.executable;
      if(before.desktop.length){
        desktopStopped=true;
        const stoppedDesktop=await this.processes.apply(before.desktop,'stop');
        if((stoppedDesktop.results||[]).some(p=>!['stopped','already-exited'].includes(p.state)))throw new Error('部分桌面进程未停止，请刷新检查');
      }
      // Keep the owner daemon alive. Its existing restart loop starts a fresh CLI;
      // desktop and mobile clients reconnect through the updated endpoint file.
      const stopped=await this.processes.apply(before.targets,'stop');
      if((stopped.results||[]).some(p=>!['stopped','already-exited'].includes(p.state)))throw new Error('部分共享后端进程未停止，请刷新检查');
      const deadline=Date.now()+this.waitMs;let next;
      while(Date.now()<deadline){
        next=this.endpoint();
        if(next?.serverPid!==before.endpoint.serverPid&&next?.bridgePid===before.endpoint.bridgePid&&alive(next?.serverPid)){
          await this.activity(next);
          if(desktopStopped){
            const desktop=await this.processes.apply([],'restart',desktopExecutable);
            if(!desktop.started)throw new Error('CLI 已恢复，但 Codex 桌面端未启动');
            desktopRestored=true;
          }
          atomicWrite(this.operationFile,{...operation,state:'done',completedAt:new Date().toISOString(),backendPid:next.serverPid,desktopRestarted:desktopRestored});
          return {...this.summary(),restarted:true,desktopRestarted:desktopRestored,restartScope:operation.restartScope};
        }
        await sleep(200);
      }
      throw new Error('旧 CLI 已停止，等待共享后端恢复超时；请重新打开 Codex 并检查状态');
    }catch(error){
      if(desktopStopped&&!desktopRestored){
        try{desktopRestored=(await this.processes.apply([],'restart',desktopExecutable)).started===true;}
        catch(restoreError){error.message+='；恢复桌面端失败：'+restoreError.message;}
      }
      if(operation)atomicWrite(this.operationFile,{...operation,state:'error',completedAt:new Date().toISOString(),desktopRestored,error:error.message});throw error;
    }
    finally{this.busy=false;}
  }
}
