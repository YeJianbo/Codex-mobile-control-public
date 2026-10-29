import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {ChannelStore} from './store.js';

const digest=(code:string)=>createHash('sha256').update(code).digest();
type Pairing={digest:string;expiresAt:number};
export class QqAccess{
  private lastReply=new Map<string,number>();
  constructor(private store:ChannelStore,private now=Date.now){}
  senders(accountId:string){return this.store.privateValue<string[]>(accountId,'qq-authorized')||[];}
  allowed(accountId:string,senderId:string){return this.senders(accountId).includes(senderId);}
  private account(accountId:string){if(this.store.account(accountId)?.channel!=='qq')throw Error('请选择 QQ 通道账号');}
  pair(accountId:string){
    this.account(accountId);if(this.senders(accountId).length>=8)throw Error('最多授权 8 个 QQ 账号，请先清除旧授权');
    const code=randomBytes(12).toString('base64url'),expiresAt=this.now()+600000;
    this.store.putPrivate(accountId,'qq-pairing',{digest:digest(code).toString('hex'),expiresAt});
    return {code,expiresAt};
  }
  revoke(accountId:string){
    this.account(accountId);
    this.store.transaction(()=>{
      this.store.putPrivate(accountId,'qq-authorized',[]);this.store.putPrivate(accountId,'qq-pairing',null);
      for(const binding of this.store.bindings())if(binding.accountId===accountId)this.store.unbind(binding.id);
    });
  }
  check(accountId:string,senderId:string,text:string):{allowed:boolean;reply?:string}{
    const claim=/^\/绑定(?:\s+(\S+))?$/.exec(text.trim());
    if(claim){
      const code=claim[1]||'';
      const valid=(pairing:Pairing|null|undefined)=>/^[A-Za-z0-9_-]{16}$/.test(code)&&!!pairing&&pairing.expiresAt>this.now()&&/^[a-f0-9]{64}$/.test(pairing.digest)&&timingSafeEqual(Buffer.from(pairing.digest,'hex'),digest(code));
      if(!valid(this.store.privateValue<Pairing|null>(accountId,'qq-pairing')))return this.denied(accountId,'绑定码无效或已过期，请在控制台重新生成。');
      const accepted=this.store.transaction(()=>{
        const pairing=this.store.privateValue<Pairing|null>(accountId,'qq-pairing');
        if(!valid(pairing))return false;
        const allowed=this.senders(accountId);if(!allowed.includes(senderId)){if(allowed.length>=8)return false;allowed.push(senderId);}
        this.store.putPrivate(accountId,'qq-authorized',allowed);this.store.putPrivate(accountId,'qq-pairing',null);
        return true;
      });
      if(accepted)return {allowed:false,reply:'QQ 已绑定，可以直接与助理对话。'};
      return this.denied(accountId,'绑定码无效或已过期，请在控制台重新生成。');
    }
    return this.allowed(accountId,senderId)?{allowed:true}:this.denied(accountId,'此 QQ 尚未授权，请先在控制台生成绑定码。');
  }
  private denied(accountId:string,reply:string){
    const at=this.now();if(at-(this.lastReply.get(accountId)??-Infinity)<3000)return {allowed:false};
    this.lastReply.set(accountId,at);return {allowed:false,reply};
  }
}
