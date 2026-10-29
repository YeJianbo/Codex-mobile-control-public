import {zcodeNativeSessions,type ZcodeNativeSession} from './zcodeNativeSessions.js';
import {withZcodeRuntime,type RuntimeOperation} from './zcodeRuntime.js';

type Inspection={thread:ZcodeNativeSession['thread'];threadId:string;status:string;running:boolean;canArchive:boolean;subagent:NonNullable<ZcodeNativeSession['thread']['subagent']>};
const nativeStatus=(status:string):ZcodeNativeSession['thread']['status']=>['running','waiting','blocked'].includes(status)?'running':['success','completed'].includes(status)?'completed':['cancelled','interrupted','lost'].includes(status)?'interrupted':['failed','error'].includes(status)?'error':'idle';
export class ZcodeSubagents{
  constructor(private runtime:RuntimeOperation=withZcodeRuntime){}
  private async family(threadId:string){
    const rows=await zcodeNativeSessions.list(),child=rows.find(row=>row.thread.id===threadId);
    const parent=rows.find(row=>row.thread.id===child?.thread.subagent?.parentThreadId);
    if(!child?.thread.subagent||!parent)throw Error('ZCode 子代理或所属会话不存在');
    return {child,parent};
  }
  async tree(threadId:string){
    const rows=await zcodeNativeSessions.list(),ids=new Set([threadId]);
    for(let size=-1;size!==ids.size;){size=ids.size;for(const row of rows)if(row.thread.subagent?.parentThreadId&&ids.has(row.thread.subagent.parentThreadId))ids.add(row.thread.id);}
    return rows.filter(row=>ids.has(row.thread.id)).map(row=>row.thread);
  }
  async preview(threadId:string){
    const inspections=await Promise.all((await this.tree(threadId)).map(row=>this.inspect(row.id)));
    const root=inspections.find(row=>row.threadId===threadId);if(!root)throw Error('ZCode 子代理不存在');
    return {...root,running:inspections.some(row=>row.running),canArchive:inspections.every(row=>row.canArchive)};
  }
  async stopTree(threadId:string){
    for(const row of (await this.tree(threadId)).reverse())if((await this.inspect(row.id)).running)await this.stop(row.id);
  }
  async inspect(threadId:string):Promise<Inspection>{
    const {child,parent}=await this.family(threadId);
    const live=await this.runtime(parent.thread.projectPath!,async request=>{
      const snapshot=await request('session/subagents',{sessionId:parent.sessionId,endedLimit:100});
      const running=snapshot.running?.find((row:any)=>row.childSessionId===child.sessionId);
      const ended=snapshot.ended?.items?.find((row:any)=>row.childSessionId===child.sessionId);
      if(running||ended)return nativeStatus((running||ended).status);
      // Foreground child sessions need not have a persisted launch acknowledgement.
      try{return (await request('session/read',{sessionId:child.sessionId,contentProfile:'index'})).projection?.status as string|undefined;}
      catch(error){if((error as any).code===-32004)return undefined;throw error;}
    }).catch(error=>{if([-32004,-32010].includes(error.code))return null;throw error;});
    const status=live||child.thread.status,running=['running','waiting','blocked'].includes(status);
    return {thread:{...child.thread,status:nativeStatus(status)},threadId,status,running,canArchive:!running,subagent:child.thread.subagent!};
  }
  async stop(threadId:string){
    const {child,parent}=await this.family(threadId);
    const stopped=await this.runtime(parent.thread.projectPath!,async request=>{
      const snapshot=await request('session/subagents',{sessionId:parent.sessionId,endedLimit:100});
      const running=snapshot.running?.find((row:any)=>row.childSessionId===child.sessionId);
      if(!running&&snapshot.ended?.items?.some((row:any)=>row.childSessionId===child.sessionId))return true;
      if(running?.agentId){
        const result=await request('session/cancelBackgroundTask',{sessionId:parent.sessionId,taskId:running.agentId});
        if(result.cancelled||['completed','failed','cancelled'].includes(result.status))return true;
      }
      // This RPC always targets the child. It must never fall back to session/stop(parent).
      await request('session/read',{sessionId:child.sessionId,contentProfile:'index'});
      await request('session/stop',{sessionId:child.sessionId});return true;
    });
    if(!stopped)throw Error('该子代理仍在旧 ZCode 后端运行，请先在 ZCode 中停止');
  }
}
export const zcodeSubagents=new ZcodeSubagents();
