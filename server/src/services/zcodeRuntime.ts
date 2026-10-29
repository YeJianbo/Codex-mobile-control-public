import fs from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import {appHome} from './paths.js';


type Request=(method:string,params:Record<string,unknown>)=>Promise<any>;
export type RuntimeOperation=<T>(cwd:string,operation:(request:Request)=>Promise<T>)=>Promise<T|null>;
const workspaceKey=(cwd:string)=>process.platform==='win32'?path.resolve(cwd).toLowerCase():path.resolve(cwd);

/** Attach only to the original workspace runtime. Never resume a second copy to stop it. */
export const withZcodeRuntime:RuntimeOperation=async(cwd,operation)=>{
  const configPath=process.env.CODEX_MOBILE_CONTROL_ZCODE_BRIDGE_CONFIG||path.join(appHome(),'zcode-bridge','config.json');
  let endpoint:{url:string;token:string};
  try{
    const config=JSON.parse(await fs.readFile(configPath,'utf8'));
    if(config.enabled!==true)return null;
    endpoint=JSON.parse(await fs.readFile(path.join(path.dirname(configPath),'endpoint.json'),'utf8'));
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  if(!/^ws:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url)||typeof endpoint.token!=='string'||endpoint.token.length<32)throw Error('ZCode 共享端点无效');
  const open=async()=>{
    const socket=new WebSocket(endpoint.url,{headers:{Authorization:'Bearer '+endpoint.token},handshakeTimeout:1500,perMessageDeflate:false});
    socket.on('error',()=>{});
    try{await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);socket.once('close',()=>reject(Error('ZCode 共享连接关闭')));});return socket;}
    catch(error){socket.terminate();throw error;}
  };
  const receive=(socket:WebSocket,send:unknown)=>new Promise<any>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);socket.off('message',message);socket.off('close',closed);socket.off('error',failed);};
    const failed=(error:Error)=>{cleanup();reject(error);};
    const closed=()=>failed(Error('ZCode 共享连接关闭'));
    const message=(data:WebSocket.RawData)=>{let value:any;try{value=JSON.parse(data.toString());}catch{return;}
      if(value.type!=='status'&&value.type!=='attached')return;cleanup();resolve(value);};
    const timer=setTimeout(()=>failed(Error('ZCode 共享状态读取超时')),3000);
    socket.on('message',message);socket.once('close',closed);socket.once('error',failed);socket.send(JSON.stringify(send));
  });
  let statusSocket:WebSocket;
  try{statusSocket=await open();}catch(error){if((error as NodeJS.ErrnoException).code==='ECONNREFUSED')return null;throw error;}
  let status:any;
  try{status=await receive(statusSocket,{type:'status'});}finally{statusSocket.close();}
  const runtime=status.runtimes?.find((row:any)=>workspaceKey(row.cwd)===workspaceKey(cwd));
  if(!runtime)return null;
  const socket=await open();
  const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const fail=(error:Error)=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();};
  socket.on('close',()=>fail(Error('ZCode 共享运行时已关闭')));socket.on('error',fail);
  try{
    const attached=await receive(socket,{type:'attach',role:'gateway',cwd});
    // The runtime may have been reclaimed between the status and attach calls.
    if(attached.pid!==runtime.pid)throw Error('ZCode 运行时已更换，请刷新后重试');
    socket.on('message',data=>{
      let value:any;try{value=JSON.parse(data.toString());}catch{return;}
      if(value.method)return;
      const entry=pending.get(String(value.id));if(!entry)return;
      pending.delete(String(value.id));clearTimeout(entry.timer);
      if(value.error){const error=Object.assign(Error(value.error.message||'ZCode 请求失败'),{code:value.error.code});entry.reject(error);}
      else entry.resolve(value.result);
    });
    let sequence=0;
    return await operation((method,params)=>new Promise((resolve,reject)=>{
      const id='subagent-'+(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(Error('ZCode 子代理操作超时'));},10000);
      pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
    }));
  }finally{fail(Error('ZCode 子代理连接已关闭'));socket.close();}
};

