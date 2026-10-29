import type {FastifyInstance} from 'fastify';
import {z} from 'zod';

const sources=['codex','agy','claude','zcode','grok','hermes','deepseek','opencode'] as const;
type Source=typeof sources[number];
type Data=Record<string,any>;
const object=(value:unknown):Data=>value&&typeof value==='object'&&!Array.isArray(value)?value as Data:{};
const rows=(value:unknown):Data[]=>Array.isArray(value)?value.map(object):[];
const num=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const text=(value:unknown):string|null=>typeof value==='string'?value.slice(0,500):null;
const count=(value:unknown)=>num(value)??0;

class ConsoleError extends Error {
  constructor(readonly status:number,message:string){super(message);}
}

// The console's process token stays on the gateway. Only fixed loopback routes
// and explicit response fields cross the existing paired-device boundary.
export class LocalConsoleClient {
  private token:string|null=null;
  private tokenAt=0;
  private readonly origin:string;
  constructor(private readonly fetchImpl:typeof fetch=fetch,port=Number(process.env.LOCAL_CONSOLE_PORT||25819)){
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Web 管理端口无效');
    this.origin=`http://127.0.0.1:${port}`;
  }
  private async fetchLocal(route:string,init:RequestInit,timeout:number){
    try{
      const response=await this.fetchImpl(this.origin+route,{...init,redirect:'error',signal:AbortSignal.timeout(timeout)});
      const body=await response.text();
      if(body.length>8*1024*1024)throw new ConsoleError(502,'电脑控制台响应过大，请缩小统计范围');
      return {response,body};
    }catch(error){
      if(error instanceof ConsoleError)throw error;
      throw new ConsoleError(503,'Web 管理后台暂不可用，请检查电脑上的后台服务');
    }
  }
  private async processToken(){
    if(this.token&&Date.now()-this.tokenAt<60000)return this.token;
    const {response,body}=await this.fetchLocal('/',{method:'GET'},5000);
    const token=/<meta\s+name=["']local-token["']\s+content=["']([a-f0-9]{64})["']/i.exec(body)?.[1];
    if(!response.ok||!token)throw new ConsoleError(503,'无法连接电脑控制台，请在电脑上重新打开控制台');
    this.token=token;this.tokenAt=Date.now();return token;
  }
  private async request(route:string,body?:Data,timeout?:number):Promise<Data>{
    for(let attempt=0;attempt<2;attempt++){
      const token=await this.processToken();
      const result=await this.fetchLocal(route,{method:body?'POST':'GET',headers:{'x-local-token':token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},timeout??(body?45000:15000));
      if(result.response.status===403&&attempt===0){this.token=null;continue;}
      if(!result.response.ok){
        const safeErrors=['模型未启用','中转模式不使用官方模型','模型不存在','启停状态无效','请至少保留一个当前模式可用的模型','此路由需要连接工作台，请确认后保存'];
        let message='电脑控制台操作失败，请在电脑控制台检查状态后重试';
        try{const error=JSON.parse(result.body).error;if(safeErrors.includes(error))message=error;
          if((route.startsWith('/api/account/')||route.startsWith('/api/agy/accounts')||route.startsWith('/api/claude-accounts')||route.startsWith('/api/harnesses/')||route.startsWith('/api/model-accounts')||route.startsWith('/api/providers/')||route.startsWith('/api/opencode/'))&&typeof error==='string'){
            if(/仍有.*(?:会话|任务).*运行|正在运行.*(?:会话|任务)/.test(error))message='仍有任务正在运行，请结束后重试';
            else if(/预览.*过期|重新预览|状态.*变化|配置.*变化/.test(error))message=route.startsWith('/api/opencode/')?'OpenCode 配置已变化，请重新预览':'账号状态已变化，请重新预览';
            else if(/账号不存在|账户不存在|配置不存在/.test(error))message='所选账号或配置已不存在，请刷新';
            else if(/未找到.*安装|助手未安装/.test(error))message='电脑上未找到该助手安装';
            else if(/(?:API Key|密钥).*(?:填写|需要|格式|缺少)|(?:填写|需要|缺少).*(?:API Key|密钥)/.test(error))message='请检查 API Key；更换供应商或服务地址时需要填写新密钥';
            else if(/服务地址|模型 ID|供应商|模型不存在/.test(error))message='请检查服务地址、供应商和模型配置';
            else if(/授权|登录|凭据/.test(error))message='账号授权不可用，请在电脑检查登录状态';
          }
          if(route.startsWith('/api/backend/')&&typeof error==='string'){
            if(/仍有 \d+ 个会话正在运行/.test(error))message='仍有会话正在运行，请结束后重试';
            else if(/共享后端正在重启/.test(error))message='共享后端正在重启，请稍后重试';
            else if(/共享后端未运行/.test(error))message='共享后端未运行，请先打开电脑上的 Codex';
            else if(/预览已过期|重新预览|共享后端已.*变化|共享后端已重启/.test(error))message='共享后端状态已变化，请重新检查';
            else if(/等待共享后端恢复超时/.test(error))message='等待共享后端恢复超时，请重新检查连接';
          }
        }catch{}
        throw new ConsoleError(result.response.status>=500?502:409,message);
      }
      try{return object(JSON.parse(result.body));}catch{throw new ConsoleError(502,'电脑控制台返回了无效数据');}
    }
    throw new ConsoleError(503,'电脑控制台认证已失效，请重新打开控制台');
  }
  // Server modules supply fixed local routes and apply their own response
  // projection. This method is never registered as a general proxy endpoint.
  async managementRequest(route:string,body?:Data,timeout?:number):Promise<Data>{
    let path:string;
    try{path=decodeURIComponent(route.split('?')[0]!);}catch{throw new ConsoleError(400,'无效的管理请求地址');}
    if(!route.startsWith('/api/')||route.includes('#')||path.includes('\\')||/(^|\/)\.{1,2}(\/|$)/.test(path))throw new ConsoleError(400,'无效的管理请求地址');
    return this.request(route,body,timeout);
  }
  async state(){
    const raw=await this.request('/api/state');
    if(!Array.isArray(raw.models)||!raw.config)throw new ConsoleError(502,'电脑控制台返回了无效模型状态');
    return consoleState(raw);
  }
  async accounts(service:string){
    if(service==='codex')return accountResponse(object((await this.request('/api/state')).accounts));
    if(service==='codex-relay')return accountResponse(await this.request('/api/state'));
    if(service==='agy')return accountResponse(await this.request('/api/agy/accounts'));
    if(service==='claude')return accountResponse(await this.request('/api/claude-accounts'));
    if(service==='claude-profile')return accountResponse(await this.request('/api/harnesses'));
    const raw=await this.request('/api/model-accounts?editable=1');
    const account=rows(raw.accounts).find(row=>row.app===service);
    if(!account)throw new ConsoleError(502,'电脑控制台尚未返回该助手的配置');
    return accountResponse(account);
  }
  async accountAction(service:string,action:string,body:Data){
    if(service==='agy'&&action==='history')return accountResponse(await this.request('/api/agy/history?'+new URLSearchParams({accountId:String(body.accountId),days:String(body.days??7)})));
    if(service==='hermes'&&action==='oauth-status')return accountResponse(await this.request('/api/model-accounts/oauth'));
    if(service==='hermes'&&(action==='oauth-start'||action==='oauth-cancel'))return accountResponse(await this.request('/api/model-accounts/oauth/'+(action==='oauth-start'?'start':'cancel'),{}));
    let route:string;
    if(service==='codex')route=action==='switch-preview'?'/api/account/switch-preview':'/api/account/switch';
    else if(service==='agy')route='/api/agy/accounts/'+(action==='switch'?'select':action==='switch-preview'?'select-preview':action);
    else if(service==='claude')route='/api/claude-accounts/'+(action==='switch-preview'?'preview-switch':action);
    else if(service==='claude-profile')route='/api/harnesses/'+action;
    else if(service==='codex-relay'){
      const routes:Record<string,string>={'save-provider':'/api/providers/save','discover-models':'/api/providers/discover','import-providers':'/api/providers/import','delete-provider':'/api/providers/delete','model':'/api/model','toggle-model':'/api/model/toggle','model-settings':'/api/model/settings','routing-preview':'/api/routing/preview','takeover':'/api/takeover','direct':'/api/routing/direct','profile':'/api/routing/profile','routing-http':'/api/routing/http','model-order':'/api/model/order','refresh-catalog':'/api/catalog/refresh','rebuild-catalog':'/api/catalog/rebuild','test-model':'/api/test','compatibility':'/api/compatibility'};
      route=routes[action]!;
    }else route='/api/model-accounts/'+action;
    const payload={...body};
    if(service==='codex'){delete payload.accountId;delete payload.target;}
    else if(service==='agy'){delete payload.id;}
    else if(service==='claude'||service==='claude-profile'){delete payload.accountId;delete payload.target;}
    if(service==='deepseek'||service==='hermes')payload.app=service;
    const raw=await this.request(route,payload,65000);
    if(raw.ok===false||raw.switched===false||raw.error)throw new ConsoleError(409,'操作未完成，请检查电脑上的账号与模型配置');
    return accountResponse(raw);
  }
  async backendRestart(planId?:string){
    const raw=await this.request(planId?'/api/backend/restart':'/api/backend/restart-preview',planId?{planId}:{},planId?135000:65000);
    return {running:raw.running===true,restarted:raw.restarted===true,planId:text(raw.planId),canRestart:raw.canRestart===true,blockingCount:rows(raw.blockingThreads).length,catalogReloadPending:raw.catalogReloadPending===true,desktopRunning:raw.desktopRunning===true,desktopRestarted:raw.desktopRestarted===true,restartScope:raw.restartScope==='desktop-and-cli'?'desktop-and-cli':'cli-only'};
  }
  async statistics(source:Source,range:string,pricing:string){
    const query=new URLSearchParams({range});
    let route='/api/analytics?'+new URLSearchParams({range,view:'all',pricing});
    if(source==='agy')route='/api/agy/usage?'+query;
    else if(source!=='codex')route='/api/external/usage?'+new URLSearchParams({range,source});
    const raw=await this.request(route);
    if(!raw.totals||(source==='codex'&&!raw.tokens?.totals))throw new ConsoleError(502,'电脑控制台暂未返回完整统计数据，请稍后重试');
    return consoleStatistics(raw,source,range,pricing);
  }
  async action(action:'refresh'|'rebuild'|'toggle'|'default'|'index',id?:string,enabled?:boolean){
    const route={refresh:'/api/catalog/refresh',rebuild:'/api/catalog/rebuild',toggle:'/api/model/toggle',default:'/api/model',index:'/api/analytics/refresh'}[action];
    await this.request(route,action==='toggle'?{id,enabled}:action==='default'?{id}:{});
    return this.state();
  }
}

// Deliberately enumerate display/configuration fields. Credential values and
// local credential snapshot paths never pass through the paired-device response.
const accountFields=new Set(['app','name','id','accountId','email','alias','plan','workspace','active','acpActive','configured','hasLogin','mode','expiresAt','installed','hasKey','keyWritable','keySource','provider','providerId','baseUrl','apiMode','model','modelRoles','sonnet','opus','haiku','authType','authMethod','serviceHost','usageAvailable','usageReason','usageUnavailableReason','disabled','imported','importedAt','source','reference','available','message','error','switchReason','canSwitch','blocked','planId','target','label','switched','ok','saved','importedCount','elapsedMs','reply','quotaUpdatedAt','remainingPercent','usedPercent','resetsAt','at','status','key','window','primaryWindow','secondaryWindow','primary','secondary','updatedAt','capturedAt','percent','resetAt','resetAfterSeconds','limitWindowSeconds','enabled','contextWindow','displayName','context','official','visibility','owned','nativeCatalog','relayOnly','includeOfficial','selectedId','selected','canImport','category','identity','oauthConfigured','canEdit','readonly','connected','needsRestart','defaultModel','connect','running','transport','restart','command','file','changes','note']);
const accountArrays=new Set(['items','accounts','sources','targets','providerChoices','modelChoices','models','providers','externalProfiles','history','points','windows','apps','profiles','changes','warnings']);
const accountObjects=new Set(['current','latest','modelRoles','primary','secondary','primaryWindow','secondaryWindow','config','routingPreferences','modelSettings','route','liveUsage','to','from','state','settings','preview']);
for(const field of ['editable','selectedInCCSwitch','activeId','external','managed','officialHttp','modelCount','effortLevel','truncated','sourceAvailable','threads','files','bytes','recommendedTransport','reason','state','verificationUrl','userCode','days','completed','status','text','ms','filterImages','filterWebSearch','models','minimumVersion'])accountFields.add(field);
for(const field of ['blockingThreads','modelReplacements'])accountArrays.add(field);
accountObjects.add('migration');accountObjects.add('compatibility');
export function accountResponse(raw:Data):Data{
  const clean=(value:Data):Data=>Object.fromEntries(Object.entries(value).flatMap(([key,item])=>{
    if(key==='apps'&&item&&typeof item==='object'&&!Array.isArray(item))return [[key,Object.fromEntries(Object.entries(item).filter(([app])=>['claude','claude-desktop','gemini','codex','agy','deepseek','hermes'].includes(app)).map(([app,state])=>[app,clean(object(state))]))]];
    if(key==='env'&&item&&typeof item==='object'&&!Array.isArray(item))return [[key,Object.fromEntries(Object.entries(item).filter(([name,value])=>/^ANTHROPIC_(BASE_URL|MODEL|REASONING_MODEL|DEFAULT_(OPUS|SONNET|HAIKU)_MODEL)$/.test(name)&&typeof value==='string').map(([name,value])=>[name,(value as string).slice(0,2000)]))]];
    if(key==='modelSettings'&&item&&typeof item==='object'&&!Array.isArray(item))return [[key,Object.fromEntries(Object.entries(item).slice(0,500).map(([model,settings])=>[model.slice(0,500),clean(object(settings))]))]];
    if(accountArrays.has(key)&&Array.isArray(item))return [[key,item.slice(0,500).map(row=>typeof row==='string'?row.slice(0,2000):clean(object(row)))]];
    if(accountObjects.has(key)&&item&&typeof item==='object'&&!Array.isArray(item))return [[key,clean(object(item))]];
    return accountFields.has(key)&&(typeof item==='string'||typeof item==='number'||typeof item==='boolean'||item===null)?[[key,typeof item==='string'?item.slice(0,2000):item]]:[];
  }));
  return clean(raw);
}

export function consoleState(raw:Data){
  const config=object(raw.config),refresh=object(raw.catalogRefresh),metrics=object(raw.metrics);
  return {
    available:true,version:text(raw.version),updatedAt:new Date().toISOString(),
    config:{model:text(config.model),provider:text(config.provider),owned:config.owned===true,nativeCatalog:config.nativeCatalog===true,relayOnly:config.relayOnly===true},
    catalog:{running:refresh.running===true,automatic:refresh.automatic===true,intervalHours:num(refresh.intervalHours),lastChecked:text(refresh.lastChecked),lastUpdated:text(refresh.lastUpdated),changed:refresh.changed===true,count:num(refresh.count),added:Array.isArray(refresh.added)?refresh.added.filter((id:unknown)=>typeof id==='string').map((id:string)=>id.slice(0,500)):[],error:refresh.error?'上次模型检查失败，请重试或在电脑控制台查看详情':null},
    models:rows(raw.models).flatMap(model=>typeof model.id==='string'?[{id:text(model.id)!,name:text(model.name)||text(model.id)!,context:num(model.context),official:model.official===true,enabled:model.enabled===true,isDefault:model.id===config.model}]:[]),
    service:{requests:num(metrics.requests),errors:num(metrics.errors),activeRequests:num(metrics.activeRequests),startedAt:text(metrics.startedAt),memoryMB:num(raw.memoryMB)},
    modelError:raw.modelError?'模型目录读取失败，请在电脑控制台检查配置':null,
  };
}

export function consoleStatistics(raw:Data,source:Source,range:string,pricing='codex'){
  const codex=source==='codex',agy=source==='agy',harness=source==='hermes'||source==='deepseek'||source==='opencode'||source==='zcode',separate=agy||source==='claude';
  const token=object(raw.tokens),totals=object(codex?token.totals:raw.totals),activity=object(raw.totals),cost=object(harness?raw.cost:token.cost),coverage=object(raw.coverage),progress=object(raw.progress);
  const tokenRow=(row:Data)=>{
    const cached=count(codex||agy?row.cached:row.cacheRead),cacheWrite=count(row.cacheWrite);
    const input=count(row.input)+(separate?cached+cacheWrite:0),output=count(row.output);
    return {input,cached,cacheWrite,output,reasoning:source==='claude'?null:num(row.reasoning),total:input+output,records:count(codex?row.samples:row.requests)};
  };
  const modelRows=rows(codex?token.modelGroups:raw.groups).map(row=>{
    const rowCost=object(row.cost),measured=tokenRow(row);
    return {id:text(row.model)||'未记录模型',provider:harness?text(row.provider):null,billingMode:harness?text(row.billingMode):null,...measured,usd:codex||harness?num(rowCost.usd):agy&&count(row.requests)>count(row.unpriced)?num(row.usd):null,includedRecords:harness?count(rowCost.includedRecords):0,actualUsd:harness?num(rowCost.actualUsd):null,estimatedUsd:harness?num(rowCost.estimatedUsd):null,unpricedRecords:count(codex?rowCost.unpricedSamples:harness?rowCost.unpricedRecords:row.unpriced)};
  }).filter(row=>row.total>0||row.records>0);
  const daily=new Map<string,ReturnType<typeof tokenRow>&{date:string;activeMinutes:number|null}>();
  for(const row of rows(codex?token.series:raw.modelSeries)){
    const date=text(row.date);if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    const value=tokenRow(row),previous=daily.get(date);
    if(!previous)daily.set(date,{date,...value,activeMinutes:null});
    else{
      for(const key of ['input','cached','cacheWrite','output','total','records'] as const)previous[key]+=value[key];
      previous.reasoning=previous.reasoning===null||value.reasoning===null?null:previous.reasoning+value.reasoning;
    }
  }
  if(codex)for(const row of rows(raw.series)){
    const date=text(row.date);if(!date)continue;
    const point=daily.get(date)||{date,...tokenRow({}),activeMinutes:null};point.activeMinutes=num(row.activeMinutes);daily.set(date,point);
  }
  const modelSeries=rows(codex?token.modelSeries:raw.modelSeries).flatMap(row=>{
    const date=text(row.date),hour=text(row.hour);
    if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];
    return [{date,hour:hour&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3])$/.test(hour)&&hour.startsWith(date+'T')?hour:null,
      model:text(row.model)||'未记录模型',...tokenRow(row)}];
  });
  return {
    source,range,since:num(raw.since),until:num(raw.until),updatedAt:new Date().toISOString(),totals:tokenRow(totals),
    cost:{usd:codex||harness?num(cost.usd):agy&&count(totals.requests)>count(totals.unpriced)?num(totals.usd):null,basis:codex?pricing:harness?text(cost.basis):agy?'api':null,priceDate:text(codex||harness?cost.date:agy?raw.date:null),unpricedRecords:codex?num(cost.unpricedSamples):harness?num(cost.unpricedRecords):agy?num(totals.unpriced):null,partialRecords:harness?num(cost.partialRecords):agy?num(totals.partial):null,actualUsd:harness?num(cost.actualUsd):null,estimatedUsd:harness?num(cost.estimatedUsd):null,includedRecords:harness?num(cost.includedRecords):null},
    activity:codex?{minutes:num(activity.activeMinutes),days:num(activity.activeDays),sessions:num(activity.activeSessions),newSessions:num(activity.newSessions),toolCalls:num(activity.toolCalls)}:null,
    models:modelRows.sort((a,b)=>b.total-a.total),series:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),modelSeries,
    tools:codex?rows(raw.tools).map(row=>({name:text(row.name)||'未记录工具',category:text(row.category),count:count(row.count)})):[],
    index:{running:progress.running===true,completedFiles:num(progress.completedFiles),totalBytes:num(progress.totalBytes),doneBytes:num(progress.doneBytes),lastUpdated:text(progress.at),error:progress.error?'统计索引更新失败，请在电脑控制台查看详情':null},
    coverage:{available:coverage.available!==false,activityOnlySessions:num(coverage.activityOnlySessions),historyOnly:coverage.historyOnly===true,periodBasis:text(coverage.periodBasis),skippedFiles:num(coverage.skippedFiles)},
  };
}

