import type {FastifyInstance,FastifyReply} from 'fastify';
import {z} from 'zod';
import type {ChannelService} from '../channels/service.js';
import {LocalConsoleClient} from './localConsole.js';

type Data=Record<string,any>;
type ManagementClient=Pick<LocalConsoleClient,'managementRequest'>;
const object=(value:unknown):Data=>value&&typeof value==='object'&&!Array.isArray(value)?value as Data:{};
const rows=(value:unknown):Data[]=>Array.isArray(value)?value.map(object):[];
const text=(value:unknown,max=2000)=>typeof value==='string'?value.slice(0,max):'';
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const ids=z.array(z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/)).min(1).max(30).transform(value=>[...new Set(value)]);
const source=z.enum(['interactive','subagent']).default('interactive');
const empty=z.object({}).strict();

function session(value:unknown){
  const row=object(value);
  return {id:text(row.id,100),title:text(row.title),cwd:text(row.cwd),createdAt:number(row.createdAt),updatedAt:number(row.updatedAt),
    status:text(row.status,80),activity:text(row.activity,80),archived:row.archived===true,pinned:row.pinned===true,
    isSubagent:row.isSubagent===true,agentRole:text(row.agentRole,200),logBytes:number(row.logBytes),selected:row.selected===true,
    ...(typeof row.canDelete==='boolean'?{canDelete:row.canDelete}:{}),...(row.reason?{reason:text(row.reason)}:{})};
}

function channelState(service:ChannelService){
  const raw=service.state();
  return {channels:raw.channels.map(row=>({kind:row.kind,available:row.available})),accounts:raw.accounts.map(account=>{
    const details=object(account.details);
    return {id:account.id,channel:account.channel,label:account.label,projectPath:account.projectPath,state:account.state,
      bindingCount:raw.bindings.filter(binding=>binding.accountId===account.id).length,
      details:{configured:details.configured===true,appId:text(details.appId,30),ownerId:text(details.ownerId,512),
        transport:text(details.transport,80),lastError:text(details.lastError,1000)}};
  })};
}

const channelMessages=new Set(['通道账号不存在','此通道的平台驱动尚未接入','此通道不使用手动凭据','此通道不支持扫码','请先断开通道',
  '请先断开当前通道再连接','项目配置暂不可用','请先扫码登录微信','微信未返回登录二维码','微信登录响应缺少凭据','微信返回的服务地址无效']);
async function respond(reply:FastifyReply,operation:()=>Promise<unknown>){
  try{return await operation();}catch(error){
    if(error instanceof z.ZodError)return reply.code(400).send({error:'请检查所填内容和选中的项目'});
    const value=object(error),message=error instanceof Error?error.message:'';
    // Drivers and credentials never cross this boundary as raw exceptions.
    if(channelMessages.has(message))return reply.code(409).send({error:message});
    if(typeof value.status==='number'&&value.status>=400&&value.status<=599)return reply.code(value.status).send({error:message||'电脑管理服务暂不可用'});
    return reply.code(409).send({error:'操作未完成，请刷新状态并检查电脑上的配置'});
  }
}

