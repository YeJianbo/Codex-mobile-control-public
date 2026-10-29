import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Writable} from 'node:stream';
import {atomicWrite} from './catalog.mjs';
import {json} from './store.mjs';
import {usageObserver} from './usage.mjs';
import {fiveHourSchedule,fiveHourSlots,legacyWarmupHours,recordFiveHourSlot} from './quota-warmup-schedule.mjs';

const windows={weekly:{key:'secondary',seconds:604800},fiveHour:{key:'primary',seconds:18000}};
const seconds=value=>Number.isFinite(value)&&value>0?value:null;
const windowValue=(record,name)=>{
  const spec=windows[name],value=record?.[spec.key];
  return value?.limit_window_seconds===spec.seconds&&Number.isFinite(value.used_percent)&&value.used_percent>=0&&value.used_percent<=100
    ?{resetAt:seconds(value.reset_at),used:value.used_percent}:null;
};
const belongs=(record,account)=>record?.accountKey===account||record?.accountKey?.endsWith('::'+account);
const officialModels=store=>(store.models?.()||[]).filter(item=>!item.slug.includes('::')&&item.visibility!=='hide');
/** One account-scoped request per observed reset; simultaneous windows share a request. */
export class QuotaWarmup{
  constructor(store,usage,{idle,send,identity=()=>store.auth().tokens.account_id,now=()=>Date.now(),intervalMs=30000}={}){
    this.store=store;this.usage=usage;this.idle=idle;this.send=send;this.identity=identity;this.now=now;this.intervalMs=intervalMs;
    this.file=path.join(store.dir,'quota-warmup.json');this.data=json(this.file,{accounts:{}});this.running=null;this.timer=null;this.closed=false;
    this.status='waiting';this.lastError=null;this.nextCheckAt=null;this.controller=null;this.revision=0;this.account=null;
    for(const entry of Object.values(this.data.accounts))if(entry.attempt?.state==='sending')entry.attempt.state='uncertain';
  }
  save(){atomicWrite(this.file,this.data);}
  enabled(){return this.store.data.quotaWarmupEnabled===true;}
  selected(){return this.store.data.quotaWarmupWindows||['weekly'];}
  fiveHourSchedule(){
    const saved=this.store.data.quotaWarmupFiveHourSchedule;
    return saved?fiveHourSchedule(saved):this.store.data.quotaWarmupActiveHours?.enabled?legacyWarmupHours(this.store.data.quotaWarmupActiveHours):fiveHourSchedule();
  }
  timed(){return this.selected().includes('fiveHour')&&this.fiveHourSchedule().enabled;}
  allowed(name,entry){
    if(name!=='fiveHour'||!this.timed())return true;
    const slot=fiveHourSlots(this.fiveHourSchedule(),this.now()).due;
    return !!slot&&entry.pending.fiveHour?.cycle===slot.key&&!(entry.fiveHourNotBefore>this.now());
  }
  coversSlot(current,slot){return current.used>0&&current.resetAt*1000>this.now()&&current.resetAt*1000-18000000>=slot.at-1000;}
  state(){
    let account;try{account=this.identity();}catch{}
    const entry=this.data.accounts[account],schedule=this.fiveHourSchedule();
    return {enabled:this.enabled(),windows:this.selected(),model:this.store.data.quotaWarmupModel||'',models:officialModels(this.store).map(item=>({id:item.slug,name:item.display_name||item.slug})),fiveHourSchedule:schedule,nextFiveHourAt:fiveHourSlots(schedule,this.now()).next?.at||null,
      activeHours:this.store.data.quotaWarmupActiveHours||{enabled:false,start:'08:00',end:'23:00',timeZone:schedule.timeZone},status:this.enabled()?(!account?'no-account':account===this.account?this.status:entry?.attempt?.state||'waiting'):'disabled',
      resets:Object.fromEntries(Object.entries(entry?.observed||{}).map(([key,value])=>[key,value.resetAt])),
      nextCheckAt:this.nextCheckAt,lastAttempt:entry?.attempt||null,lastError:account===this.account?this.lastError:null};
  }
  configure({enabled,windows:selected=this.selected(),model,fiveHourSchedule:plan,activeHours:hours}){
    if(typeof enabled!=='boolean')throw Error('自动预热开关无效');
    if(!Array.isArray(selected)||!selected.length||selected.some(name=>!Object.hasOwn(windows,name)))throw Error('请选择有效的额度窗口');
    if(model!==undefined&&(typeof model!=='string'||model!==''&&!officialModels(this.store).some(item=>item.slug===model)))throw Error('请选择可用的官方暖机模型');
    let settings=plan===undefined?this.fiveHourSchedule():fiveHourSchedule(plan);
    if(hours!==undefined){
      const migrated=legacyWarmupHours(hours);
      if(plan===undefined&&JSON.stringify(hours)!==JSON.stringify(this.state().activeHours))settings=migrated;
    }
    this.revision++;this.store.data.quotaWarmupEnabled=enabled;this.store.data.quotaWarmupWindows=[...new Set(selected)];this.store.data.quotaWarmupFiveHourSchedule=settings;
    if(hours!==undefined)this.store.data.quotaWarmupActiveHours={enabled:hours.enabled,start:hours.start,end:hours.end,timeZone:hours.timeZone};
    if(model!==undefined)this.store.data.quotaWarmupModel=model;
    this.store.save();
    if(!enabled)this.controller?.abort();
    clearTimeout(this.timer);this.nextCheckAt=null;
    if(enabled)this.schedule(0);
    return this.state();
  }
  start(){if(!this.closed&&!this.timer&&this.enabled())this.schedule(5000);}
  schedule(delay){
    if(this.closed||!this.enabled())return;
    clearTimeout(this.timer);
    if(this.timed()){
      const now=this.now(),slot=fiveHourSlots(this.fiveHourSchedule(),now).next;
      const entry=this.data.accounts[this.account],reset=entry?.pending?.fiveHour&&entry.observed?.fiveHour?.resetAt*1000;
      for(const at of [slot?.at,reset,entry?.fiveHourNotBefore])if(at>now)delay=Math.min(delay,at-now);
    }
    this.nextCheckAt=this.enabled()?this.now()+delay:null;
    this.timer=setTimeout(()=>{this.timer=null;void this.tick().finally(()=>this.schedule(this.intervalMs));},delay);this.timer.unref?.();
  }
  async tick(){
    if(this.running)return this.running;
    if(!this.enabled()||this.closed)return;
    this.running=this.check().catch(error=>{this.lastError=error.message;this.status='error';}).finally(()=>{this.running=null;});
    return this.running;
  }
  async check(){
    let account;try{account=this.identity();}catch{this.status='no-account';return;}
    if(!account){this.status='no-account';return;}
    this.account=account;
    const revision=this.revision;
    const record=await this.usage.refresh({recordHistory:false});
    if(!this.enabled()||this.closed||this.identity()!==account||revision!==this.revision)return;
    if(!belongs(record,account))return;
    this.account=account;this.lastError=null;
    const entry=this.data.accounts[account]??={observed:{},pending:{},cycles:{},attempt:null};
    const now=Math.floor(this.now()/1000);let available=false;
    for(const name of this.selected()){
      const current=windowValue(record,name);if(!current)continue;available=true;
      const previous=entry.observed[name];
      if(name==='fiveHour'&&this.timed()){
        const slot=fiveHourSlots(this.fiveHourSchedule(),this.now()).due;
        if(!slot||entry.fiveHourSlots?.[slot.key])delete entry.pending.fiveHour;
        else if(this.coversSlot(current,slot)){
          recordFiveHourSlot(entry,{cycle:slot.key,slot},'covered',this.now());delete entry.pending.fiveHour;
          entry.attempt={state:'covered',at:this.now(),windows:[name],plannedAt:slot.at};
        }else if(entry.pending.fiveHour?.cycle!==slot.key)entry.pending.fiveHour={cycle:slot.key,slot,detectedAt:this.now()};
        entry.observed[name]={...current,at:this.now()};continue;
      }
      if(name==='fiveHour'&&entry.pending.fiveHour?.slot)delete entry.pending.fiveHour;
      // A warmup itself can move reset_at before rounded usage becomes nonzero.
      // That acknowledgement is not another empty bucket to warm immediately.
      if(name==='fiveHour'&&entry.fiveHourNotBefore>this.now()){
        entry.observed[name]={...current,at:this.now()};continue;
      }
      // Official zero usage confirms an expired bucket, or an early server reset.
      const due=previous?.resetAt&&previous.resetAt<=now;
      const early=previous&&previous.used>0&&current.used===0;
      const moved=previous?.resetAt&&current.resetAt&&current.resetAt>previous.resetAt+60;
      const expired=current.resetAt&&current.resetAt<=now;
      if(current.used===0&&(due||early||moved||expired)&&!entry.pending[name]){
        const cycle=String(previous?.resetAt||current.resetAt||record.at);
        if(entry.cycles[name]!==cycle)entry.pending[name]={cycle,detectedAt:this.now()};
      }
      if(entry.pending[name]&&current.used>0){
        entry.cycles[name]=entry.pending[name].cycle;delete entry.pending[name];
        entry.attempt={state:'covered',at:this.now(),windows:[name]};
      }
      entry.observed[name]={...current,at:this.now()};
    }
    for(const name of Object.keys(entry.pending))if(!this.selected().includes(name))delete entry.pending[name];
    this.save();
    if(!Object.keys(entry.pending).length){this.status=!available?'unavailable':entry.attempt?.state==='uncertain'?'uncertain':this.timed()?'waiting-time':entry.attempt?.state||'waiting';return;}
    if(!Object.keys(entry.pending).some(name=>this.allowed(name,entry))){this.status=entry.pending.fiveHour?.slot?'waiting-reset':'waiting-time';return;}
    this.status='waiting-idle';
    if(!await this.idle()||!this.enabled()||this.closed||this.identity()!==account||revision!==this.revision)return;
    // Re-read after activity inspection; a user request may already have opened this window.
    const freshRecord=await this.usage.refresh({recordHistory:false});
    if(!belongs(freshRecord,account)||!this.enabled()||this.closed||this.identity()!==account||revision!==this.revision)return;
    const eligible=[];
    for(const name of Object.keys(entry.pending)){
      const fresh=windowValue(freshRecord,name);if(!fresh)continue;
      if(fresh.used===0){if(this.allowed(name,entry))eligible.push(name);}
      else if(!entry.pending[name].slot||this.coversSlot(fresh,entry.pending[name].slot)){
        recordFiveHourSlot(entry,entry.pending[name],'covered',this.now());
        entry.cycles[name]=entry.pending[name].cycle;delete entry.pending[name];entry.attempt={state:'covered',at:this.now(),windows:[name]};
      }
      entry.observed[name]={...fresh,at:this.now()};
    }
    this.save();
    if(!eligible.length){this.status=Object.keys(entry.pending).length?'waiting-reset':'covered';return;}
    if(!await this.idle()||!this.enabled()||this.identity()!==account||this.closed||revision!==this.revision)return;
    // Admission may straddle the end of a scheduled slot.
    for(let i=eligible.length-1;i>=0;i--)if(!this.allowed(eligible[i],entry))eligible.splice(i,1);
    if(!eligible.length){this.status='waiting-time';return;}
    if(this.store.data.quotaWarmupModel&&!officialModels(this.store).some(item=>item.slug===this.store.data.quotaWarmupModel)){
      this.status='error';this.lastError='所选暖机模型已不可用，请重新选择';return;
    }
    const attempt={state:'sending',at:this.now(),windows:eligible,...(eligible.includes('fiveHour')&&entry.pending.fiveHour?.slot?{plannedAt:entry.pending.fiveHour.slot.at}:{})};entry.attempt=attempt;
    for(const name of eligible){recordFiveHourSlot(entry,entry.pending[name],'sending',this.now());entry.cycles[name]=entry.pending[name].cycle;delete entry.pending[name];}
    const primary=windowValue(freshRecord,'fiveHour');
    if(primary?.used===0){
      const canOpen=!(entry.fiveHourNotBefore>this.now()),reset=primary.resetAt*1000;
      entry.fiveHourNotBefore=reset>this.now()?Math.min(reset,this.now()+18000000):this.now()+18000000;
      // A weekly request also opens an empty 5h window and can cover a due slot.
      if(entry.pending.fiveHour&&(!entry.pending.fiveHour.slot||canOpen)){recordFiveHourSlot(entry,entry.pending.fiveHour,'shared',this.now());entry.cycles.fiveHour=entry.pending.fiveHour.cycle;delete entry.pending.fiveHour;}
    }
    this.save();
    // Persist before dispatch: after a crash/disconnect an accepted request must not be duplicated.
    this.status='sending';this.controller=new AbortController();
    const timeout=setTimeout(()=>this.controller?.abort(),45000);timeout.unref?.();
    try{
      const result=await this.send(account,this.controller.signal);
      attempt.state='complete';attempt.completedAt=this.now();attempt.model=result.model;this.status='complete';
    }catch(error){attempt.state='uncertain';attempt.error=error.message;this.lastError=error.message;this.status='uncertain';}
    finally{clearTimeout(timeout);this.controller=null;this.save();}
  }
  stop(){this.closed=true;clearTimeout(this.timer);this.controller?.abort();}
}

