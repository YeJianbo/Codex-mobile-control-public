import {SubmissionFailure,submissionFailureKind,isWriterOccupied,type SubmissionFailureKind} from './submissionErrors.js';
import {ReceiptStore} from './receiptStore.js';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {appHome} from './paths.js';

export type CommandReceipt={requestId:string;fingerprint:string;type:string;state:'starting'|'accepted'|'failed'|'uncertain';threadId?:string;model?:string;effort?:string;updatedAt:string;error?:string;failureKind?:SubmissionFailureKind;queued?:boolean;retryAllowed?:boolean;replacement?:{removedTurnId:string;headTurnId:string;imageInputs?:unknown[];filePrefix?:string}};
export class SubmissionNotStartedError extends SubmissionFailure {
  constructor(error:unknown){super('not_started',error instanceof Error?error.message:String(error),{cause:error});this.name='SubmissionNotStartedError';}
}
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
export class CommandReceipts {
  private rows=new Map<string,CommandReceipt>();
  private active=new Map<string,Promise<CommandReceipt>>();
  private loaded?:Promise<void>;
  private readonly store:ReceiptStore;
  hasProcessing(){return this.active.size>0;}
  constructor(private file=path.join(appHome(),'command-receipts.json')){this.store=new ReceiptStore(file);}
  private load(){return this.loaded??=this.store.open();}
  private trimRows(keep:string){for(const id of this.rows.keys()){if(this.rows.size<=512)break;if(id!==keep&&!this.active.has(id))this.rows.delete(id);}}
  private row(id:string){const cached=this.rows.get(id);if(cached)return cached;const row=this.store.get(id);if(row){this.rows.set(id,row);this.trimRows(id);}return row;}
  private async save(row:CommandReceipt){
    this.store.put(row);
    // Active receipts retain object identity while parallel callers await their result.
    this.trimRows(row.requestId);
  }
  private canRetry(row:CommandReceipt){return row.state==='failed'&&(row.retryAllowed===true||row.failureKind==='writer_occupied'||!row.failureKind&&isWriterOccupied(row.error));}
  async list(){await this.load();return this.store.list().map(({fingerprint,...row})=>row);}
  async get(id:string){await this.load();const row=this.row(id);return row?{...row,fingerprint:undefined,retryAllowed:this.canRetry(row)}:undefined;}
  async markQueued(id:string,threadId:string){await this.load();const row=this.row(id);if(row?.state==='failed'&&(row.failureKind==='writer_occupied'||!row.failureKind&&isWriterOccupied(row.error))){row.state='accepted';row.queued=true;row.threadId=threadId;row.error=undefined;row.failureKind=undefined;await this.save(row);}}
  async noteThread(id:string|undefined,threadId:string){if(!id)return;await this.load();const row=this.row(id);if(row){row.threadId=threadId;row.updatedAt=new Date().toISOString();await this.save(row);}}
  async noteReplacement(id:string,replacement:NonNullable<CommandReceipt['replacement']>){await this.load();const row=this.row(id);if(row){row.replacement=replacement;row.updatedAt=new Date().toISOString();await this.save(row);}}
  async exportJson(file=this.file){await this.load();if(this.hasProcessing())throw new Error('消息正在提交，完成后再导出记录');await this.store.exportJson(file);}
  close(){this.store.close();this.loaded=undefined;this.rows.clear();}
  async run(command:{requestId?:string;type:string;model?:string;effort?:string;threadId?:string},work:()=>Promise<void>,replay:(receipt:CommandReceipt)=>void,consumeQueued=false,effective?:{model?:string;effort?:string}):Promise<void>{
    if(!command.requestId){await work();return;}
    if(command.requestId.length>160)throw new Error('请求 ID 过长。');
    await this.load();
    const {requestId,...payload}=command;
    let fingerprint=createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
    const previous=this.row(requestId);
    let knownThread=previous?.threadId;
    if(previous){
      if(consumeQueued&&previous.queued)fingerprint=previous.fingerprint;
      if(previous.fingerprint!==fingerprint)throw new Error('请求 ID 已用于不同内容，请使用新的请求 ID。');
      const receipt=await (this.active.get(requestId)||Promise.resolve(previous));
      if(receipt.state==='accepted'&&!(consumeQueued&&receipt.queued)){replay(receipt);return;}
      if(!(consumeQueued&&receipt.queued)&&!this.canRetry(receipt))throw new SubmissionFailure(receipt.failureKind??'uncertain',receipt.error||'提交结果尚未确认，请先查看会话状态。');
      // Only the internal queue consumer can execute an accepted queued message.
      if(this.row(requestId)!==receipt)return this.run(command,work,replay,consumeQueued,effective);
      this.rows.delete(requestId);knownThread=receipt.threadId;
    }
    const receipt:CommandReceipt={requestId,fingerprint,type:command.type,state:'starting',threadId:knownThread||command.threadId,model:effective?.model??command.model,effort:effective?.effort??command.effort,updatedAt:new Date().toISOString(),replacement:previous?.replacement};
    this.rows.set(requestId,receipt);
    const running=(async()=>{
      try{await this.save(receipt);}catch(error){this.rows.delete(requestId);throw error;}
      try{await work();receipt.state='accepted';}
      catch(error){
        receipt.failureKind=submissionFailureKind(error);
        if(receipt.failureKind==='not_started'){receipt.state='failed';receipt.retryAllowed=true;}
        else receipt.state=receipt.failureKind==='uncertain'||command.type==='thread.start'&&!!receipt.threadId&&receipt.failureKind!=='writer_occupied'?'uncertain':'failed';
        if(receipt.state==='uncertain')receipt.failureKind='uncertain';
        receipt.error=String(error instanceof Error?error.message:error);
      }
      receipt.updatedAt=new Date().toISOString();await this.save(receipt);return receipt;
    })();
    this.active.set(requestId,running);
    try{const completed=await running;if(completed.state!=='accepted')throw new SubmissionFailure(completed.failureKind??'failed',completed.error||'提交失败');}
    finally{if(this.active.get(requestId)===running)this.active.delete(requestId);}
  }
}
