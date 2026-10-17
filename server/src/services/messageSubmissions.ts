import type {GatewayEvent} from '../types.js';
import type {CommandReceipts} from './commandReceipts.js';

type Receipt={state:'processing'|'accepted'|'failed'|'unknown'|'uncertain';threadId?:string;error?:string;retryAllowed?:boolean};
type Submission={command:string;receipt:Receipt};

export class MessageSubmissions {
  private readonly entries=new Map<string,Submission>();
  hasProcessing(){return [...this.entries.values()].some(entry=>entry.receipt.state==='processing');}
  begin(id:string,command:unknown,threadId?:string):boolean {
    const serialized=JSON.stringify(command);
    const previous=this.entries.get(id);
    if(previous){
      if(previous.command!==serialized)throw Error('发送请求已用于另一条消息，请重新提交');
      return false;
    }
    this.entries.set(id,{command:serialized,receipt:{state:'processing',threadId}});
    // Keep in-flight work; old terminal receipts can be recovered from stored events.
    if(this.entries.size>500)for(const [key,value] of this.entries){if(value.receipt.state!=='processing'){this.entries.delete(key);break;}}
    return true;
  }
  finish(id:string,receipt:Omit<Receipt,'state'>&{state:'accepted'|'failed'}){
    const entry=this.entries.get(id);if(entry)entry.receipt=receipt;
  }
  status(id:string,events:GatewayEvent[],threadId?:string):Receipt {
    const accepted=events.slice().reverse().find(event=>event.requestId===id&&event.type==='user.message');
    if(accepted&&'threadId' in accepted&&(!threadId||threadId===accepted.threadId))return {state:'accepted',threadId:accepted.threadId};
    const receipt=this.entries.get(id)?.receipt;
    if(receipt&&(!threadId||!receipt.threadId||threadId===receipt.threadId))return {...receipt};
    return {state:'unknown'};
  }
  // Codex has one durable execution ledger. This facade retains the existing
  // mobile confirmation protocol and the in-memory path for other agents.
  async persistentStatus(id:string,events:GatewayEvent[],receipts:CommandReceipts,threadId?:string):Promise<Receipt>{
    const stored=this.status(id,events,threadId);
    if(stored.state==='accepted')return stored;
    const receipt=await receipts.get(id);
    if(receipt&&(!threadId||!receipt.threadId||threadId===receipt.threadId))return {state:receipt.state==='starting'?'processing':receipt.state,threadId:receipt.threadId,error:receipt.error,retryAllowed:receipt.retryAllowed};
    return stored;
  }
}
