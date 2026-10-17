import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
type Rpc={
  request(method:string,params:unknown):Promise<unknown>;
  on?(event:string,listener:(message:any)=>void):unknown;
  off?(event:string,listener:(message:any)=>void):unknown;
};
const fastForTier=(tier:unknown):boolean|null=>tier==='fast'||tier==='priority'?true:tier===null||tier==='default'||tier==='flex'?false:null;
export function registerThreadFast(app:FastifyInstance,rpc:Rpc,validate:(id:string)=>Promise<void>){
  app.get('/api/settings/fast',async()=>{
    const result=await rpc.request('config/read',{}) as {config?:{service_tier?:string|null}};
    return {fast:result.config?fastForTier(result.config.service_tier??null):null};
  });
  app.get('/api/threads/:threadId/fast',async request=>{
    const {threadId}=z.object({threadId:z.string().min(1)}).parse(request.params);await validate(threadId);
    // Rejoin without configuration overrides; resume exposes the effective service tier.
    const result=await rpc.request('thread/resume',{threadId,excludeTurns:true}) as {serviceTier?:string|null};
    return {fast:Object.hasOwn(result,'serviceTier')?fastForTier(result.serviceTier):null,serviceTier:result.serviceTier??null};
  });
  app.put('/api/threads/:threadId/fast',async(request,reply)=>{
    const {threadId}=z.object({threadId:z.string().min(1)}).parse(request.params);
    const {fast}=z.object({fast:z.boolean()}).strict().parse(request.body);await validate(threadId);
    // The RPC acknowledges enqueueing the update, not applying it. Observe the
    // core settings event before reading back, or resume can return the old tier.
    let done=()=>{};
    const applied=new Promise<void>(resolve=>{done=resolve});
    const listener=(message:any)=>{
      if(message?.method==='thread/settings/updated'&&message.params?.threadId===threadId&&
        fastForTier(message.params?.threadSettings?.serviceTier)===fast)done();
    };
    const observes=Boolean(rpc.on&&rpc.off);
    let timer:ReturnType<typeof setTimeout>|undefined;
    if(observes){rpc.on!('notification',listener);timer=setTimeout(done,2500);}
    let result:{serviceTier?:string|null};
    try{
      await rpc.request('thread/settings/update',{threadId,serviceTier:fast?'fast':'default'});
      if(observes)await applied;
      result=await rpc.request('thread/resume',{threadId,excludeTurns:true}) as {serviceTier?:string|null};
    }finally{
      if(timer)clearTimeout(timer);
      if(observes)rpc.off!('notification',listener);
    }
    const confirmed=Object.hasOwn(result,'serviceTier')?fastForTier(result.serviceTier):null;
    if(confirmed!==fast)return reply.code(502).send({error:'会话尚未确认速度设置，请重新同步',fast:confirmed,serviceTier:result.serviceTier??null});
    return {fast:confirmed,serviceTier:result.serviceTier??null};
  });
}
