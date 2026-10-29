import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import {agyNativeFields} from './agyGenerationUsage.js';

export type AgyTurnCursor={session:string;file:string;step:number;executor:number};
export function readAgyTurnCursor(session?:string):AgyTurnCursor|undefined{
  if(!session||!/^[a-zA-Z0-9_-]{1,100}$/.test(session))return;
  for(const name of ['antigravity-cli','antigravity']){
    const file=path.join(process.env.USERPROFILE||os.homedir(),'.gemini',name,'conversations',session+'.db');
    let db:DatabaseSync|undefined;
    try{
      db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA busy_timeout=100');
      const row=db.prepare('SELECT (SELECT MAX(idx) FROM steps) step,(SELECT MAX(idx) FROM executor_metadata) executor').get() as {step:number|null;executor:number|null};
      return {session,file,step:row.step??-1,executor:row.executor??-1};
    }catch{/* Native state is optional; without it the CLI result remains authoritative. */}
    finally{db?.close();}
  }
}
function nested(bytes:unknown,field:number):Buffer|undefined{
  if(!(bytes instanceof Uint8Array))return;
  const value=agyNativeFields(bytes).get(field);return Buffer.isBuffer(value)?value:undefined;
}
// A recovered transport attempt can survive in result.error, just like an old
// ERROR_MESSAGE. Neither overrides a matching, successful native executor.
function recoveredTransportError(message:string):boolean{
  return /^API error \(attempt \d+\): request failed:/i.test(message)&&
    /(?:tls: bad record MAC|\bEOF\b|connection reset by peer|TLS handshake timeout)/i.test(message);
}
export function reconcileAgyTurnResult(result:any,before?:AgyTurnCursor,streamed?:ReadonlyMap<string,string>):any{
  if(result?.status!=='ERROR'||!before||result.conversation_id!==before.session||typeof result.error!=='string')return result;
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(before.file,{readOnly:true});db.exec('PRAGMA busy_timeout=100; BEGIN');
    const user=db.prepare('SELECT MAX(idx) idx FROM steps WHERE step_type=14').get() as {idx:number|null};
    const last=db.prepare('SELECT idx,step_type,status,step_payload FROM steps ORDER BY idx DESC LIMIT 1').get() as {idx:number;step_type:number;status:number;step_payload:Uint8Array}|undefined;
    const executor=db.prepare('SELECT idx,data FROM executor_metadata ORDER BY idx DESC LIMIT 1').get() as {idx:number;data:Uint8Array}|undefined;
    if(user.idx===null||user.idx<=before.step||!last||last.idx<=user.idx||last.step_type!==15||last.status!==3||!executor||executor.idx<=before.executor)return result;
    const state=agyNativeFields(executor.data);
    // ExecutorMetadata: 1=termination_reason (4=NO_TOOL_CALL), 3=last_step_idx,
    // 12=execution_error. These fields are verified against the CLI descriptors.
    if(state.get(1)!==4||state.get(3)!==last.idx||state.has(12))return result;
    const response=nested(nested(last.step_payload,20),1)?.toString('utf8');
    if(!response)return result;
    const resultMatches=typeof result.response==='string'&&response.trimEnd()===result.response.trimEnd();
    // Some AGY versions return only a stale transport error even after delivering
    // the complete answer. Match that turn's streamed final step to native state.
    const streamedMatches=recoveredTransportError(result.error)&&response.trimEnd()===streamed?.get(String(last.idx))?.trimEnd();
    if(!resultMatches&&!streamedMatches)return result;
    const errors=db.prepare('SELECT idx,step_payload FROM steps WHERE step_type=17 ORDER BY idx DESC').iterate() as Iterable<{idx:number;step_payload:Uint8Array}>;
    let historical=false;
    for(const error of errors){
      // A later error, or an unrecovered business error in this turn, wins.
      if(error.idx>last.idx)return result;
      const details=nested(nested(error.step_payload,24),3);
      const message=(nested(details,1)||nested(details,2))?.toString('utf8');
      if(error.idx>before.step){if(!message||!recoveredTransportError(message))return result;}
      else if(message===result.error)historical=true;
    }
    if(!historical&&!recoveredTransportError(result.error))return result;
    const {error,...completed}=result;
    return {...completed,status:'SUCCESS',response:resultMatches?result.response:response};
  }catch{return result;}
  finally{db?.close();}
}
