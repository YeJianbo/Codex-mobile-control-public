import type {FastifyInstance,FastifyReply} from 'fastify';
import {z} from 'zod';
import {LocalConsoleClient} from './localConsole.js';

type Data=Record<string,unknown>;
type AssistantTransport=Pick<LocalConsoleClient,'managementRequest'>;
const object=(value:unknown):Data=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Data:{};
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const identifier=z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const params=z.object({id:identifier}).strict();
const create=z.object({requestId:identifier,text:z.string().trim().min(1).max(32000),projectPath:z.string().trim().min(1).max(4096),executor:z.string().min(1).max(100),model:z.string().min(1).max(200),effort:z.string().max(50).optional()}).strict();
const followup=z.object({requestId:identifier,text:z.string().trim().min(1).max(32000)}).strict();
const approvalId=z.string().min(1).max(300);
const approve=z.union([
  z.object({approvalId,decision:z.enum(['accept','decline'])}).strict(),
  z.object({approvalId,answers:z.record(z.string().min(1).max(200),z.object({answers:z.array(z.string().max(16000)).min(1).max(100)}).strict()).refine(value=>Object.keys(value).length>0&&Object.keys(value).length<=100)}).strict(),
]);
const empty=z.object({}).strict();

function pick(value:unknown,keys:readonly string[]):Data{
  const source=object(value);
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(source,key)).map(key=>[key,source[key]]));
}
const taskKeys=['id','title','text','projectPath','requestId','executor','harness','model','effort','createdAt','state','threadId','error','executionStatus','waitingApproval','lastFollowupId','lastFollowupText'] as const;
const eventKeys=['id','eventId','seq','type','at','timestamp','createdAt','threadId','turnId','itemId','text','textComplete','message','output','detail','title','status','role','toolId','name','arguments','result','command','commandId','cwd','shell','stream','pid','exitCode','error','truncated','stopped','requestId','approvalId','approvalType','description','decision','content','files','images','attachments','diff','summary','fileChanges','questionReplies','willRetry','activitySummary','activityCount','timeUsedSeconds'] as const;
const approvalKeys=['id','threadId','status','approvalType','title','detail','command','description','questions','createdAt'] as const;

/** Project envelopes explicitly; task content retains nested command/file/approval payloads. */
export function mobileAssistantDetail(raw:unknown):Data{
  const value=object(raw),history=object(value.history);
  return {
    task:pick(value.task,taskKeys),receiptMissing:value.receiptMissing===true,
    history:value.history==null?null:{...pick(history,['status','threadId','error']),events:array(history.events).map(event=>pick(event,eventKeys)),unconfirmedCommands:array(history.unconfirmedCommands).map(command=>pick(command,['toolId','pid','command','cwd','shell','type','status','text']))},
    approvals:array(value.approvals).map(item=>pick(item,approvalKeys)),
  };
}
export function mobileAssistantCatalog(raw:unknown):Data{
  const value=object(raw);
  return {models:array(value.models).map(model=>({...pick(model,['executor','harness','model','displayName','available','unavailableReason','defaultReasoningEffort']),supportedReasoningEfforts:array(object(model).supportedReasoningEfforts).map(level=>pick(level,['reasoningEffort','description']))})),backends:array(value.backends).map(backend=>pick(backend,['executor','agent','name','installed','available','reason','transport'])),errors:array(value.errors).map(error=>pick(error,['executor','message'])),defaultModel:value.defaultModel==null?null:pick(value.defaultModel,['executor','model'])};
}
async function respond(reply:FastifyReply,operation:()=>Promise<Data>){
  try{return await operation();}
  catch(error){
    if(error instanceof z.ZodError)return reply.code(400).send({error:'任务参数无效，请检查模型、工作目录或审批内容'});
    const failure=error as {status?:number;statusCode?:number;message?:string};
    const status=failure.status??failure.statusCode??502;
    return reply.code(status>=400&&status<=599?status:502).send({error:failure.message||'个人助理暂时不可用，请刷新任务状态'});
  }
}

export function registerMobileAssistant(app:FastifyInstance,client:AssistantTransport=new LocalConsoleClient()){
  const local='/api/personal-assistant',mobile='/api/mobile-management/assistant';
  app.get(mobile+'/catalog',async(_request,reply)=>respond(reply,async()=>mobileAssistantCatalog(await client.managementRequest(local+'/catalog',undefined,65000))));
  app.get(mobile+'/projects',async(_request,reply)=>respond(reply,async()=>{
    const raw=await client.managementRequest(local+'/projects');
    return {projects:array(raw.projects).map(project=>pick(project,['id','name','path','cwd','trusted']))};
  }));
  app.get(mobile+'/tasks',async(_request,reply)=>respond(reply,async()=>{
    const raw=await client.managementRequest(local+'/tasks');
    return {tasks:array(raw.tasks).map(task=>pick(task,taskKeys)),capabilities:pick(raw.capabilities,['execution','browser','windowsApps'])};
  }));
  app.get(mobile+'/tasks/:id',async(request,reply)=>respond(reply,async()=>{
    const {id}=params.parse(request.params);
    return mobileAssistantDetail(await client.managementRequest(local+'/tasks/'+encodeURIComponent(id)));
  }));
  app.post(mobile+'/tasks',{bodyLimit:256*1024},async(request,reply)=>respond(reply,async()=>mobileAssistantDetail(await client.managementRequest(local+'/tasks',create.parse(request.body),65000))));
  app.post(mobile+'/tasks/:id/continue',{bodyLimit:256*1024},async(request,reply)=>respond(reply,async()=>{
    const {id}=params.parse(request.params);
    return mobileAssistantDetail(await client.managementRequest(local+'/tasks/'+encodeURIComponent(id)+'/continue',followup.parse(request.body),65000));
  }));
  app.post(mobile+'/tasks/:id/stop',async(request,reply)=>respond(reply,async()=>{
    const {id}=params.parse(request.params);empty.parse(request.body);
    const raw=await client.managementRequest(local+'/tasks/'+encodeURIComponent(id)+'/stop',{},65000);
    // Acknowledged transport is not proof that an old command has exited.
    return {...pick(raw,['status','message','stopped','interrupted','requestId']),ok:raw.ok===true};
  }));
  app.post(mobile+'/tasks/:id/approve',{bodyLimit:2*1024*1024},async(request,reply)=>respond(reply,async()=>{
    const {id}=params.parse(request.params);
    const raw=await client.managementRequest(local+'/tasks/'+encodeURIComponent(id)+'/approve',approve.parse(request.body),65000);
    return pick(raw,['ok','status','message','decision','answered','resolved']);
  }));
}
