import {randomUUID} from 'node:crypto';

// Plans bind a visible confirmation to the same account/configuration. All
// credential writes share admission and recheck running tasks before writing.
export class AccountSwitchControl {
 constructor({inspectActivity,now=()=>Date.now()}){this.inspectActivity=inspectActivity;this.now=now;this.plans=new Map();this.pending=Promise.resolve();}
 async preview(key,agent,inspect){
  const {view,revision}=await inspect(),blocking=await this.inspectActivity(agent);
  for(const [id,plan] of this.plans)if(plan.expires<this.now())this.plans.delete(id);
  const planId=randomUUID(),canSwitch=blocking.length===0&&view.canSwitch!==false;
  if(canSwitch){if(this.plans.size>=100)this.plans.delete(this.plans.keys().next().value);this.plans.set(planId,{key,revision,expires:this.now()+180000});}
  return {...view,planId:canSwitch?planId:null,canSwitch,blockingThreads:blocking,message:blocking.length?`仍有 ${blocking.length} 个会话或任务正在运行，请结束后重试`:view.message};
 }
 apply(key,agent,planId,inspect,write){
  const operation=this.pending.then(async()=>{
   const plan=this.plans.get(planId);
   if(!plan||plan.key!==key||plan.expires<this.now())throw Object.assign(new Error('切换预览已过期，请重新预览'),{statusCode:409});
   this.plans.delete(planId);
   const current=await inspect();
   if(current.revision!==plan.revision||current.view.canSwitch===false)throw Object.assign(new Error('账号或配置状态已变化，请重新预览'),{statusCode:409});
   const blocking=await this.inspectActivity(agent);
   if(blocking.length)throw Object.assign(new Error(`仍有 ${blocking.length} 个会话或任务正在运行，请结束后重试`),{statusCode:409});
   return write();
  });this.pending=operation.catch(()=>{});return operation;
 }
}
