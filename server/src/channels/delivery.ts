import type {ChannelService} from './service.js';
import type {ChannelMessage,ChannelOutput,ChannelReceipt} from './types.js';

export type SendText=(chatId:string,senderId:string,text:string)=>Promise<void>;
export function channelFailureMessage(error:unknown){
  const message=error instanceof Error?error.message:'';
  if(/模型不在|可用的 Sol|模型目录|思考等级/.test(message))return '当前模型不可用，请在控制台检查 AGY 登录与模型目录后重试。';
  if(/目录不在|工作目录|原目录/.test(message))return '工作目录不可用。可在 QQ / 微信设置中切换为“通用助理 · 不绑定项目”，或重新选择项目。';
  if(/timeout|超时|端点|连接已关闭/i.test(message))return '电脑执行后端暂未响应，请稍后发送新消息；本条消息不会自动重复提交。';
  if(/原会话仍在运行/.test(message))return '原会话仍在运行，结束后发送新消息即可切换助理模型。';
  if(/官方或中转接口/.test(message))return '助理模型接口已改变，请发送一条新消息开启对应会话。原会话保留在控制台。';
  if(/原会话|会话绑定已改变/.test(message))return '这条消息属于原会话，请发送一条新消息继续。';
  return '本次请求未完成，可在 QQ / 微信设置查看错误并重试。';
}
export function channelDelivery(service:ChannelService,accountId:string,signal:AbortSignal,send:SendText,report:(message:string)=>void){
  const buffers=new Map<string,{item:string;text:string}>();
  const pending=new Set<Promise<void>>();
  const queues=new Map<string,Promise<void>>();
  const usable=(chatId:string,senderId:string,threadId?:string)=>!signal.aborted&&service.isBound(accountId,chatId,senderId,threadId);
  const deliver=(chatId:string,senderId:string,text:string,threadId?:string)=>{
    const key=JSON.stringify([chatId,senderId]);
    const job=(queues.get(key)??Promise.resolve()).then(async()=>{
      if(!usable(chatId,senderId,threadId))return;
      const chars=Array.from(text);await send(chatId,senderId,chars.slice(0,3200).join('')+(chars.length>3200?'\n（内容较长，发送 /结果 2 继续查看）':''));report('');
    }).catch(()=>report('消息未获平台确认，任务结果仍保留；可发送 /结果 重取。'));
    queues.set(key,job);pending.add(job);void job.finally(()=>{pending.delete(job);if(queues.get(key)===job)queues.delete(key);});return job;
  };
  return {
    async receive(message:ChannelMessage,submit:(message:ChannelMessage)=>Promise<ChannelReceipt|undefined>,unsupported=false){
      if(signal.aborted)return;
      const threadId=service.store.bindings().find(b=>b.accountId===accountId&&b.chatId===message.chatId&&b.senderId===message.senderId)?.threadId;
      const simple=async(text:string)=>{if(!signal.aborted)try{await send(message.chatId,message.senderId,text);}catch{report('消息未获平台确认，请稍后重试。');}};
      if(unsupported){await simple('当前聊天入口支持文字任务。图片与文件请从手机或电脑控制台发送。');return;}
      if(!message.text.trim())return;
      try{
        const response=await service.control(accountId,message);
        if(response!==undefined){if(!threadId||message.text.trim()==='/新会话')await simple(response);else await deliver(message.chatId,message.senderId,response,threadId);return;}
        const receipt=await submit(message);
        if(receipt?.state!=='accepted'){await simple(receipt?.state==='failed'?'任务提交失败，请在控制台查看。':'提交结果尚未确认，请先在控制台查看；不会自动重复启动任务。');return;}
        report('');
      }catch(error){const message=channelFailureMessage(error);report(message);await simple(message);}
    },
    onEvent({binding,event}:ChannelOutput){
      const key=`${binding.id}:${binding.threadId}`;
      if(event.type==='turn.started'){buffers.delete(key);return;}
      if(event.type==='message.delta'){
        const item=event.itemId??'answer',previous=buffers.get(key);
        buffers.set(key,{item,text:(event.textComplete||previous?.item!==item?event.text:previous.text+event.text).slice(-200000)});return;
      }
      let text='';
      if(event.type==='turn.completed'){text=buffers.get(key)?.text||`任务已结束（${event.status}），完整记录可在控制台查看。`;buffers.delete(key);}
      if(event.type==='goal.completed')text=event.text||'目标已完成。';
      if(event.type==='error'&&!event.willRetry)text='任务执行出现错误，请在控制台查看详情。';
      if(!text)return;
      service.store.putPrivate(accountId,`result:${key}`,text);
      void deliver(binding.chatId,binding.senderId,text,binding.threadId);
    },
    async close(){await Promise.allSettled([...pending]);buffers.clear();},
  };
}
