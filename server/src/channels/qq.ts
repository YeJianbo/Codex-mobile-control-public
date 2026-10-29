import {QQBot,type ReplyTarget} from '@tencent-connect/qqbot-nodejs';
import {z} from 'zod';
import type {ChannelDriver} from './types.js';
import type {ChannelService} from './service.js';
import {channelDelivery} from './delivery.js';

const credentials=z.object({appId:z.string().trim().regex(/^\d{4,30}$/),appSecret:z.string().trim().min(8).max(512)}).strict();
export function qqDriver(service:ChannelService,createBot:(options:ConstructorParameters<typeof QQBot>[0])=>QQBot=options=>new QQBot(options)):ChannelDriver{
  const details=new Map<string,Record<string,unknown>>();
  return {
    kind:'qq',
    state:id=>({configured:!!service.store.privateValue(id,'qq'),appId:service.store.privateValue<{appId:string}>(id,'qq')?.appId,authorizedCount:service.qqAccess.senders(id).length,...details.get(id)}),
    async configure(id,value){const parsed=credentials.parse(value);const previous=service.store.privateValue<{appId:string}>(id,'qq');if(previous&&previous.appId!==parsed.appId)service.store.resetIdentity(id);service.store.putPrivate(id,'qq',parsed);details.delete(id);},
    forget:id=>{details.delete(id);},
    async connect({account,signal,receive,failed}){
      const config=credentials.parse(service.store.privateValue(account.id,'qq'));
      const bot=createBot({...config,accountId:account.id,markdownSupport:false,intents:1<<25});
      const targets=new Map<string,ReplyTarget>();
      const report=(lastError:string)=>details.set(account.id,{...details.get(account.id),lastError});
      const delivery=channelDelivery(service,account.id,signal,async(chatId,senderId,text)=>{
        const saved=targets.get(senderId)??service.store.privateValue<{target:ReplyTarget;at:number}>(account.id,`qq-reply:${senderId}`)?.target;
        if(!saved)throw Error('请先在 QQ 发送消息');
        await bot.sendText(saved,text);
      },report);
      let readyResolve!:()=>void,readyReject!:(error:Error)=>void;
      const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
      bot.on('ready',()=>{details.set(account.id,{transport:'online',lastError:''});readyResolve();});
      bot.on('resumed',()=>details.set(account.id,{transport:'online',lastError:''}));
      bot.on('error',()=>{details.set(account.id,{transport:'reconnecting',lastError:'QQ 连接出现错误，正在重连；请核对机器人权限和凭据。'});});
      bot.on('message',async(_context,message)=>{
        if(signal.aborted||message.kind!=='c2c'||!message.replyTarget)return;
        const access=service.qqAccess.check(account.id,message.senderId,message.content);
        if(!access.allowed){if(access.reply&&!signal.aborted)await bot.sendText(message.replyTarget,access.reply).catch(()=>report('QQ 授权提示未获平台确认'));return;}
        const chatId=`c2c:${message.senderId}`;
        targets.set(message.senderId,message.replyTarget);
        service.store.putPrivate(account.id,`qq-reply:${message.senderId}`,{target:message.replyTarget,at:Date.now()});
        await delivery.receive({id:message.messageId,chatId,senderId:message.senderId,text:message.content.trim()},receive,!!message.attachments?.length);
      });
      const abort=()=>{bot.stop();readyReject(Error('连接已取消'));};signal.addEventListener('abort',abort,{once:true});
      const lifetime=bot.start(signal).catch(()=>{report('QQ 认证或连接失败，请核对 AppID、AppSecret 和私聊权限。');readyReject(Error('QQ 连接失败'));if(!signal.aborted)failed();});
      const timer=setTimeout(()=>{report('QQ 握手超时，请检查网络和机器人权限。');readyReject(Error('QQ 握手超时'));bot.stop();},30000);
      try{await ready;}catch(error){bot.stop();await lifetime;signal.removeEventListener('abort',abort);throw error;}finally{clearTimeout(timer);}
      return {onEvent:delivery.onEvent,async close(){bot.stop();signal.removeEventListener('abort',abort);await lifetime;await delivery.close();details.set(account.id,{transport:'offline'});}};
    },
  };
}
