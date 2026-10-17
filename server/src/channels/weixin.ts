import {randomInt,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import QRCode from 'qrcode';
import type {ChannelDriver} from './types.js';
import type {ChannelService} from './service.js';
import {channelDelivery} from './delivery.js';

const defaultBase='https://ilinkai.weixin.qq.com';
type Credentials={token:string;botId:string;userId:string;base:string};
type Login={qrcode:string;qrImage:string;status:string;base:string;expiresAt:number;abort:AbortController};
type Message={message_id?:string|number;client_id?:string;from_user_id?:string;group_id?:string;message_type?:number;message_state?:number;context_token?:string;item_list?:{type:number;text_item?:{text:string}}[]};
export function weixinBase(value:string){const url=new URL(value.includes('://')?value:`https://${value}`);if(url.protocol!=='https:'||!(url.hostname==='ilinkai.weixin.qq.com'||url.hostname.endsWith('.weixin.qq.com'))||url.username||url.password||url.port)throw Error('微信返回的服务地址无效');return url.origin;}
class WeixinError extends Error{constructor(readonly code:number){super(`微信接口错误（${code}）`);}}
export async function weixinRequest(base:string,route:string,body:Record<string,unknown>|undefined,token:string|undefined,signal?:AbortSignal):Promise<any>{
  const appHeaders={'iLink-App-Id':'bot','iLink-App-ClientVersion':String((2<<16)|(4<<8)|9)};
  const headers:Record<string,string>={...appHeaders};
  if(body){Object.assign(headers,{'Content-Type':'application/json',AuthorizationType:'ilink_bot_token','X-WECHAT-UIN':Buffer.from(String(randomInt(0,0x100000000))).toString('base64')});}
  if(token){headers.Authorization=`Bearer ${token}`;body={...body,base_info:{channel_version:'2.4.9',bot_agent:'CodexMobileControl/0.6.82'}};}
  const response=await fetch(new URL(route,weixinBase(base)),{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(route.includes('getupdates')?40000:15000),...(signal?[signal]:[])])});
  if(!response.ok)throw new WeixinError(response.status);
  const text=await response.text();if(text.length>4*1024*1024)throw Error('微信响应过大');
  const data=JSON.parse(text,((key:string,value:unknown,context?:{source:string})=>typeof value==='number'&&!Number.isSafeInteger(value)&&['message_id','seq'].includes(key)?context?.source??String(value):value));
  if(data.ret||data.errcode)throw new WeixinError(Number(data.errcode||data.ret));return data;
}
export function weixinDriver(service:ChannelService):ChannelDriver{
  const logins=new Map<string,Login>(),details=new Map<string,Record<string,unknown>>(),polling=new Map<string,Promise<Record<string,unknown>>>(),loginAborts=new Map<string,AbortController>();
  const forget=(id:string)=>{loginAborts.get(id)?.abort();loginAborts.delete(id);logins.delete(id);polling.delete(id);details.delete(id);};
  return {
    kind:'weixin',forget,
    state:id=>{const saved=service.store.privateValue<Credentials>(id,'weixin');return {configured:!!saved,ownerId:saved?.userId,...details.get(id)};},
    async login(id,verifyCode){
      if(polling.has(id))return polling.get(id)!;
      const task=(async()=>{
        let login=logins.get(id);
        if(!login){
          const abort=new AbortController();loginAborts.set(id,abort);
          const result=await weixinRequest(defaultBase,'/ilink/bot/get_bot_qrcode?bot_type=3',{local_token_list:[]},undefined,abort.signal);
          if(typeof result.qrcode!=='string'||typeof result.qrcode_img_content!=='string')throw Error('微信未返回登录二维码');
          login={qrcode:result.qrcode,qrImage:await QRCode.toDataURL(result.qrcode_img_content,{width:256,margin:2}),base:defaultBase,status:'wait',expiresAt:Date.now()+8*60*1000,abort};abort.signal.throwIfAborted();logins.set(id,login);
        }else if(Date.now()>login.expiresAt){login.status='expired';}
        else if(!['confirmed','expired','binded_redirect','verify_code_blocked'].includes(login.status)){
          const result=await weixinRequest(login.base,`/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(login.qrcode)}${verifyCode?'&verify_code='+encodeURIComponent(verifyCode):''}`,undefined,undefined,login.abort.signal);
          login.abort.signal.throwIfAborted();
          login.status=String(result.status||'wait');
          if(result.status==='scaned_but_redirect'&&result.redirect_host)login.base=weixinBase(result.redirect_host);
          if(result.status==='confirmed'){
            if(!result.bot_token||!result.ilink_bot_id||!result.ilink_user_id)throw Error('微信登录响应缺少凭据');
            const saved:Credentials={token:result.bot_token,botId:result.ilink_bot_id,userId:result.ilink_user_id,base:weixinBase(result.baseurl||defaultBase)};
            const previous=service.store.privateValue<Credentials>(id,'weixin');
            if(previous&&(previous.botId!==saved.botId||previous.userId!==saved.userId))service.store.resetIdentity(id);
            service.store.putPrivate(id,'weixin',saved);details.set(id,{lastError:''});
          }
        }
        return {status:login.status,qrImage:login.qrImage,expiresAt:login.expiresAt};
      })();polling.set(id,task);
      try{return await task;}finally{if(polling.get(id)===task)polling.delete(id);}
    },
    async connect({account,signal,receive,failed}){
      const saved=service.store.privateValue<Credentials>(account.id,'weixin');if(!saved)throw Error('请先扫码登录微信');
      const report=(lastError:string)=>details.set(account.id,{...details.get(account.id),lastError});
      const delivery=channelDelivery(service,account.id,signal,async(chatId,senderId,text)=>{
        const token=service.store.privateValue<string>(account.id,`weixin-reply:${senderId}`);if(!token)throw Error('请先在微信发送消息');
        await weixinRequest(saved.base,'/ilink/bot/sendmessage',{msg:{from_user_id:'',to_user_id:senderId,client_id:`cmc-${randomUUID()}`,message_type:2,message_state:2,context_token:token,item_list:[{type:1,text_item:{text}}]}},saved.token,signal);
      },report);
      const updates=()=>weixinRequest(saved.base,'/ilink/bot/getupdates',{get_updates_buf:service.store.privateValue<string>(account.id,'weixin-cursor')||''},saved.token,signal);
      const first=await updates();details.set(account.id,{transport:'online',lastError:''});
      const handle=async(data:{msgs?:Message[];get_updates_buf?:string})=>{
        for(const message of data.msgs??[]){
          if(signal.aborted)return;
          if(message.message_type!==1||message.group_id||message.from_user_id!==saved.userId||message.message_state===1)continue;
          const senderId=message.from_user_id,chatId=`c2c:${senderId}`;
          if(message.context_token)service.store.putPrivate(account.id,`weixin-reply:${senderId}`,message.context_token);
          const id=String(message.message_id??message.client_id??'');if(!id)continue;
          const items=message.item_list??[],text=items.filter(item=>item.type===1).map(item=>item.text_item?.text??'').join('\n').trim();
          await delivery.receive({id,chatId,senderId,text},receive,items.some(item=>item.type!==1));
        }
        if(!signal.aborted&&data.get_updates_buf)service.store.putPrivate(account.id,'weixin-cursor',data.get_updates_buf);
      };
      const lifetime=(async()=>{
        await sleep(0,undefined,{signal});await handle(first);
        let failures=0;
        while(!signal.aborted){
          try{const data=await updates();await handle(data);failures=0;details.set(account.id,{...details.get(account.id),transport:'online'});if(!data.msgs?.length)await sleep(500,undefined,{signal});}
          catch(error){
            if(signal.aborted)return;
            if(error instanceof WeixinError&&[-14,401,403].includes(error.code)){report('微信登录已失效，请断开后重新扫码。');failed();return;}
            failures++;details.set(account.id,{transport:'reconnecting',lastError:'微信暂时无法连接，正在重试。'});await sleep(Math.min(failures*2000,30000),undefined,{signal});
          }
        }
      })().catch(()=>{if(!signal.aborted){report('微信收件中断，请重新连接。');failed();}});
      return {onEvent:delivery.onEvent,async close(){await lifetime;await delivery.close();details.set(account.id,{transport:'offline'});}};
    },
  };
}
