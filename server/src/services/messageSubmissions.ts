import type {GatewayEvent} from '../types.js';
import type {CommandReceipts} from './commandReceipts.js';

export type SubmissionStatus={state:'processing'|'accepted'|'failed'|'unknown'|'uncertain';threadId?:string;error?:string;retryAllowed?:boolean};

// A protocol view of the execution ledger, not a second submission state machine.
export async function readSubmissionStatus(id:string,events:GatewayEvent[],receipts:CommandReceipts,threadId?:string):Promise<SubmissionStatus>{
  for(let i=events.length-1;i>=0;i--){
    const event=events[i];
    if(event.requestId===id&&event.type==='user.message'&&(!threadId||threadId===event.threadId))return {state:'accepted',threadId:event.threadId};
  }
  const receipt=await receipts.get(id);
  if(receipt&&(!threadId||!receipt.threadId||threadId===receipt.threadId))return {state:receipt.state==='starting'?'processing':receipt.state,threadId:receipt.threadId,error:receipt.error,retryAllowed:receipt.retryAllowed};
  return {state:'unknown'};
}
