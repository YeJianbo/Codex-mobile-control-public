import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import WebSocket from 'ws';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {appHome} from './paths.js';

type RecordValue=Record<string,any>;
function localEndpoint(value:string){
  const url=new URL(value);
  if(!['http:','https:','ws:','wss:'].includes(url.protocol)||!['127.0.0.1','[::1]','localhost'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('请输入电脑本机的浏览器调试地址');
  return url;
}
const webPage=(value:string)=>value==='about:blank'||/^https?:\/\//i.test(value);

class CdpConnection {
  private sequence=0;
  private readonly pending=new Map<number,{resolve:(value:RecordValue)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  constructor(private readonly socket:WebSocket){
    socket.on('message',raw=>{
      let message:RecordValue;try{message=JSON.parse(raw.toString())}catch{return}
      const pending=this.pending.get(message.id);if(!pending)return;
      clearTimeout(pending.timer);this.pending.delete(message.id);
      message.error?pending.reject(Error(String(message.error.message))):pending.resolve(message.result??{});
    });
    const failed=()=>{for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error('浏览器连接已断开'))}this.pending.clear()};
    socket.on('close',failed);socket.on('error',failed);
  }
  async call(method:string,params:RecordValue={},sessionId?:string):Promise<RecordValue>{
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('浏览器响应超时'))},5000);
      this.pending.set(id,{resolve,reject,timer});
      this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}),error=>{
        if(error){clearTimeout(timer);this.pending.delete(id);reject(error)}
      });
    });
  }
  close(){this.socket.close()}
}

