import fs from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import {codexHome} from './paths.js';
import type {GatewayEvent,ThreadRecord} from '../types.js';
import {delegatedMessage,enrichMessageSources} from './messageSource.js';
import {visibleUserContent} from './codexSessions.js';

export const isCloudThread=(id:string)=>id.startsWith('cloud:');
const rawId=(id:string)=>{const value=id.slice(6);if(!isCloudThread(id)||! /^[a-zA-Z0-9-]{1,160}$/.test(value))throw Error('无效的云端任务');return value;};
const iso=(n:unknown)=>new Date(typeof n==='number'?n*1000:0).toISOString();
const status=(row:any):ThreadRecord['status']=>['active','running','inProgress'].includes(row?.status?.type??row?.status)?'running':row?.status==='failed'||row?.status?.type==='systemError'?'error':'idle';
type Rpc=(method:string,params:Record<string,unknown>)=>Promise<any>;

// Cloud uses a separate account-authenticated app-server. Only reads are exposed;
// its credentials never travel to the mobile client or the local event store.
export class CloudThreads {
  private socket?:WebSocket;
  private connecting?:Promise<void>;
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  private sequence=0;
  private listedAt=0;
  private listing?:Promise<ThreadRecord[]>;
  private rows:ThreadRecord[]=[];
  private metadata=new Map<string,any>();
  private histories=new Map<string,{at:number;promise:Promise<any>}>();
  private account='';
  private epoch=0;
  error='';
  constructor(private rpcOverride?:Rpc){}
  private async checkAccount(){
    if(this.rpcOverride)return;
    const current=await fs.readFile(path.join(codexHome(),'auth.json'),'utf8').then(raw=>JSON.parse(raw).tokens?.account_id||'').catch(()=>'');
    if(this.account!==current){this.epoch++;this.socket?.terminate();this.socket=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('登录账号已变化，请重试'));}this.pending.clear();this.rows=[];this.metadata.clear();this.histories.clear();this.listedAt=0;this.account=current;}
  }
  private async connect(){
    if(this.connecting)return this.connecting;
    if(this.socket?.readyState===WebSocket.OPEN)return;
    this.connecting=(async()=>{
      const auth=JSON.parse(await fs.readFile(path.join(codexHome(),'auth.json'),'utf8'));
      if(!auth.tokens?.access_token)throw Error('请先在电脑 Codex 登录 ChatGPT 账号');
      const socket=new WebSocket('wss://codex-cloud-backend.chatgpt.com/',['codex-app-server','codex-client.desktop',`openai-bearer.${auth.tokens.access_token}`],{
        headers:{'ChatGPT-Account-Id':auth.tokens.account_id,'X-OpenAI-Product-Sku':'codex'},handshakeTimeout:12000,maxPayload:32*1024*1024,
      });
      this.socket=socket;
      socket.on('message',data=>{
        let row:any;try{row=JSON.parse(data.toString());}catch{return;}
        const pending=this.pending.get(row.id);if(!pending)return;
        this.pending.delete(row.id);clearTimeout(pending.timer);
        row.error?pending.reject(Error(typeof row.error.message==='string'?row.error.message:'云端读取失败')):pending.resolve(row.result);
      });
      socket.on('close',()=>{if(this.socket!==socket)return;this.socket=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('云端连接已断开，请重试'));}this.pending.clear();});
      socket.on('error',()=>{});
      await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',()=>reject(Error('无法连接云端任务服务')));});
      await this.send('initialize',{clientInfo:{name:'codex_mobile_control',version:'0.6.52'},capabilities:{experimentalApi:true}});
      socket.send(JSON.stringify({method:'initialized'}));
    })().catch(error=>{this.socket?.terminate();this.socket=undefined;throw error;}).finally(()=>{this.connecting=undefined;});
    return this.connecting;
  }
  private send(method:string,params:Record<string,unknown>):Promise<any>{
    return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('云端任务读取超时，请重试'));},20000);this.pending.set(id,{resolve,reject,timer});this.socket!.send(JSON.stringify({id,method,params}),error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(Error('云端连接已断开，请重试'));}});});
  }
  private async rpc(method:string,params:Record<string,unknown>){
    if(!['thread/list','thread/read','thread/turns/list','thread/items/list'].includes(method))throw Error('不支持此云端操作');
    if(this.rpcOverride)return this.rpcOverride(method,params);
    await this.connect();return this.send(method,params);
  }
  close(){this.socket?.close();}
  private record(row:any):ThreadRecord{
    this.metadata.set(row.id,row);
    return {id:'cloud:'+row.id,source:'cloudCodex',readOnly:true,title:row.name||row.preview?.slice(0,160)||'云端任务',projectPath:row.environments?.[0]?.cwd||row.cwd,status:status(row),createdAt:iso(row.createdAt),updatedAt:iso(row.recencyAt??row.updatedAt)};
  }
  async list():Promise<ThreadRecord[]>{
    await this.checkAccount();
    if(Date.now()-this.listedAt<30000)return this.rows;
    if(this.listing)return this.listing;
    this.listing=(async()=>{
      const epoch=this.epoch;
      try{
        const rows:ThreadRecord[]=[];let cursor:string|undefined;
        do {const page=await this.rpc('thread/list',{limit:100,archived:false,...(cursor?{cursor}:{})});if(epoch!==this.epoch)throw Error('登录账号已变化，请重试');if(!Array.isArray(page.data))throw Error('云端列表格式无效');for(const row of page.data)rows.push(this.record(row));cursor=page.nextCursor||undefined;}while(cursor&&rows.length<2000);
        this.rows=rows;this.error='';
      }catch(error){this.error=(error as NodeJS.ErrnoException).code==='ENOENT'?'':(error as Error).message;}
      this.listedAt=Date.now();return this.rows;
    })().finally(()=>{this.listing=undefined;});
    return this.listing;
  }
  async cachedList():Promise<ThreadRecord[]>{
    await this.checkAccount();
    // Local sidebar rows must not wait for the cloud handshake or its RPC timeout.
    void this.list().catch(error=>{this.error=(error as Error).message;});
    return this.rows;
  }
  async read(id:string,turns=10){
    await this.checkAccount();
    const raw=rawId(id),key=id+':'+turns,old=this.histories.get(key);
    if(old&&Date.now()-old.at<10000)return old.promise;
    const promise=this.readHistory(raw,id,Math.min(turns,2000));
    this.histories.set(key,{at:Date.now(),promise});
    if(this.histories.size>30)this.histories.delete(this.histories.keys().next().value!);
    try{return await promise;}catch(error){this.histories.delete(key);throw error;}
  }
  private async readHistory(raw:string,id:string,limit:number){
    const epoch=this.epoch;
    const thread=(await this.rpc('thread/read',{threadId:raw,includeTurns:false})).thread;
    if(epoch!==this.epoch)throw Error('登录账号已变化，请重试');
    this.record(thread);
    const groups:GatewayEvent[][]=[];
    let cursor:string|undefined,visibleTurns=0,hasMore=false;
    do {
      const page=await this.rpc('thread/turns/list',{threadId:raw,limit:50,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});
      cursor=page.nextCursor||undefined;
      for(const [index,turn] of page.data.entries()){
        let items=turn.items??[];
        if(turn.itemsView==='notLoaded'){
          items=[];let itemCursor:string|undefined;
          do {const part=await this.rpc('thread/items/list',{threadId:raw,turnId:turn.id,limit:100,sortDirection:'asc',...(itemCursor?{cursor:itemCursor}:{})});items.push(...part.data);itemCursor=part.nextCursor||undefined;}while(itemCursor);
        }
        const started=iso(turn.startedAt);
        const content=items.flatMap((item:any)=>cloudItemEvents(id,turn.id,item,started));
        const events:GatewayEvent[]=[{type:'turn.started',threadId:id,turnId:turn.id,createdAt:started,eventId:`cloud:${turn.id}:start`},...content];
        if(turn.status!=='inProgress')events.push({type:'turn.completed',threadId:id,turnId:turn.id,status:turn.status,createdAt:iso(turn.completedAt??turn.startedAt),eventId:`cloud:${turn.id}:end`});
        groups.push(events);
        if(content.length)visibleTurns++;
        if(visibleTurns>=limit){hasMore=index<page.data.length-1||Boolean(cursor);break;}
      }
      // Hidden scheduler/context turns should not consume the conversation
      // window. The next request replays from newest with a larger window.
    }while(cursor&&visibleTurns<limit);
    const events=groups.reverse().flat();
    if(epoch!==this.epoch)throw Error('登录账号已变化，请重试');
    return {status:status(thread),readOnly:true,hasMore,settings:{model:thread.model||'',effort:thread.reasoningEffort||''},events:await enrichMessageSources(events,new Map([...this.metadata].map(([id,row])=>[id,row.name||'其他任务'])))};
  }
}

