import type {GatewayEvent} from '../types.js';

export type ChannelKind='qq'|'weixin';
export type ChannelAccount={id:string;channel:ChannelKind;label:string};
export type ChannelBinding={id:string;accountId:string;chatId:string;senderId:string;threadId:string};
// Identity must come from the authenticated platform event, never from message text.
export type ChannelMessage={id:string;chatId:string;senderId:string;text:string};
export type ChannelOutput={binding:ChannelBinding;event:Extract<GatewayEvent,{type:'message.delta'|'turn.started'|'turn.completed'|'goal.completed'|'error'}>};
export type ChannelReceipt={requestId:string;state:string;threadId?:string;error?:string};
export interface ChannelTaskPort {
  validateThread(threadId:string):Promise<void>;
  submit(input:{requestId:string;threadId?:string;projectPath?:string;text:string}):Promise<ChannelReceipt|undefined>;
  validateProject?(projectPath:string):Promise<void>;
  prepareWorkspace?(requestId:string,previousThreadId?:string):Promise<string>;
  requiresNewThread?(threadId:string):Promise<boolean>;
  receipt(requestId:string):Promise<ChannelReceipt|undefined>;
  status?(threadId:string):Promise<string>;
  result?(threadId:string):Promise<string>;
  interrupt?(threadId:string,requestId:string):Promise<void>;
}
export interface ChannelConnection {
  // The driver owns platform-specific buffering, reply context, limits and delivery receipts.
  onEvent(output:ChannelOutput):void;
  close():Promise<void>;
}
export interface ChannelDriver {
  kind:ChannelKind;
  state?(accountId:string):Record<string,unknown>;
  configure?(accountId:string,value:unknown):Promise<void>;
  login?(accountId:string,verifyCode?:string):Promise<Record<string,unknown>>;
  forget?(accountId:string):void;
  // Resolve only after platform authentication and event subscription succeed.
  // Credentials and QR flows belong to the driver, not to the generic account DTO.
  connect(context:{account:ChannelAccount;signal:AbortSignal;receive:(message:ChannelMessage)=>Promise<ChannelReceipt|undefined>;failed:()=>void}):Promise<ChannelConnection>;
}
