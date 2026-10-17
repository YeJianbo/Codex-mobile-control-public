import {isWriterOccupied} from './userFacingError.js';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {appHome} from './paths.js';

export type CommandReceipt={requestId:string;fingerprint:string;type:string;state:'starting'|'accepted'|'failed'|'uncertain';threadId?:string;model?:string;effort?:string;updatedAt:string;error?:string;queued?:boolean;retryAllowed?:boolean;replacement?:{removedTurnId:string;headTurnId:string;imageInputs?:unknown[];filePrefix?:string}};
export class SubmissionNotStartedError extends Error {
  constructor(error:unknown){super(error instanceof Error?error.message:String(error));this.name='SubmissionNotStartedError';}
}
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
export class CommandReceipts {
  private rows=new Map<string,CommandReceipt>();
  private active=new Map<string,Promise<CommandReceipt>>();
  private loaded?:Promise<void>;
  private writing=Promise.resolve();
  hasProcessing(){return this.active.size>0;}
  constructor(private file=path.join(appHome(),'command-receipts.json')){}
  private load(){return this.loaded??=fs.readFile(this.file,'utf8').then(raw=>{for(const row of JSON.parse(raw) as CommandReceipt[]){if(row.state==='starting'){row.state='uncertain';row.error='连接中断，提交结果尚未确认。请查看会话后再决定是否重试，系统不会重复启动。';}this.rows.set(row.requestId,row);}}).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  private save(){const contents=JSON.stringify([...this.rows.values()]);const operation=this.writing.then(async()=>{await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(this.file+'.tmp',contents,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);});this.writing=operation.catch(()=>{});return operation;}
  async list(){await this.load();return [...this.rows.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,200).map(({fingerprint,...row})=>row);}
  async get(id:string){await this.load();const row=this.rows.get(id);return row?{...row,fingerprint:undefined,retryAllowed:row.state==='failed'&&(row.retryAllowed===true||isWriterOccupied(row.error))}:undefined;}
  async markQueued(id:string,threadId:string){await this.load();const row=this.rows.get(id);if(row?.state==='failed'&&isWriterOccupied(row.error)){row.state='accepted';row.queued=true;row.threadId=threadId;row.error=undefined;await this.save();}}
  async noteThread(id:string|undefined,threadId:string){if(!id)return;const row=this.rows.get(id);if(row){row.threadId=threadId;row.updatedAt=new Date().toISOString();await this.save();}}
  async noteReplacement(id:string,replacement:NonNullable<CommandReceipt['replacement']>){const row=this.rows.get(id);if(row){row.replacement=replacement;row.updatedAt=new Date().toISOString();await this.save();}}
  async run(command:{requestId?:string;type:string;model?:string;effort?:string;threadId?:string},work:()=>Promise<void>,replay:(receipt:CommandReceipt)=>void,consumeQueued=false,effective?:{model?:string;effort?:string}):Promise<void>{
    if(!command.requestId){await work();return;}
    if(command.requestId.length>160)throw new Error('请求 ID 过长。');
    await this.load();
    const {requestId,...payload}=command;
    let fingerprint=createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
    const previous=this.rows.get(requestId);
    let knownThread=previous?.threadId;
    if(previous){
      if(consumeQueued&&previous.queued)fingerprint=previous.fingerprint;
      if(previous.fingerprint!==fingerprint)throw new Error('请求 ID 已用于不同内容，请使用新的请求 ID。');
      const receipt=await (this.active.get(requestId)||Promise.resolve(previous));
      if(receipt.state==='accepted'&&!(consumeQueued&&receipt.queued)){replay(receipt);return;}
      if(!(consumeQueued&&receipt.queued)&&!(receipt.state==='failed'&&(receipt.retryAllowed===true||isWriterOccupied(receipt.error))))throw new Error(receipt.error||'提交结果尚未确认，请先查看会话状态。');
      // Only the internal queue consumer can execute an accepted queued message.
      if(this.rows.get(requestId)!==receipt)return this.run(command,work,replay,consumeQueued,effective);
      this.rows.delete(requestId);knownThread=receipt.threadId;
    }
    if(this.rows.size>=10000)throw new Error('提交记录已达上限，请先整理记录，系统不会忽略重复请求保护。');
    const receipt:CommandReceipt={requestId,fingerprint,type:command.type,state:'starting',threadId:knownThread||command.threadId,model:effective?.model??command.model,effort:effective?.effort??command.effort,updatedAt:new Date().toISOString(),replacement:previous?.replacement};
    this.rows.set(requestId,receipt);
    const running=(async()=>{
      try{await this.save();}catch(error){this.rows.delete(requestId);throw error;}
      try{await work();receipt.state='accepted';}
      catch(error){
        if(error instanceof SubmissionNotStartedError){receipt.state='failed';receipt.retryAllowed=true;}
        else receipt.state=/timeout|timed out|EPIPE|ECONNRESET|ETIMEDOUT|broken pipe|超时|退出|closed|disconnect|断开|连接中断|已关闭|结果待确认/i.test(String(error))||command.type==='thread.start'&&!!receipt.threadId&&!isWriterOccupied(error)?'uncertain':'failed';
        receipt.error=String(error instanceof Error?error.message:error);
      }
      receipt.updatedAt=new Date().toISOString();await this.save();return receipt;
    })();
    this.active.set(requestId,running);
    try{const completed=await running;if(completed.state!=='accepted')throw new Error(completed.error||'提交失败');}
    finally{if(this.active.get(requestId)===running)this.active.delete(requestId);}
  }
}