function cloudUserText(item:Record<string,unknown>):string{
  const text=visibleUserContent(item);
  const envelope=/^<delivery_context>\s*([\s\S]*?)\s*<\/delivery_context>\s*/.exec(text);
  // The cloud transport prefixes mobile requests with delivery metadata. Keep
  // quoted examples and ordinary XML intact; only consume its known envelope.
  if(envelope&&/^client=\S+\r?$/m.test(envelope[1])&&/^delivery_channel=\S+\r?$/m.test(envelope[1])&&/^message_id=\S+\r?$/m.test(envelope[1]))return text.slice(envelope[0].length).trim();
  return text;
}

export function cloudItemEvents(threadId:string,turnId:string,item:any,createdAt:string):GatewayEvent[]{
  const common={threadId,turnId,itemId:item.id,eventId:`cloud:${turnId}:${item.id}`,createdAt};
  const delegated=delegatedMessage(item.type==='functionCallOutput'?item.output:item.type==='userMessage'?(item.content??[]).map((p:any)=>p.text||'').join('\n'):undefined);
  if(delegated)return [{type:'user.message',...common,...delegated,userVisible:true}];
  if(item.type==='userMessage'){const text=cloudUserText(item);return text?[{type:'user.message',...common,text,userVisible:true}]:[];}
  if(item.type==='agentMessage'&&item.phase!=='analysis')return item.text?.trim()?[{type:'message.delta',...common,text:item.text}]:[];
  if(item.type==='reasoning'){const text=(item.summary??[]).map((p:any)=>typeof p==='string'?p:p.text||'').join('\n');return text?[{type:'reasoning.summary',...common,text}]:[];}
  const activity=(title:string,detail:string):GatewayEvent[]=>[{type:'tool.started',...common,title,detail},...(['inProgress','running'].includes(item.status)?[]:[{type:'tool.completed' as const,...common,eventId:common.eventId+':done',status:item.status==='failed'?'error' as const:'ok' as const,detail}])];
  if(item.type==='commandExecution')return activity(item.command||'执行命令',item.aggregatedOutput||'');
  if(item.type==='mcpToolCall')return activity([item.server,item.tool].filter(Boolean).join(' · '),item.error?JSON.stringify(item.error):JSON.stringify(item.result??''));
  if(item.type==='fileChange')return [{type:'file.changed',...common,files:(item.changes??[]).map((c:any)=>c.path),diff:(item.changes??[]).map((c:any)=>c.diff||'').join('\n')}];
  return [];
}
