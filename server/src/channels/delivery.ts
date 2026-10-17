import type {ChannelService} from './service.js';
import type {ChannelMessage,ChannelOutput,ChannelReceipt} from './types.js';

export type SendText=(chatId:string,senderId:string,text:string)=>Promise<void>;
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
        await deliver(message.chatId,message.senderId,`已提交到会话 ${receipt.threadId?.slice(0,8)||''}。可发送 /状态、/结果 或 /停止。`,receipt.threadId);
      }catch{await simple('请求未完成，请在电脑控制台检查工作目录与任务状态。');}
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
