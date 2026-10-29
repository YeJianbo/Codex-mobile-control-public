import {z} from 'zod';
import type {GatewayEvent} from '../types.js';
import {ChannelStore} from './store.js';
import {QqAccess} from './qqAccess.js';
import type {ChannelDriver,ChannelConnection,ChannelKind,ChannelMessage,ChannelTaskPort,ChannelReceipt,ChannelBinding} from './types.js';

const identity=z.string().trim().min(1).max(512);
const inbound=z.object({id:identity,chatId:identity,senderId:identity,text:z.string().min(1).max(200000)}).strict();
type Running={abort:AbortController;state:'connecting'|'connected'|'error';connection?:ChannelConnection;pending?:Promise<void>};
const outputs=new Set(['message.delta','turn.started','turn.completed','goal.completed','error']);
export class ChannelService {
  private drivers=new Map<ChannelKind,ChannelDriver>();
  private running=new Map<string,Running>();
  private inFlight=new Map<string,Promise<ChannelReceipt|undefined>>();
  private conversations=new Map<string,Promise<ChannelReceipt|undefined>>();
  readonly qqAccess:QqAccess;
  constructor(readonly store:ChannelStore,private readonly tasks:ChannelTaskPort){this.qqAccess=new QqAccess(store);}
  isAuthorized(accountId:string,senderId:string){const account=this.store.account(accountId);return !!account&&(account.channel!=='qq'||this.qqAccess.allowed(accountId,senderId));}
  register(driver:ChannelDriver){if(this.drivers.has(driver.kind))throw Error('通道驱动已注册');this.drivers.set(driver.kind,driver);}
  state(){return {channels:(['qq','weixin'] as const).map(kind=>({kind,available:this.drivers.has(kind)})),accounts:this.store.accounts().map(account=>({...account,projectPath:this.store.privateValue<string>(account.id,'projectPath')||'',state:this.running.get(account.id)?.state??(this.drivers.has(account.channel)?'disconnected':'unavailable'),details:this.drivers.get(account.channel)?.state?.(account.id)??{}})),bindings:this.store.bindings()};}
  async setProject(id:string,projectPath:string){this.driver(id);if(projectPath){if(!this.tasks.validateProject)throw Error('项目配置暂不可用');await this.tasks.validateProject(projectPath);}this.store.putPrivate(id,'projectPath',projectPath);}
  private driver(id:string){const account=this.store.account(id);if(!account)throw Error('通道账号不存在');const driver=this.drivers.get(account.channel);if(!driver)throw Error('此通道的平台驱动尚未接入');return driver;}
  async configure(id:string,value:unknown){const driver=this.driver(id);if(!driver.configure)throw Error('此通道不使用手动凭据');await this.stop(id);await driver.configure(id,value);}
  async login(id:string,verifyCode?:string,refresh=false){const driver=this.driver(id);if(!driver.login)throw Error('此通道不支持扫码');if(this.running.has(id))throw Error('请先断开通道');if(refresh)driver.forget?.(id);return driver.login(id,verifyCode);}
  begin(id:string){this.driver(id);if(this.running.has(id))throw Error('请先断开当前通道再连接');this.store.putPrivate(id,'enabled',true);void this.start(id).catch(()=>{});}
  restore(){for(const account of this.store.accounts())if(this.store.privateValue(account.id,'enabled'))this.begin(account.id);}
  isBound(accountId:string,chatId:string,senderId:string,threadId?:string){return this.isAuthorized(accountId,senderId)&&this.store.bindings().some(b=>b.accountId===accountId&&b.chatId===chatId&&b.senderId===senderId&&(!threadId||b.threadId===threadId));}
  async control(accountId:string,message:ChannelMessage):Promise<string|undefined>{
    if(!this.isAuthorized(accountId,message.senderId))throw Error('QQ 账号尚未授权');
    const command=message.text.trim();if(!command.startsWith('/'))return;
    const binding=this.store.bindings().find(b=>b.accountId===accountId&&b.chatId===message.chatId&&b.senderId===message.senderId);
    if(!binding)return '直接发送文字即可与助理对话。创建后可发送 /状态、/结果、/停止。';
    await this.tasks.validateThread(binding.threadId);
    if(!this.isBound(accountId,message.chatId,message.senderId,binding.threadId))throw Error('会话绑定已改变');
    if(command==='/帮助')return '普通文字：发送任务\n/状态：当前会话\n/结果 或 /结果 2：读取最近结果\n/停止：停止当前任务\n/新会话：下一条消息开始新会话\n审批请在电脑或手机控制台操作。';
    if(command==='/新会话'){this.store.unbind(binding.id);return '下一条消息会开始新会话。原会话保留在控制台，正在执行的任务不会被中止。';}
    if(command==='/状态'){const status=await this.tasks.status?.(binding.threadId);return `会话：${binding.threadId}\n${({running:'运行中',idle:'待命',interrupted:'已中断',error:'出现错误'} as Record<string,string>)[status||'']||status||'已绑定'}`;}
    if(command==='/停止'){
      if(!this.tasks.interrupt)throw Error('此后端不支持停止');
      const request=this.store.request(binding,message.id);if(request.threadId!==binding.threadId)throw Error('消息已属于原会话');
      const key=`stop:${request.requestId}`,seen=this.store.privateValue<boolean>(accountId,key);if(seen)return '停止请求已处理。';
      await this.tasks.interrupt(binding.threadId,request.requestId);this.store.putPrivate(accountId,key,true);return '已提交停止请求。';
    }
    if(/^\/结果(?:\s+\d+)?$/.test(command)){
      const history=await this.tasks.result?.(binding.threadId).catch(()=>undefined);
      const text=history||this.store.privateValue<string>(accountId,`result:${binding.id}:${binding.threadId}`)||'尚无已收到的结果。';
      const page=Math.max(1,Number(command.split(/\s+/)[1]||1));const total=Math.ceil(Array.from(text).length/3000);
      return Array.from(text).slice((page-1)*3000,page*3000).join('')+`\n（${page}/${total}，/结果 页码 可翻页）`;
    }
    return '未知指令。发送 /帮助 查看用法；普通文字会作为新任务发送。';
  }
  async bind(binding:Omit<ChannelBinding,'id'>){
    if(!this.store.account(binding.accountId))throw Error('通道账号不存在');
    await this.tasks.validateThread(binding.threadId);
    return this.store.bind(binding);
  }
  async start(id:string){
    if(this.running.has(id))throw Error('请先断开当前通道再连接');
    const account=this.store.account(id);if(!account)throw Error('通道账号不存在');
    const driver=this.drivers.get(account.channel);if(!driver)throw Error('此通道的平台驱动尚未接入');
    const entry:Running={abort:new AbortController(),state:'connecting'};this.running.set(id,entry);
    const current=()=>this.running.get(id)===entry&&!entry.abort.signal.aborted;
    entry.pending=(async()=>{
      try{
        const connection=await driver.connect({account,signal:entry.abort.signal,
          receive:message=>{if(!current())return Promise.reject(Error('通道已断开'));return this.receive(id,message,current);},
          failed:()=>{if(current()){entry.state='error';entry.abort.abort();}}
        });
        if(!current()){await connection.close();return;}
        entry.connection=connection;entry.state='connected';
      }catch{if(this.running.get(id)===entry){entry.state='error';entry.abort.abort();}throw Error('通道连接失败，请在平台驱动中检查认证与网络');}
    })();
    await entry.pending;
  }
  async stop(id:string){if(this.store.account(id))this.store.putPrivate(id,'enabled',false);const entry=this.running.get(id);if(!entry)return;this.running.delete(id);entry.abort.abort();await entry.pending?.catch(()=>{});await entry.connection?.close();}
  async remove(id:string){await this.stop(id);const account=this.store.account(id);if(account)this.drivers.get(account.channel)?.forget?.(id);this.store.removeAccount(id);}
  private async receive(accountId:string,raw:ChannelMessage,current:()=>boolean){
    const message=inbound.parse(raw);
    const key=JSON.stringify([accountId,message.chatId,message.senderId]);
    const previous=this.conversations.get(key)??Promise.resolve();
    const work=previous.catch(()=>{}).then(()=>this.receiveInConversation(accountId,message,current));
    this.conversations.set(key,work);try{return await work;}finally{if(this.conversations.get(key)===work)this.conversations.delete(key);}
  }
  private async receiveInConversation(accountId:string,message:ChannelMessage,current:()=>boolean){
    if(!current())throw Error('通道已断开');
    if(!this.isAuthorized(accountId,message.senderId))throw Error('QQ 账号尚未授权');
    const binding=this.store.bindings().find(b=>b.accountId===accountId&&b.chatId===message.chatId&&b.senderId===message.senderId);
    const recorded=this.store.findRequest(accountId,message.chatId,message.senderId,message.id);
    if(recorded?.threadId&&recorded.threadId!==binding?.threadId)throw Error('这条消息已属于原会话，请发送新消息');
    if(recorded){const receipt=await this.tasks.receipt(recorded.requestId);if(receipt)return receipt;}
    const changeRoute=!!binding&&(!recorded||!recorded.threadId)&&await this.tasks.requiresNewThread?.(binding.threadId)===true;
    if(changeRoute){
      await this.tasks.validateThread(binding.threadId);
      if(await this.tasks.status?.(binding.threadId)==='running')throw Error('原会话仍在运行，请等待结束后再发送新消息');
    }
    if(!binding||changeRoute||recorded?.threadId===''){
      const configuredProject=this.store.privateValue<string>(accountId,'projectPath');
      if(!configuredProject&&!this.tasks.prepareWorkspace)throw Error('请先在电脑设置工作目录');
      const request=this.store.request({id:'',accountId,chatId:message.chatId,senderId:message.senderId,threadId:''},message.id);
      if(request.threadId)throw Error('原会话已解除，请发送新消息');
      const previous=await this.tasks.receipt(request.requestId);
      let receipt=previous;
      if(!receipt){
        const projectPath=binding?await this.tasks.prepareWorkspace!(request.requestId,binding.threadId):configuredProject||await this.tasks.prepareWorkspace!(request.requestId);
        if(configuredProject&&!binding)await this.tasks.validateProject!(projectPath);
        const stillBound=!binding||this.isBound(accountId,message.chatId,message.senderId,binding.threadId);
        if(!current()||!stillBound||!this.isAuthorized(accountId,message.senderId))throw Error('通道或账号授权已改变');
        receipt=await this.tasks.submit({requestId:request.requestId,projectPath,text:configuredProject?message.text:channelAssistantPrompt(message.text)});
      }
      if(receipt?.threadId&&this.store.assignRequest(accountId,request.requestId,receipt.threadId))this.store.bind({accountId,chatId:message.chatId,senderId:message.senderId,threadId:receipt.threadId});
      return receipt;
    }
    const request=this.store.request(binding,message.id);
    if(request.threadId!==binding.threadId)throw Error('这条消息已属于原会话，请发送新消息');
    const previous=this.inFlight.get(request.requestId);if(previous)return previous;
    const work=(async()=>{
      const receipt=await this.tasks.receipt(request.requestId);if(receipt)return receipt;
      await this.tasks.validateThread(binding.threadId);
      const stillBound=this.store.bindings().some(b=>b.id===binding.id&&b.threadId===binding.threadId);
      if(!current()||!stillBound||!this.isAuthorized(accountId,message.senderId))throw Error('通道或会话绑定已改变');
      return this.tasks.submit({...request,text:message.text});
    })();
    this.inFlight.set(request.requestId,work);
    try{return await work;}finally{this.inFlight.delete(request.requestId);}
  }
  publish(event:GatewayEvent){
    if(event.type==='thread.started'&&event.requestId&&!event.replayed)this.store.acceptThread(event.requestId,event.threadId);
    if(this.running.size===0||event.replayed||event.subagent||!('threadId' in event)||!event.threadId||!outputs.has(event.type))return;
    for(const binding of this.store.bindings()){
      if(binding.threadId!==event.threadId||!this.isAuthorized(binding.accountId,binding.senderId))continue;
      const entry=this.running.get(binding.accountId);if(entry?.state!=='connected'||entry.abort.signal.aborted)continue;
      try{entry.connection?.onEvent({binding,event:event as Parameters<ChannelConnection['onEvent']>[0]['event']});}
      catch{entry.state='error';entry.abort.abort();}
    }
  }
  async close(){const ids=[...this.running.keys()];const enabled=ids.filter(id=>this.store.privateValue(id,'enabled'));for(const account of this.store.accounts())this.drivers.get(account.channel)?.forget?.(account.id);await Promise.allSettled(ids.map(id=>this.stop(id)));for(const id of enabled)if(this.store.account(id))this.store.putPrivate(id,'enabled',true);await Promise.allSettled([...this.conversations.values(),...this.inFlight.values()]);this.store.close();}
}

export function channelAssistantPrompt(text:string){
  return '你是用户的通用个人助理，当前入口是 QQ 或微信。使用简体中文，自然回答普通聊天，不把每条消息都当作代码任务。当前目录是本会话的独立助理空间，不代表用户已指定项目。需要处理已有项目而目标不明时，先确认目标；不要凭空选择其他会话或项目。根据实际可用工具执行任务，沿用现有审批与权限，不假装拥有未提供的跨应用或跨 Harness 能力。只将最终答复发送给用户。\n\n用户消息：\n'+text;
}