export function registerLocalConsole(app:FastifyInstance,client=new LocalConsoleClient()){
  const respond=async(reply:any,operation:()=>Promise<unknown>)=>{try{return await operation();}catch(error){if(error instanceof ConsoleError)return reply.code(error.status).send({error:error.message});throw error;}};
  const accountService=z.enum(['codex','agy','claude','deepseek','hermes','codex-relay','claude-profile']);
  app.get('/api/local-console/accounts/:service',async(request,reply)=>{
    const {service}=z.object({service:accountService}).strict().parse(request.params);
    z.object({}).strict().parse(request.query);
    return respond(reply,()=>client.accounts(service));
  });
  app.post('/api/local-console/accounts/:service/:action',async(request,reply)=>{
    const {service,action}=z.object({service:accountService,action:z.string()}).strict().parse(request.params);
    const id=z.string().trim().min(1).max(500),planId=z.string().uuid();
    let schema:z.ZodTypeAny;
    if(service==='codex')schema=action==='switch-preview'?z.object({id}).strict():action==='switch'?z.object({id,planId,accountId:z.string().optional(),target:z.string().optional()}).strict():z.never();
    else if(service==='agy')schema=action==='refresh'?z.object({}).strict():action==='history'?z.object({accountId:id,days:z.number().int().min(1).max(90).optional()}).strict():action==='import'?z.object({source:z.enum(['tools','current']),accountIds:z.array(id).max(500).optional()}).strict():action==='switch-preview'?z.object({accountId:id,target:z.enum(['cli','acp'])}).strict():action==='switch'?z.object({accountId:id,target:z.enum(['cli','acp']),planId,id:z.string().optional()}).strict():z.never();
    else if(service==='claude'){
      const profiles=z.object({id:id.optional(),name:z.string().max(200),baseUrl:z.string().max(2000),authType:z.enum(['authToken','apiKey']),apiKey:z.string().max(8192),model:z.string().max(256),modelRoles:z.object({sonnet:z.string().max(256).optional(),opus:z.string().max(256).optional(),haiku:z.string().max(256).optional()}).strict().optional()}).strict();
      schema=action==='switch-preview'?z.object({id}).strict():action==='switch'?z.object({id,planId,accountId:z.string().optional(),target:z.string().optional()}).strict():action==='select'?z.object({id}).strict():action==='import-current'?z.object({name:z.string().max(200)}).strict():action==='import'?z.object({name:z.string().max(200),json:z.string().min(1).max(128*1024)}).strict():action==='refresh'?z.object({id:id.optional()}).strict():action==='save-profile'?profiles:action==='import-cc-switch'?z.object({id,name:z.string().max(200).optional()}).strict():z.never();
    }else if(service==='claude-profile'){
      const app=z.literal('claude');
      const env=z.record(z.string().regex(/^ANTHROPIC_(BASE_URL|MODEL|REASONING_MODEL|DEFAULT_(OPUS|SONNET|HAIKU)_MODEL)$/),z.string().max(2000));
      schema=action==='read'||action==='delete'?z.object({app,id}).strict():action==='switch-preview'?z.object({app,id}).strict():action==='switch'?z.object({app,id,planId,accountId:z.string().optional(),target:z.string().optional()}).strict():action==='save'?z.object({app,id:id.optional(),name:z.string().max(160),category:z.enum(['official','aggregator','custom']),apiKey:z.string().max(32768).optional(),authType:z.enum(['authToken','apiKey']).optional(),settings:z.object({env,model:z.string().max(2000).optional(),effortLevel:z.string().max(100).optional()}).strict()}).strict():z.never();
    }else if(service==='codex-relay'){
      const settings=z.object({displayName:z.string().max(500).optional(),contextWindow:z.number().int().positive().optional(),enabled:z.boolean().optional(),route:z.object({providerId:id,model:id}).strict().optional()}).strict();
      schema=action==='save-provider'?z.object({id:id.optional(),name:z.string().max(200),baseUrl:z.string().max(2000),apiKey:z.string().max(8192).optional(),models:z.array(z.string().max(256)).max(500),modelSettings:z.record(z.string(),settings).optional(),contextWindow:z.number().int().positive().optional(),enabled:z.boolean()}).strict():action==='discover-models'?z.object({id:id.optional(),baseUrl:z.string().max(2000),apiKey:z.string().max(8192).optional()}).strict():['model','delete-provider','test-model'].includes(action)?z.object({id}).strict():action==='toggle-model'?z.object({id,enabled:z.boolean()}).strict():action==='model-settings'?z.object({id,settings,connect:z.boolean().optional()}).strict():action==='model-order'?z.object({id,beforeId:id.optional(),afterId:id.optional()}).strict().refine(value=>!!value.beforeId!==!!value.afterId):action==='compatibility'?z.object({filterImages:z.boolean(),filterWebSearch:z.boolean()}).strict():action==='routing-preview'?z.object({enabled:z.boolean(),includeOfficial:z.boolean(),transport:z.enum(['auto','http'])}).strict():action==='takeover'?z.object({confirm:z.literal(true),restart:z.boolean(),includeOfficial:z.boolean()}).strict():action==='direct'?z.object({restart:z.boolean(),includeOfficial:z.boolean().optional()}).strict():action==='routing-http'?z.object({confirm:z.literal(true),restart:z.boolean()}).strict():['profile','import-providers','refresh-catalog','rebuild-catalog'].includes(action)?z.object({}).strict():z.never();
    }else schema=service==='hermes'&&['oauth-status','oauth-start','oauth-cancel'].includes(action)?z.object({}).strict():['save','models','test'].includes(action)?z.object({provider:id,baseUrl:z.string().max(2000),model:z.string().max(256),apiKey:z.string().max(8192),apiMode:z.string().max(100).optional()}).strict():z.never();
    const body=schema.parse(request.body) as Data;
    return respond(reply,()=>client.accountAction(service,action,body));
  });
  app.get('/api/local-console/state',async(_request,reply)=>respond(reply,()=>client.state()));
  app.post('/api/local-console/backend/restart-preview',async(_request,reply)=>respond(reply,()=>client.backendRestart()));
  app.post('/api/local-console/backend/restart',async(request,reply)=>{
    const {planId}=z.object({planId:z.string().uuid()}).strict().parse(request.body);
    return respond(reply,()=>client.backendRestart(planId));
  });
  app.get('/api/local-console/statistics',async(request,reply)=>{
    const query=z.object({source:z.enum(sources).default('codex'),range:z.enum(['today','week','month','year']).default('week'),pricing:z.enum(['codex','api']).default('codex')}).strict().parse(request.query);
    return respond(reply,()=>client.statistics(query.source,query.range,query.pricing));
  });
  app.post('/api/local-console/actions',async(request,reply)=>{
    const body=z.discriminatedUnion('action',[
      z.object({action:z.literal('refresh')}).strict(),z.object({action:z.literal('rebuild')}).strict(),z.object({action:z.literal('index')}).strict(),
      z.object({action:z.literal('toggle'),id:z.string().trim().min(1).max(500),enabled:z.boolean()}).strict(),
      z.object({action:z.literal('default'),id:z.string().trim().min(1).max(500)}).strict(),
    ]).parse(request.body);
    return respond(reply,()=>client.action(body.action,'id' in body?body.id:undefined,'enabled' in body?body.enabled:undefined));
  });
}