/** Fixed, paired-device operations; this module does not expose a local HTTP proxy. */
export function registerMobileSessionsChannels(app:FastifyInstance,options:{client?:ManagementClient;channels?:ChannelService}={}){
  const client=options.client??new LocalConsoleClient();
  const requireChannels=()=>{if(!options.channels)throw Object.assign(Error('消息通道服务暂不可用'),{status:503});return options.channels;};
  app.get('/api/mobile-management/sessions',async(request,reply)=>respond(reply,async()=>{
    const query=z.object({archived:z.enum(['true','false']).default('false'),search:z.string().max(200).default(''),source,
      cursor:z.string().max(8192).optional(),cwd:z.string().max(2000).default(''),olderThanDays:z.coerce.number().min(0).max(36500).default(0),
      minBytes:z.coerce.number().min(0).max(1e12).default(0),onlyIdle:z.enum(['true','false']).default('false')}).strict().parse(request.query);
    const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined)params.set(key,String(value));
    const raw=await client.managementRequest('/api/sessions?'+params.toString(),undefined,60000);
    return {threads:rows(raw.threads).map(session),nextCursor:typeof raw.nextCursor==='string'?raw.nextCursor.slice(0,8192):null,
      projects:Array.isArray(raw.projects)?raw.projects.filter((value:unknown)=>typeof value==='string').map((value:string)=>value.slice(0,2000)):[],
      pageLogBytes:number(raw.pageLogBytes),unknownSizes:number(raw.unknownSizes)??0};
  }));
  app.post('/api/mobile-management/sessions/delete-preview',async(request,reply)=>respond(reply,async()=>{
    const body=z.object({ids,source}).strict().parse(request.body);
    const raw=await client.managementRequest('/api/sessions/delete-preview',body,120000);
    return {threads:rows(raw.threads).map(session),affected:rows(raw.affected).map(session),planId:text(raw.planId,100)||null,
      logBytes:number(raw.logBytes),unknownSizes:number(raw.unknownSizes)??0};
  }));
  app.post('/api/mobile-management/sessions/change',async(request,reply)=>respond(reply,async()=>{
    const body=z.object({ids,source,action:z.enum(['archive','restore','delete']),planId:z.string().uuid().optional()}).strict()
      .refine(value=>value.action!=='delete'||!!value.planId,{message:'请先预览删除范围'}).parse(request.body);
    const raw=await client.managementRequest('/api/sessions/change',body,120000);
    return {completed:number(raw.completed)??0,affectedCount:number(raw.affectedCount),results:rows(raw.results).map(row=>({id:text(row.id,100),ok:row.ok===true,error:text(row.error)}))};
  }));

  app.get('/api/mobile-management/channels',async(request,reply)=>respond(reply,async()=>{
    empty.parse(request.query);return channelState(requireChannels());
  }));
  app.post('/api/mobile-management/channels/accounts',async(request,reply)=>respond(reply,async()=>{
    const body=z.object({channel:z.enum(['qq','weixin']),label:z.string().trim().min(1).max(80)}).strict().parse(request.body);
    const channels=requireChannels(),account=channels.store.addAccount(body.channel,body.label);
    return {account:channelState(channels).accounts.find(row=>row.id===account.id)};
  }));
  app.post('/api/mobile-management/channels/accounts/:id/:action',async(request,reply)=>respond(reply,async()=>{
    const params=z.object({id:z.string().trim().min(1).max(512),action:z.enum(['settings','credentials','login','connect','disconnect','remove'])}).strict().parse(request.params);
    const channels=requireChannels();
    if(params.action==='settings'){
      const body=z.object({projectPath:z.string().trim().min(1).max(2048)}).strict().parse(request.body);
      await channels.setProject(params.id,body.projectPath);
    }else if(params.action==='credentials'){
      const body=z.object({appId:z.string().trim().regex(/^\d{4,30}$/),appSecret:z.string().trim().min(8).max(512)}).strict().parse(request.body);
      if(channels.store.account(params.id)?.channel!=='qq')return reply.code(400).send({error:'此通道不使用手动凭据'});
      await channels.configure(params.id,body);
    }else if(params.action==='login'){
      const body=z.object({verifyCode:z.string().trim().max(40).optional(),refresh:z.boolean().optional()}).strict().parse(request.body??{});
      const raw=await channels.login(params.id,body.verifyCode,body.refresh);
      return {status:text(raw.status,80),expiresAt:number(raw.expiresAt),
        qrImage:typeof raw.qrImage==='string'&&/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(raw.qrImage)&&raw.qrImage.length<=512*1024?raw.qrImage:''};
    }else if(params.action==='remove'){
      z.object({confirm:z.literal(true)}).strict().parse(request.body);await channels.remove(params.id);
    }else{
      empty.parse(request.body??{});if(params.action==='connect')channels.begin(params.id);else await channels.stop(params.id);
    }
    return channelState(channels);
  }));
}