/** Direct official request: no relay mapping, conversation history, or executable tools. */
export async function sendQuotaWarmup(store,usage,account,signal,{fetchImpl=fetch}={}){
  const auth=store.auth();if(auth.tokens.account_id!==account)throw Error('登录账号已变化');
  const models=officialModels(store),configured=store.data?.quotaWarmupModel;
  const selected=configured?models.find(item=>item.slug===configured):models.find(item=>item.slug==='gpt-6.1-sol')||models[0];
  if(configured&&!selected)throw Error('所选暖机模型已不可用，请重新选择');
  if(!selected)throw Error('没有可用的官方模型');
  const model=selected.slug,levels=selected.supported_reasoning_levels?.map(item=>item.effort)||['low'];
  const effort=['low','minimal','none'].find(level=>levels.includes(level))||levels[0];
  const body={model,instructions:'Reply with OK only. Do not use tools.',input:[{role:'user',content:[{type:'input_text',text:'Reply OK.'}]}],
    tools:[],tool_choice:'none',store:false,stream:true,...(effort?{reasoning:{effort}}:{}),service_tier:'default'};
  const started=performance.now(),observer=usageObserver({startedAt:started});let status=0,errorCode=null;
  try{
    const response=await fetchImpl('https://chatgpt.com/backend-api/codex/responses',{method:'POST',redirect:'error',signal,
      headers:{Authorization:'Bearer '+auth.tokens.access_token,'ChatGPT-Account-Id':account,'Content-Type':'application/json',Accept:'text/event-stream',originator:'codex_cli_rs'},body:JSON.stringify(body)});
    status=response.status;if(!response.ok){await response.body?.cancel();throw Error('预热请求 HTTP '+response.status);}
    if(!response.body)throw Error('预热响应为空');
    observer.expectSSE(response.headers.get('content-type')?.includes('text/event-stream'));
    await pipeline(Readable.fromWeb(response.body),observer.stream,new Writable({write(_chunk,_encoding,done){done();}}));
    if(observer.getFailure())throw Error(observer.getFailure().message||'预热响应未完成');
    return {model};
  }catch(error){errorCode='QUOTA_WARMUP_UNCONFIRMED';throw error;}
  finally{usage.recordRequest({model,effort:effort||null,tier:observer.getTier()||'default',provider:'openai',resource:'responses',status,
    durationMs:performance.now()-started,usage:observer.getUsage(),timings:observer.getTimings(),errorCode,test:true,purpose:'warmup'});}
}
