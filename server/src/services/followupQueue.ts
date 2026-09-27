import type {StateStore} from './stateStore.js';
import type {SessionManager} from './sessionManager.js';
import type {ImageAttachment} from './imageUploads.js';
import type {FileAttachment} from './fileUploads.js';
import {isWriterOccupied,userFacingError} from './userFacingError.js';

export type Followup = {id:string;threadId:string;text:string;images:ImageAttachment[];files:FileAttachment[];model?:string;effort?:string;permission?:'ask'|'auto'|'full'|'custom';sourcePublic?:boolean;createdAt:string;status:'queued'|'sending'|'failed'|'sent';error?:string;resume?:boolean};
export class FollowupQueue {
  private entries:Followup[];
  private busy=new Set<string>();
  private retryAfter=new Map<string,number>();
  private timer:NodeJS.Timeout;
  constructor(private store:StateStore,private sessions:SessionManager,
    private status:(id:string)=>Promise<string>,private send:(entry:Followup)=>Promise<void>) {
    this.entries=store.readFollowups() as Followup[];
    for(const entry of this.entries)entry.files??=[];
    for(const entry of this.entries)if(entry.status==='sending'){entry.status='failed';entry.error='连接中断，发送结果待确认，请检查任务后重试';this.save(entry);}
    this.timer=setInterval(()=>void this.tick(),1500);this.timer.unref();
  }
  close(){clearInterval(this.timer);}
  list(threadId:string){return this.entries.filter(e=>e.threadId===threadId&&e.status!=='sent').map(e=>({...e,canSteer:this.sessions.canSteer(threadId)}));}
  add(entry:Omit<Followup,'status'|'createdAt'>){
    const existing=this.entries.find(e=>e.id===entry.id);
    if(existing){if(existing.threadId!==entry.threadId)throw new Error('消息编号冲突');return existing;}
    if(this.list(entry.threadId).length>=20)throw new Error('每个任务最多排队 20 条消息');
    const item:Followup={...entry,status:'queued',createdAt:new Date().toISOString()};this.entries.push(item);this.save(item);return item;
  }
  edit(id:string,threadId:string,text:string){const e=this.mutable(id,threadId);e.text=text;this.save(e);return e;}
  cancel(id:string,threadId:string){this.mutable(id,threadId);this.entries=this.entries.filter(e=>e.id!==id);this.store.removeFollowup(id);}
  retry(id:string,threadId:string){const e=this.mutable(id,threadId);e.status='queued';e.error=undefined;e.resume=true;this.retryAfter.delete(id);this.save(e);}
  async steer(id:string,threadId:string,desktopTurnId?:string){
    const e=this.mutable(id,threadId);if(this.busy.has(threadId))throw new Error('任务正在提交消息，请稍后重试');
    this.busy.add(threadId);e.status='sending';this.save(e);
    try{await this.sessions.steer(threadId,e.text,e.images,e.files,desktopTurnId);e.status='sent';e.error=undefined;}
    catch(error){e.status='queued';e.error=userFacingError(error);throw error;}
    finally{this.save(e);this.busy.delete(threadId);}
  }
  private mutable(id:string,threadId:string){const e=this.entries.find(e=>e.id===id&&e.threadId===threadId);if(!e||e.status==='sent')throw new Error('消息已发送或取消');if(e.status==='sending')throw new Error('消息正在发送，不能修改');return e;}
  private save(e:Followup){this.store.writeFollowup(e.id,e);}
  private async tick(){
    for(const id of new Set(this.entries.filter(e=>e.status==='queued').map(e=>e.threadId))){
      if(this.busy.has(id))continue;this.busy.add(id);
      try{
        const status=await this.status(id);
        const e=this.entries.find(e=>e.threadId===id&&e.status!=='sent');
        if(status==='running'&&!e?.resume)continue;
        if(!e||e.status!=='queued'||(this.retryAfter.get(e.id)??0)>Date.now())continue;
        if(!e.resume&&['error','interrupted','stopped'].includes(status)){e.status='failed';e.error='上一轮未正常完成，队列已暂停';this.save(e);continue;}
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
}
