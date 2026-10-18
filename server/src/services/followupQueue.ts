import type {StateStore} from './stateStore.js';
import type {SessionManager} from './sessionManager.js';
import type {ImageAttachment} from './imageUploads.js';
import type {FileAttachment} from './fileUploads.js';
import {isWriterOccupied,userFacingError} from './userFacingError.js';
import {submissionFailureKind} from './submissionErrors.js';

export type Followup = {id:string;threadId:string;text:string;images:ImageAttachment[];files:FileAttachment[];model?:string;effort?:string;mode?:"plan"|"default";fast?:boolean;permission?:'ask'|'auto'|'full'|'custom';sourcePublic?:boolean;createdAt:string;status:'queued'|'sending'|'failed'|'sent'|'editing';error?:string;resume?:boolean;order?:number};
export class FollowupQueue {
  private entries:Followup[];
  private busy=new Set<string>();
  private checking=new Set<string>();
  private retryAfter=new Map<string,number>();
  private timer:NodeJS.Timeout;
  constructor(private store:StateStore,private sessions:SessionManager,
    private status:(id:string)=>Promise<string>,private send:(entry:Followup)=>Promise<void>) {
    this.entries=store.readFollowups() as Followup[];
    const migratingOrder=this.entries.some(entry=>entry.order===undefined);
    this.entries.forEach((entry,index)=>{entry.files??=[];entry.order??=index;});
    if(migratingOrder)this.store.writeFollowupOrder(this.entries);
    this.entries.sort((a,b)=>a.order!-b.order!);
    for(const entry of this.entries)if(entry.status==='sending'){entry.status='failed';entry.error='连接中断，发送结果待确认，请检查任务后重试';this.save(entry);}
    this.timer=setInterval(()=>void this.tick(),1500);this.timer.unref();
  }
  close(){clearInterval(this.timer);}
  list(threadId:string){return this.entries.filter(e=>e.threadId===threadId&&e.status!=='sent'&&e.status!=='editing').map(e=>({...e,canSteer:this.sessions.canSteer(threadId)}));}
  drafts(threadId:string){return this.entries.filter(e=>e.threadId===threadId&&e.status==='editing').map(e=>({...e}));}
  entry(id:string,threadId:string){const entry=this.entries.find(e=>e.id===id&&e.threadId===threadId);return entry?{...entry}:undefined;}
  takeForEditing(id:string,threadId:string){
    const existing=this.entries.find(e=>e.id===id&&e.threadId===threadId);
    if(existing?.status==='editing')return {...existing};
    const entry=this.mutable(id,threadId),draft={...entry,status:'editing' as const};
    // Persist the recoverable copy before it stops participating in the queue.
    this.save(draft);Object.assign(entry,draft);this.retryAfter.delete(id);
    return {...draft};
  }
  finishEditing(id:string,threadId:string){
    const entry=this.entries.find(e=>e.id===id&&e.threadId===threadId);
    if(!entry)return;
    if(entry.status!=='editing')throw new Error('消息尚未取回编辑');
    this.store.removeFollowup(id);this.entries=this.entries.filter(e=>e!==entry);
  }
  add(entry:Omit<Followup,'status'|'createdAt'>){
    const existing=this.entries.find(e=>e.id===entry.id);
    if(existing){if(existing.threadId!==entry.threadId)throw new Error('消息编号冲突');return existing;}
    if(this.list(entry.threadId).length>=20)throw new Error('每个任务最多排队 20 条消息');
    const item:Followup={...entry,order:Math.max(-1,...this.entries.map(e=>e.order??0))+1,status:'queued',createdAt:new Date().toISOString()};this.entries.push(item);this.save(item);return item;
  }
  edit(id:string,threadId:string,text:string){const e=this.mutable(id,threadId);e.text=text;this.save(e);return e;}
  move(id:string,threadId:string,direction:'up'|'down'){
    const entry=this.mutable(id,threadId);
    const rows=this.entries.filter(e=>e.threadId===threadId&&e.status!=='sent'&&e.status!=='editing');
    const index=rows.indexOf(entry),other=rows[index+(direction==='up'?-1:1)];
    if(!other)return;
    if(other.status==='sending')throw new Error('不能跨过正在发送的消息');
    const a={...entry,order:other.order},b={...other,order:entry.order};
    this.store.writeFollowupOrder([a,b]);
    entry.order=a.order;other.order=b.order;
    this.entries.sort((a,b)=>a.order!-b.order!);
  }
  cancel(id:string,threadId:string){this.mutable(id,threadId);this.entries=this.entries.filter(e=>e.id!==id);this.store.removeFollowup(id);}
  retry(id:string,threadId:string){const e=this.mutable(id,threadId);e.status='queued';e.error=undefined;e.resume=true;this.retryAfter.delete(id);this.save(e);}
  async steer(id:string,threadId:string,desktopTurnId?:string){
    const e=this.mutable(id,threadId);if(this.busy.has(threadId))throw new Error('任务正在提交消息，请稍后重试');
    if(e.mode==='plan'||e.fast===true)throw new Error('此消息指定了计划或速度模式，请等待下一轮发送；引导不能改变当前轮模式');
    this.busy.add(threadId);e.status='sending';this.save(e);
    try{await this.sessions.steer(threadId,e.text,e.images,e.files,desktopTurnId);e.status='sent';e.error=undefined;}
    catch(error){
      const message=userFacingError(error);
      const uncertain=submissionFailureKind(error)==='uncertain';
      e.status=uncertain?'failed':'queued';e.error=uncertain?'引导结果待确认，请检查会话后再重试。'+message:message;throw error;
    }
    finally{this.save(e);this.busy.delete(threadId);}
  }
  private mutable(id:string,threadId:string){const e=this.entries.find(e=>e.id===id&&e.threadId===threadId);if(!e||e.status==='sent')throw new Error('消息已发送或取消');if(e.status==='editing')throw new Error('消息已取回编辑，请继续恢复草稿');if(e.status==='sending')throw new Error('消息正在发送，不能修改');return e;}
  private save(e:Followup){this.store.writeFollowup(e.id,e);}
  private async tick(){
    // A slow status RPC for one conversation must not serialize other queues.
    await Promise.all([...new Set(this.entries.filter(e=>e.status==='queued').map(e=>e.threadId))].map(id=>this.processThread(id)));
  }
  private async processThread(id:string){
      if(this.busy.has(id)||this.checking.has(id))return;
      const head=this.entries.find(e=>e.threadId===id&&e.status!=='sent'&&e.status!=='editing');
      if(!head||head.status!=='queued'||(this.retryAfter.get(head.id)??0)>Date.now())return;
      // Status inspection is not a submission lock. An explicit steer can be
      // accepted while this read is outstanding; recheck the queue afterwards.
      this.checking.add(id);
      let status:string;
      try{status=await this.status(id);}catch{return;}finally{this.checking.delete(id);}
      if(this.busy.has(id))return;
      this.busy.add(id);
      try{
        const e=this.entries.find(e=>e.threadId===id&&e.status!=='sent'&&e.status!=='editing');
        if(status==='running'&&!e?.resume)return;
        if(!e||e.status!=='queued'||(this.retryAfter.get(e.id)??0)>Date.now())return;
        if(!e.resume&&['error','interrupted','stopped'].includes(status)){e.status='failed';e.error='上一轮未正常完成，队列已暂停';this.save(e);return;}
        e.status='sending';this.save(e);
        try{await this.send(e);e.status='sent';e.error=undefined;}
        catch(error){
          e.status=isWriterOccupied(error)?'queued':'failed';e.error=userFacingError(error);
          if(e.status==='queued'){e.resume=true;this.retryAfter.set(e.id,Date.now()+10000);}
        }
        this.save(e);
      }catch{/* A failed status lookup must never be treated as an idle task. */}
      finally{this.busy.delete(id);}
  }
}
