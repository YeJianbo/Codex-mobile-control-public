import {randomUUID} from 'node:crypto';
import {filePrompt,resolveFiles,type FileAttachment} from './fileUploads.js';
import {resolveImageFiles,type ImageAttachment} from './imageUploads.js';
import {SubmissionFailure} from './submissionErrors.js';
import {zcodeNativeSessions,type ZcodeNativeSession} from './zcodeNativeSessions.js';
import {withZcodeRuntime,type RuntimeOperation} from './zcodeRuntime.js';

type FindSession=(threadId:string)=>Promise<ZcodeNativeSession|undefined>;
const findSession:FindSession=async id=>(await zcodeNativeSessions.list()).find(row=>row.thread.id===id);

export class ZcodeDesktopSteer {
  constructor(private runtime:RuntimeOperation=withZcodeRuntime,private find:FindSession=findSession){}
  private async session(id:string){
    const session=await this.find(id);
    return session?.thread.projectPath?session:undefined;
  }
  private async running(request:(method:string,params:Record<string,unknown>)=>Promise<any>,session:ZcodeNativeSession){
    const snapshot=await request('session/read',{sessionId:session.sessionId,contentProfile:'index'});
    const projection=snapshot?.projection;
    return projection?.sessionId===session.sessionId&&['running','waiting','blocked'].includes(projection.status)&&!!projection.currentTurnId;
  }
  async canSteer(id:string){
    const session=await this.session(id);if(!session)return false;
    return await this.runtime(session.thread.projectPath!,request=>this.running(request,session)).catch(()=>false)===true;
  }
  async steer(id:string,text:string,images:ImageAttachment[]=[],files:FileAttachment[]=[]){
    const session=await this.session(id);
    if(!session)throw Error('找不到 ZCode 会话，消息仍保留在队列中');
    const [resolvedFiles,resolvedImages]=await Promise.all([resolveFiles(files),resolveImageFiles(images)]);
    const prompt=text+filePrompt(resolvedFiles);
    if(!prompt.trim()&&!resolvedImages.length)throw Error('引导消息不能为空');
    const sent=await this.runtime(session.thread.projectPath!,async request=>{
      if(!await this.running(request,session))throw Error('当前 ZCode 轮次不可引导，消息仍保留在队列中');
      let result:any;
      try{
        result=await request('v4/command',{commandId:randomUUID(),clientId:'codex-mobile-control',sessionId:session.sessionId,type:'sendText',issuedAt:Date.now(),payload:{text:prompt,requestedDelivery:'guide',inputOrigin:'mobile',...(resolvedImages.length?{attachments:resolvedImages.map(image=>({type:'image',path:image.absolutePath,mimeType:image.mime,name:image.name}))}:{})}});
      }catch(error){
        throw new SubmissionFailure('uncertain','ZCode 引导结果待确认，请检查会话后再重试',{cause:error});
      }
      if(!['accepted','duplicate'].includes(result?.status))throw Error(result?.message||`ZCode 未接受引导消息（${result?.reasonCode||result?.status||'未知状态'}）`);
      return true;
    });
    if(!sent)throw Error('ZCode 共享后端不可用，消息仍保留在队列中');
  }
}
export const zcodeDesktopSteer=new ZcodeDesktopSteer();
