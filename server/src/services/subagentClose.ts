import type {ThreadRecord} from '../types.js';

type Inspection={thread:ThreadRecord;running:boolean;canArchive:boolean};
type CloseOperations={
  request:(method:string,params:unknown)=>Promise<unknown>;
  list:()=>Promise<ThreadRecord[]>;
  inspect:(id:string)=>Promise<Inspection>;
  saveClosed:(threads:ThreadRecord[])=>void;
};

export function subagentCanArchive(status:string,running:boolean):boolean {
  return !running&&['idle','notLoaded','systemError'].includes(status);
}

export function isCrossVolumeArchiveError(error:unknown):boolean {
  const message=error instanceof Error?error.message:String(error);
  return /failed to archive (?:session|thread)/i.test(message)&&
    /\bEXDEV\b|os error 17\b|cross-device|different disk drive/i.test(message)&&
    !/failed to restore|failed to update.*metadata/i.test(message);
}

// The native archive remains authoritative. A cross-volume rename failure can
// only fall back to closing this gateway's view, with an explicit restore marker.
export async function archiveOrCloseSubagent(root:ThreadRecord,operations:CloseOperations):Promise<{archived:boolean;closed:true;closureKind?:'gatewayClosed';closedThreadIds?:string[]}>{
  try{
    await operations.request('thread/archive',{threadId:root.id});
    return {archived:true,closed:true};
  }catch(error){
    if(!isCrossVolumeArchiveError(error))throw error;
  }
  const rows=await operations.list(),tree=new Map([[root.id,root]]);
  let added=true;
  while(added){
    added=false;
    for(const row of rows){
      if(!tree.has(row.id)&&row.subagent?.parentThreadId&&tree.has(row.subagent.parentThreadId)){
        tree.set(row.id,row);added=true;
      }
    }
  }
  const inspect=async()=>{
    const checked:ThreadRecord[]=[];
    for(const expected of tree.values()){
      const current=await operations.inspect(expected.id);
      if(!expected.subagent?.parentThreadId||current.thread.readOnly||
        current.thread.subagent?.parentThreadId!==expected.subagent.parentThreadId||current.running||!current.canArchive)
        throw Error('子代理状态已改变，尚未关闭，请刷新后重试');
      checked.push(current.thread);
    }
    // Do not hide newly spawned descendants that missed the status checks.
    const latest=await operations.list();
    if(latest.some(row=>!tree.has(row.id)&&row.subagent?.parentThreadId&&tree.has(row.subagent.parentThreadId)))
      throw Error('子代理列表已改变，尚未关闭，请刷新后重试');
    return checked;
  };
  await inspect();
  for(const row of tree.values())await operations.request('thread/unsubscribe',{threadId:row.id});
  const checked=await inspect();
  operations.saveClosed(checked);
  return {archived:false,closed:true,closureKind:'gatewayClosed',closedThreadIds:checked.map(row=>row.id)};
}
