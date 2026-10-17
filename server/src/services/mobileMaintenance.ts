import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {LocalConsoleClient} from './localConsole.js';

type Data=Record<string,any>;
const object=(value:unknown):Data=>value&&typeof value==='object'&&!Array.isArray(value)?value as Data:{};
const rows=(value:unknown,limit=500):Data[]=>Array.isArray(value)?value.slice(0,limit).map(object):[];
const num=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const text=(value:unknown,max=2000):string|null=>typeof value==='string'?value.slice(0,max):null;
const safeText=(value:unknown,max=2000):string|null=>text(value,max)?.replace(/Bearer\s+\S+/gi,'Bearer <REDACTED>').replace(/\b(?:sk|sess)-[\w-]+/g,'<REDACTED>').replace(/\b[A-Za-z]:[\\/][^\r\n;"<>]*/g,'<LOCAL_PATH>')??null;
const apps=['claude','claude-desktop','gemini','codex','grokbuild','opencode','openclaw','hermes','pi','mcode'] as const;
const switchApps=['claude','claude-desktop','gemini','opencode'] as const;
const empty=z.object({}).strict();
const planId=z.string().uuid();
const backupId=z.string().regex(/^\d+-[a-f0-9]+$/).max(100);
const profileId=z.string().trim().min(1).max(160).refine(value=>!/[\r\n\0]/.test(value));
const confirmed=z.literal(true);
const destination=z.string().trim().max(2048).url().refine(value=>{
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}
},'接收地址必须是无凭据和查询参数的 HTTPS 地址');

function operation(value:unknown){
  const item=object(value);
  if(!item.id&&!item.state)return null;
  return {id:text(item.id,160),action:text(item.action,30),state:text(item.state,30),at:text(item.at,100),completedAt:text(item.completedAt,100),started:item.started===true,error:safeText(item.error,500)};
}
function backupRows(value:unknown){return rows(value,2000).map(item=>({id:text(item.id,100),kind:text(item.kind,30),at:text(item.at,100)}));}
function maintenanceState(raw:Data){
  const config=object(raw.config),gateway=object(raw.gateway),backend=object(raw.sharedBackend);
  return {
    // These two paths are intentionally shown in the configuration/recovery UI.
    home:text(raw.home,4096),config:{catalog:text(config.catalog,4096),provider:text(config.provider,200),model:text(config.model,500),owned:config.owned===true,nativeCatalog:config.nativeCatalog===true,relayOnly:config.relayOnly===true,officialHttp:config.officialHttp===true,officialLocal:config.officialLocal===true,officialEndpointOverride:config.officialEndpointOverride===true},
    port:num(raw.port),memoryMB:num(raw.memoryMB),startedAt:text(object(raw.metrics).startedAt,100),
    gateway:{running:gateway.running===true,autoStart:gateway.autoStart===true,origin:safeOrigin(gateway.origin)},
    sharedBackend:{running:backend.running===true,backendPid:num(backend.backendPid),startedAt:text(backend.startedAt,100),catalogReloadPending:backend.catalogReloadPending===true,operation:operation(backend.operation)},
    processOperation:operation(raw.processOperation),backups:backupRows(raw.backups),
    events:rows(raw.events,30).map(item=>({at:text(item.at,100),status:safeText(item.status,100),code:safeText(item.code,100),count:num(item.count)})),
  };
}
function safeOrigin(value:unknown){
  if(typeof value!=='string')return null;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.origin:null;}catch{return null;}
}
function diagnosis(raw:Data,includePids=true){
  return {
    at:text(raw.at,100),checks:rows(raw.checks,100).map(item=>({code:safeText(item.code,100),status:['ok','warning','error'].includes(item.status)?item.status:'warning',title:safeText(item.title,200),detail:safeText(item.detail,2000),repair:safeText(item.repair,100)})),
    processes:rows(raw.processes,300).map(item=>({...(includePids?{id:num(item.id)}:{}),name:safeText(item.name,200),memoryMB:num(item.memoryMB)})),
    summary:{errors:num(object(raw.summary).errors),warnings:num(object(raw.summary).warnings)},
    runtime:{platform:safeText(object(raw.runtime).platform,100),node:safeText(object(raw.runtime).node,100),memoryMB:num(object(raw.runtime).memoryMB)},
    localRequests:{requests:num(object(raw.localRequests).requests),errors:num(object(raw.localRequests).errors)},
  };
}
function report(raw:Data){
  return {schemaVersion:1,...diagnosis(raw,false),
    gatewayEvents:rows(raw.gatewayEvents,50).map(item=>({time:text(item.time,100),level:safeText(item.level,30),method:safeText(item.method,20),endpoint:safeText(item.endpoint,300),status:num(item.status),durationMs:num(item.durationMs)})),
    modelEvents:rows(raw.modelEvents,20).map(item=>({at:text(item.at,100),status:safeText(item.status,100),code:safeText(item.code,100),count:num(item.count)})),
    scope:'Local diagnostics and operational event summaries; no credentials or conversation bodies',
  };
}
function results(raw:Data){return {results:rows(raw.results,2000).map(item=>({id:typeof item.id==='number'?num(item.id):text(item.id,160),ok:item.ok===true,skipped:item.skipped===true,bytes:num(item.bytes),error:safeText(item.error,500)})),freedBytes:num(raw.freedBytes)};}
function profile(value:unknown){const item=object(value);return {id:text(item.id,160),name:safeText(item.name,200),category:text(item.category,40),source:safeText(item.source,100),editable:item.editable===true,selectedInCCSwitch:item.selectedInCCSwitch===true};}
function harnesses(raw:Data){
  const rawApps=object(raw.apps),desktop=object(raw.desktop);
  return {sourceAvailable:raw.sourceAvailable===true,apps:Object.fromEntries(apps.map(app=>{
    const item=object(rawApps[app]);
    return [app,{profiles:rows(item.profiles).map(profile),activeId:text(item.activeId,160),external:item.external===true,managed:switchApps.includes(app as typeof switchApps[number])&&item.managed===true}];
  })),desktop:{mode:text(desktop.mode,30),providerId:text(desktop.providerId,160),profileApplied:desktop.profileApplied===true}};
}
function switchPreview(raw:Data){return {app:text(raw.app,40),id:text(raw.id,160),label:safeText(raw.label,200),planId:text(raw.planId,100),canSwitch:raw.canSwitch!==false,message:safeText(raw.message,1000),from:profile(raw.from),to:profile(raw.to),blockingCount:rows(raw.blockingThreads).length};}
function backendPreview(raw:Data){return {planId:text(raw.planId,100),canRestart:raw.canRestart===true,running:raw.running===true,restarted:raw.restarted===true,blockingThreads:rows(raw.blockingThreads,300).map(item=>({name:safeText(item.name,200),status:safeText(item.status,40)})),catalogReloadPending:raw.catalogReloadPending===true,desktopRunning:raw.desktopRunning===true,desktopRestarted:raw.desktopRestarted===true,restartScope:raw.restartScope==='desktop-and-cli'?'desktop-and-cli':'cli-only'};}
function openCodeState(raw:Data){
  return {app:'opencode',installed:raw.installed===true,configured:raw.configured===true,writable:raw.writable===true,model:text(raw.model,500)??'',smallModel:text(raw.smallModel,500)??'',error:safeText(raw.error,1000),
    file:text(raw.file,4096),files:rows(raw.files,20).map(item=>({path:text(item.path,4096),exists:item.exists===true})),warnings:Array.isArray(raw.warnings)?raw.warnings.slice(0,30).map((value:unknown)=>safeText(value,1000)):[],
    providers:rows(raw.providers,500).map(item=>({id:text(item.id,160),name:safeText(item.name,200),npm:text(item.npm,200),baseUrl:safeUrl(item.baseUrl),hasKey:item.hasKey===true,keySource:['auth','config','reference','none'].includes(item.keySource)?item.keySource:'none',authType:['api','oauth'].includes(item.authType)?item.authType:'none',enabled:item.enabled===true,
      models:rows(item.models,500).map(model=>({id:text(model.id,256),name:safeText(model.name,200),...(num(model.context)!==null?{context:num(model.context)}:{}),...(num(model.output)!==null?{output:num(model.output)}:{})}))})),
    accounts:rows(raw.accounts,500).map(item=>({providerId:text(item.providerId,160),type:item.type==='oauth'?'oauth':'api',hasKey:item.hasKey===true,...(num(item.expiresAt)!==null?{expiresAt:num(item.expiresAt)}:{})})),
    profiles:rows(raw.profiles,500).map(item=>({id:text(item.id,160),name:safeText(item.name,200),source:safeText(item.source,100),active:item.active===true})),
  };
}
function safeUrl(value:unknown){if(typeof value!=='string'||!value)return '';try{const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';return url.toString().replace(/\/$/,'');}catch{return '';}}
function openCodePreview(raw:Data){return {planId:text(raw.planId,100),canSwitch:raw.canSwitch===true,message:safeText(raw.message,1000),blockingCount:num(raw.blockingCount)??rows(raw.blockingThreads).length,changes:rows(raw.changes,100).map(item=>({title:safeText(item.title,200),detail:safeText(item.detail,2000)}))};}

type LocalPlan={kind:'restore';id:string;at:string|null;expires:number}|{kind:'send';destination:string;expires:number};
/** Fixed local-console operations only. Credentials and raw config files never cross this API. */
export function registerMobileMaintenance(app:FastifyInstance,client=new LocalConsoleClient()){
  const plans=new Map<string,LocalPlan>();
  const savePlan=(value:Omit<Extract<LocalPlan,{kind:'restore'}>,'expires'>|Omit<Extract<LocalPlan,{kind:'send'}>,'expires'>)=>{
    for(const [id,item]of plans)if(item.expires<Date.now())plans.delete(id);
    if(plans.size>=100)plans.delete(plans.keys().next().value!);
    const id=randomUUID();plans.set(id,{...value,expires:Date.now()+300000});return id;
  };
  const consume=(id:string,kind:LocalPlan['kind'])=>{
    const item=plans.get(id);if(!item||item.kind!==kind||item.expires<Date.now())throw Object.assign(new Error('预览已过期，请重新预览'),{status:409});
    plans.delete(id);return item;
  };
  const respond=async(reply:FastifyReply,work:()=>Promise<Data>)=>{
    reply.header('Cache-Control','no-store');
    try{return await work();}catch(error){
      if(error instanceof z.ZodError)return reply.code(400).send({error:'请求参数无效，请检查输入后重试'});
      const item=error as {status?:number;message?:string};
      return reply.code([409,503].includes(item.status??0)?item.status!:502).send({error:safeText(item.message,500)||'电脑维护操作失败，请刷新后重试'});
    }
  };
  const get=(suffix:string,work:()=>Promise<Data>)=>app.get('/api/mobile-management/'+suffix,async(request,reply)=>respond(reply,async()=>{empty.parse(request.query);return work();}));
  const post=<S extends z.ZodType>(suffix:string,schema:S,work:(body:z.output<S>,request:FastifyRequest)=>Promise<Data>)=>app.post('/api/mobile-management/'+suffix,async(request,reply)=>respond(reply,async()=>{empty.parse(request.query);return work(schema.parse(request.body),request);}));
  const local=(route:string,body?:Data)=>client.managementRequest('/api/'+route,body,route==='backend/restart'?135000:65000);

  get('maintenance',async()=>maintenanceState(await local('state')));
  post('maintenance/diagnose',empty,async()=>diagnosis(await local('maintenance/diagnose',{})));
  post('maintenance/repair-preview',empty,async()=>{
    const raw=await local('maintenance/repair-preview',{});
    return {planId:text(raw.planId,100),actions:rows(raw.actions,100).map(item=>({id:text(item.id,100),title:safeText(item.title,200),detail:safeText(item.detail,2000)}))};
  });
  post('maintenance/repair',z.object({planId,confirmed}).strict(),async body=>results(await local('maintenance/repair',{planId:body.planId})));
  get('maintenance/report',async()=>report(await local('maintenance/report')));
  post('maintenance/send-preview',z.object({destination}).strict(),async body=>({planId:savePlan({kind:'send',destination:body.destination}),destination:body.destination,report:report(await local('maintenance/report'))}));
  post('maintenance/send',z.object({planId,confirmed}).strict(),async body=>{
    const plan=consume(body.planId,'send');if(plan.kind!=='send')throw new Error('诊断发送预览无效');
    const raw=await local('maintenance/send',{destination:plan.destination});return {sent:raw.sent===true,status:num(raw.status)};
  });
  post('maintenance/backup',empty,async()=>({id:text((await local('backup',{})).id,100)}));
  post('maintenance/restore-preview',z.object({id:backupId}).strict(),async body=>{
    const raw=await local('state'),backup=backupRows(raw.backups).find(item=>item.id===body.id&&item.kind==='config');
    if(!backup)throw Object.assign(new Error('所选配置备份已不存在，请刷新'),{status:409});
    return {planId:savePlan({kind:'restore',id:body.id,at:backup.at}),backup,currentProvider:text(object(raw.config).provider,200),message:'使用此备份覆盖当前 Codex 配置；执行前会自动备份当前版本。改变会话入口的备份需先在中转配置中完成会话迁移。'};
  });
  post('maintenance/restore',z.object({planId,confirmed}).strict(),async body=>{
    const plan=consume(body.planId,'restore');if(plan.kind!=='restore')throw new Error('恢复预览无效');
    const current=backupRows((await local('state')).backups).find(item=>item.id===plan.id&&item.kind==='config'&&item.at===plan.at);
    if(!current)throw Object.assign(new Error('所选配置备份已变化，请重新预览'),{status:409});
    const raw=await local('restore',{id:plan.id});return {restored:text(raw.restored,100),undo:text(raw.undo,100)};
  });
  post('maintenance/cleanup-preview',z.object({keep:z.number().int().min(2).max(100).default(5),days:z.number().int().min(1).max(365).default(7)}).strict(),async body=>{
    const raw=await local('maintenance/cleanup-preview',body);
    return {planId:text(raw.planId,100),keep:num(raw.keep),days:num(raw.days),totalBytes:num(raw.totalBytes),files:rows(raw.files,2000).map(item=>({id:num(item.id),name:safeText(item.name,300),group:safeText(item.group,100),bytes:num(item.bytes),at:text(item.at,100)}))};
  });
  post('maintenance/cleanup',z.object({planId,selected:z.array(z.number().int().min(0).max(100000)).min(1).max(2000),confirmed}).strict(),async body=>results(await local('maintenance/cleanup',{planId:body.planId,selected:body.selected})));
  post('maintenance/process-preview',z.object({action:z.enum(['stop','restart'])}).strict(),async body=>{
    const raw=await local('maintenance/process-preview',body);return {planId:text(raw.planId,100),action:text(raw.action,30),canStart:raw.canStart===true,targets:rows(raw.targets,300).map(item=>({id:num(item.id),name:safeText(item.name,200),memoryMB:num(item.memoryMB)}))};
  });
  post('maintenance/process-apply',z.object({planId,allowActive:z.literal(true),confirmed}).strict(),async body=>{
    const raw=await local('maintenance/process-apply',{planId:body.planId,allowActive:true});return {accepted:raw.accepted===true,id:text(raw.id,100),action:text(raw.action,30)};
  });
  post('maintenance/gateway/start',empty,async()=>{await local('gateway/start',{});return {started:true};});
  post('maintenance/gateway/autostart',z.object({enabled:z.boolean()}).strict(),async body=>({enabled:(await local('gateway/autostart',body)).enabled===true}));
  post('maintenance/backend/restart-preview',empty,async()=>backendPreview(await local('backend/restart-preview',{})));
  post('maintenance/backend/restart',z.object({planId,confirmed}).strict(),async body=>backendPreview(await local('backend/restart',{planId:body.planId})));

  get('extensions',async()=>{
    const raw=await local('extensions');
    return {mcp:rows(raw.mcp,500).map(item=>({id:text(item.id,160),enabled:item.enabled===true,type:text(item.type,40),target:safeText(item.target,300)})),skills:rows(raw.skills,500).map(item=>({name:safeText(item.name,200),description:safeText(item.description,3000)}))};
  });
  post('extensions/mcp',z.object({id:z.string().regex(/^[\w-]+$/).max(160),enabled:z.boolean()}).strict(),async body=>({backup:text((await local('mcp',body)).backup,100),enabled:body.enabled}));
  get('harnesses',async()=>harnesses(await local('harnesses')));
  get('opencode',async()=>openCodeState(await local('opencode')));
  const openCodeProvider=z.object({providerId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).max(160),name:z.string().trim().min(1).max(200),npm:z.string().trim().max(200),baseUrl:z.string().max(2048),apiKey:z.string().max(32768).optional(),enabled:z.boolean(),models:z.array(z.object({id:z.string().trim().min(1).max(256),name:z.string().max(200).optional(),context:z.number().int().min(1).max(20000000).optional(),output:z.number().int().min(1).max(20000000).optional()}).strict()).min(1).max(500)}).strict();
  post('opencode/provider-preview',openCodeProvider,async body=>openCodePreview(await local('opencode/provider-preview',body)));
  post('opencode/model-preview',z.object({model:z.string().trim().min(1).max(500),smallModel:z.string().max(500).optional()}).strict(),async body=>openCodePreview(await local('opencode/model-preview',body)));
  for(const kind of ['provider','model'])post('opencode/'+kind+'-apply',z.object({planId,confirmed}).strict(),async body=>{
    const raw=await local('opencode/'+kind+'-apply',body);return {app:'opencode',saved:raw.saved===true,changed:raw.changed===true,message:safeText(raw.message,1000)};
  });
  post('harnesses/switch-preview',z.object({app:z.enum(switchApps),id:profileId}).strict(),async body=>switchPreview(await local('harnesses/switch-preview',body)));
  post('harnesses/switch',z.object({app:z.enum(switchApps),id:profileId,planId,confirmed}).strict(),async body=>{
    const raw=await local('harnesses/switch',{app:body.app,id:body.id,planId:body.planId});
    return {app:text(raw.app,40),id:text(raw.id,160),name:safeText(raw.name,200),changed:raw.changed===true,message:safeText(raw.message,1000)};
  });
}