/** Uses the desktop browser's real CDP targets; never substitutes an Android WebView. */
export class DesktopBrowser {
  constructor(private readonly file=path.join(appHome(),'browser-bridge.json')){}
  async configure(value:string){
    if(value)localEndpoint(value);
    await fs.mkdir(path.dirname(this.file),{recursive:true});
    await fs.writeFile(this.file,JSON.stringify({endpoint:value}),{mode:0o600});
  }
  private async endpoint():Promise<string|undefined>{
    try{const value=JSON.parse(await fs.readFile(this.file,'utf8')).endpoint;if(value){localEndpoint(value);return value}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    const local=process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
    const roaming=process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming');
    for(const file of [path.join(roaming,'Codex','DevToolsActivePort'),path.join(local,'Google','Chrome','User Data','DevToolsActivePort')]){
      try{const [port,route]=(await fs.readFile(file,'utf8')).trim().split(/\r?\n/);if(/^\d+$/.test(port!)&&Number(port)>0&&Number(port)<65536&&route?.startsWith('/devtools/browser/'))return `ws://127.0.0.1:${port}${route}`}catch{}
    }
    return undefined;
  }
  private async connected<T>(work:(connection:CdpConnection)=>Promise<T>):Promise<T>{
    const configured=await this.endpoint();if(!configured)throw Error('电脑浏览器尚未开放调试连接');
    const url=localEndpoint(configured);
    let endpoint=configured;
    if(url.protocol==='http:'||url.protocol==='https:'){
      const response=await fetch(new URL('/json/version',url),{signal:AbortSignal.timeout(3000)});
      if(!response.ok)throw Error('浏览器调试接口不可用');
      endpoint=String((await response.json() as RecordValue).webSocketDebuggerUrl??'');
      const advertised=localEndpoint(endpoint);
      if(advertised.host!==url.host)throw Error('浏览器返回了不匹配的调试地址');
    }
    const socket=new WebSocket(endpoint,{handshakeTimeout:3000});
    const connection=new CdpConnection(socket);
    try{await once(socket,'open');return await work(connection)}finally{connection.close()}
  }
  async tabs(){
    try{return await this.connected(async connection=>{
      const result=await connection.call('Target.getTargets');
      const tabs=(result.targetInfos as RecordValue[]??[]).filter(tab=>['page','webview'].includes(tab.type)&&webPage(tab.url)).map(tab=>({id:tab.targetId,title:tab.title||tab.url,url:tab.url}));
      return {available:true,tabs};
    })}catch(error){return {available:false,tabs:[],error:error instanceof Error?error.message:String(error)}}
  }
  private async tab<T>(id:string,work:(connection:CdpConnection,sessionId:string)=>Promise<T>){
    return this.connected(async connection=>{
      const targets=await connection.call('Target.getTargets');
      if(!(targets.targetInfos as RecordValue[]??[]).some(tab=>tab.targetId===id&&['page','webview'].includes(tab.type)&&webPage(tab.url)))throw Error('浏览器标签已关闭或不可控制');
      const {sessionId}=await connection.call('Target.attachToTarget',{targetId:id,flatten:true});
      return work(connection,sessionId);
    });
  }
  screenshot(id:string){return this.tab(id,async(connection,session)=>{
    const metrics=await connection.call('Page.getLayoutMetrics',{},session);
    const viewport=metrics.cssVisualViewport??metrics.visualViewport;
    const width=Number(viewport.clientWidth),height=Number(viewport.clientHeight);
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>30000||height>30000)throw Error('浏览器返回了无效的视口尺寸');
    const scale=Math.min(1,1200/Math.max(width,height));
    const image=await connection.call('Page.captureScreenshot',{format:'jpeg',quality:62,captureBeyondViewport:false,
      clip:{x:viewport.pageX??0,y:viewport.pageY??0,width,height,scale}},session);
    const navigation=await connection.call('Page.getNavigationHistory',{},session);
    const page=navigation.entries?.[navigation.currentIndex];
    return {data:image.data,width,height,url:page?.url,title:page?.title};
  })}
  action(id:string,action:BrowserAction){return this.tab(id,async(connection,session)=>{
    const call=(method:string,params:RecordValue={})=>connection.call(method,params,session);
    switch(action.type){
      case 'navigate':{if(!webPage(action.url))throw Error('请输入 HTTP 或 HTTPS 网页地址');const result=await call('Page.navigate',{url:action.url});if(result.errorText)throw Error(result.errorText);break}
      case 'reload':await call('Page.reload');break;
      case 'back':case 'forward':{
        const history=await call('Page.getNavigationHistory');const entry=history.entries[history.currentIndex+(action.type==='back'?-1:1)];
        if(entry)await call('Page.navigateToHistoryEntry',{entryId:entry.id});break;
      }
      case 'click':await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:action.x,y:action.y});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:action.x,y:action.y});break;
      case 'scroll':await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:action.x,y:action.y,deltaX:action.deltaX,deltaY:action.deltaY});break;
      case 'text':await call('Input.insertText',{text:action.text});break;
      case 'key':await call('Input.dispatchKeyEvent',{type:'keyDown',key:action.key,windowsVirtualKeyCode:action.key==='Enter'?13:action.key==='Backspace'?8:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:action.key});break;
    }
    return {ok:true};
  })}
}
const coordinate=z.number().finite().min(0).max(100000);
const browserAction=z.discriminatedUnion('type',[
  z.object({type:z.literal('navigate'),url:z.string().min(1).max(8192)}),
  z.object({type:z.enum(['reload','back','forward'])}),
  z.object({type:z.literal('click'),x:coordinate,y:coordinate}),
  z.object({type:z.literal('scroll'),x:coordinate,y:coordinate,deltaX:z.number().finite().min(-10000).max(10000),deltaY:z.number().finite().min(-10000).max(10000)}),
  z.object({type:z.literal('text'),text:z.string().max(20000)}),
  z.object({type:z.literal('key'),key:z.enum(['Enter','Backspace','Escape'])}),
]);
type BrowserAction=z.infer<typeof browserAction>;
export function registerDesktopBrowser(app:FastifyInstance,browser:DesktopBrowser,authorize:(request:FastifyRequest)=>void){
  app.get('/api/browser/tabs',async request=>{authorize(request);return browser.tabs()});
  app.put('/api/browser/connection',async request=>{authorize(request);const {endpoint}=z.object({endpoint:z.string().max(2048)}).strict().parse(request.body);await browser.configure(endpoint);return browser.tabs()});
  app.get('/api/browser/:targetId/screenshot',async request=>{authorize(request);const {targetId}=z.object({targetId:z.string().min(1).max(256)}).parse(request.params);return browser.screenshot(targetId)});
  app.post('/api/browser/:targetId/action',async request=>{authorize(request);const {targetId}=z.object({targetId:z.string().min(1).max(256)}).parse(request.params);return browser.action(targetId,browserAction.parse(request.body))});
}
