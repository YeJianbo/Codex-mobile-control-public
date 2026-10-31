import type {Writable} from 'node:stream';

export type AcpDispatch={phase:'written'|'not_started'|'uncertain';error?:unknown;session?:string;actualModel?:string};
type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void;timer?:NodeJS.Timeout};

// A successful write means only that Node accepted the bytes, not that the model replied.
export function attemptAcpPrompt(stdin:Writable|undefined,id:number,params:unknown,pending:Map<number,Pending>,label:string){
  let resolve!:(value:any)=>void,reject!:(error:Error)=>void;
  const request=new Promise<any>((res,rej)=>{resolve=res;reject=rej;});
  pending.set(id,{resolve,reject});
  let payload:string;
  try{payload=JSON.stringify({jsonrpc:'2.0',id,method:'session/prompt',params})+'\n';}
  catch(error){pending.delete(id);reject(Error(`${label} 消息无法序列化`));return {request,phase:'not_started' as const,error};}
  if(!stdin?.writable){pending.delete(id);const error=Error(`${label} 标准输入不可写，任务未发送`);reject(error);return {request,phase:'not_started' as const,error};}
  try{stdin.write(payload);}catch(error){pending.delete(id);reject(Error(`${label} 写入任务失败`));return {request,phase:'uncertain' as const,error};}
  return {request,phase:'written' as const};
}

export function createAcpDispatch(){
  let resolve!:(value:AcpDispatch)=>void,settled=false;
  const promise=new Promise<AcpDispatch>(r=>{resolve=r;});
  return {promise,settle(value:AcpDispatch){if(!settled){settled=true;resolve(value);}}};
}
