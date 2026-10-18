import {AgyUsage} from './agy-usage.mjs';
import {ExternalUsage} from './external-usage.mjs';
import {relayDesktop,applyDesktop,setDesktopOfficial,desktopStatus} from './claude-desktop.mjs';
import {HarnessProfiles} from './harness-profiles.mjs';
import {PersonalAssistant} from './personal-assistant.mjs';
import {AssistantEngine,createAssistantEngineAdapter} from './assistant-engine.mjs';
import {AgyAccountManager} from './agy-account-manager.mjs';
import {ClaudeAccountManager} from './claude-account-manager.mjs';
import {AccountSwitchControl} from './account-switch-control.mjs';
import {ModelAccounts} from './model-accounts.mjs';
import {discoverProviderModels} from './provider-models.mjs';
import {readErrorResponse,summarizeError} from './upstream-errors.mjs';
import {networkError} from './network-error.mjs';
import {officialRequestHeaders,upstreamResponseHeaders} from './passthrough.mjs';
import {officialDirect,relayProfile} from './routing-config.mjs';
import {RoutingMigration} from './routing-migration.mjs';
import {SharedBackendControl,backendActivity} from './shared-backend-control.mjs';
import {parse as parseToml} from 'smol-toml';
import http from 'node:http';
import {zstdDecompressSync} from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Store,json} from './store.mjs';
import {GatewayService} from './gateway.mjs';
import {AccessControl} from './access-control.mjs';
import {SessionService} from './sessions.mjs';
import {UsageService,usageObserver} from './usage.mjs';
import {NativeSpeedService} from './native-speed.mjs';
import {Maintenance} from './maintenance.mjs';
import {filterRelayTools} from './compatibility.mjs';
import {Analytics} from './analytics.mjs';
import {OfficialCatalogUpdater} from './official-refresh.mjs';
import {attachResponsesWebSocket} from './responses-websocket.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export function endpoint(base){const u=new URL(base);let pathname=u.pathname.replace(/\/$/,'');if(!pathname.endsWith('/v1'))pathname+='/v1';u.pathname=pathname+'/responses';return u.href;}
export function decodeModelBody(raw,encoding){
  const value=String(encoding||'identity').trim().toLowerCase();
  if(value==='identity')return raw;
  if(value==='zstd')return zstdDecompressSync(raw,{maxOutputLength:64*1024*1024});
  throw new Error('不支持的请求压缩格式：'+value);
}
export function trimHistoricalImages(body){
  if(!Array.isArray(body.input))return 0;
  let latestUser=-1;
  for(let i=0;i<body.input.length;i++)if(body.input[i]?.type==='message'&&body.input[i].role==='user')latestUser=i;
  if(latestUser<0)return 0;
  let removed=0;
  function trim(value){
    if(Array.isArray(value))return value.map(trim);
    if(value&&typeof value==='object'){
      if(value.type==='input_image'||value.type==='image'){removed++;return {type:'input_text',text:'[历史图片已省略；沿用已有文字结论，需要视觉细节时再读取对应图片。]'};}
      return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,trim(v)]));
    }
    return value;
  }
  for(let i=0;i<latestUser;i++)body.input[i]=trim(body.input[i]);
  return removed;
}
export async function upstream(store,body,signal,{onRoute,rawBody,requestHeaders={},resource='responses',fetchImpl=fetch}={}){
  if(typeof body.model!=='string')throw new Error('缺少模型 ID');
  if(!['responses','responses/compact'].includes(resource))throw new Error('不支持的模型接口');
  const imagePolicy=json(path.join(store.dir,'image-context.json'),{threadIds:[]});
  const requestIds=['session-id','conversation-id','thread-id'].map(key=>requestHeaders[key]).filter(Boolean);
  if(imagePolicy.threadIds.some(id=>requestIds.includes(id))){
    const removed=trimHistoricalImages(body);
    if(removed){rawBody=undefined;console.log('Historical image filtering: '+JSON.stringify({threadId:requestIds.find(id=>imagePolicy.threadIds.includes(id)),removed,forwardedBytes:Buffer.byteLength(JSON.stringify(body))}));}
  }
  let url,headers=new Headers({'Content-Type':'application/json',Accept:body.stream?'text/event-stream':'application/json'});let payload={...body},outgoing;
  const route=store.resolveRoute(body.model);onRoute?.(route);
  if(route.provider){payload=filterRelayTools(payload,store.data.compatibility);url=endpoint(route.provider.baseUrl)+(resource==='responses/compact'?'/compact':'');headers.set('Authorization','Bearer '+await store.key(route.provider.id));payload.model=route.model;outgoing=JSON.stringify(payload);}
  else {const a=store.auth();url='https://chatgpt.com/backend-api/codex/'+resource;headers=officialRequestHeaders(requestHeaders);headers.set('Authorization','Bearer '+a.tokens.access_token);if(!headers.has('ChatGPT-Account-Id')&&a.tokens.account_id)headers.set('ChatGPT-Account-Id',a.tokens.account_id);if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');if(!headers.has('Accept'))headers.set('Accept',body.stream?'text/event-stream':'application/json');outgoing=rawBody??JSON.stringify(body);}
  return fetchImpl(url,{method:'POST',headers,body:outgoing,redirect:'error',signal});
}
async function readBody(req,limit=512*1024,raw=false){let total=0;const chunks=[];for await(const c of req){total+=c.length;if(total>limit)throw new Error('请求过大');chunks.push(c);}const bytes=Buffer.concat(chunks);return raw?bytes:JSON.parse(bytes.toString()||'{}');}
export function createServer({home,port=25819,webDir=path.join(here,'..','dist'),gateway,sessions,usage,maintenance,processAdapter,upstreamFetch=fetch,officialUpdater}){
 const store=new Store(home);let modelError=null;try{store.rebuild();}catch(e){modelError=e.message;}const metrics={requests:0,errors:0,lastRequest:null,activeRequests:0,startedAt:new Date().toISOString()};
 const harnessProfiles=new HarnessProfiles({storeDir:store.dir});
 const opencode=harnessProfiles.opencode;
 const modelAccounts=new ModelAccounts();
 const catalogUpdater=officialUpdater||new OfficialCatalogUpdater(store);
 const listener=gateway||new GatewayService({codexHome:home,logDir:path.join(store.dir,'gateway-logs')});
 const access=new AccessControl(listener);
 const assistantEngine=new AssistantEngine({directory:path.join(store.dir,'assistant-engine'),requestModel:(body,signal)=>upstream(store,body,signal),defaultModel:'gpt-6.1-sol'});
 const engineAdapter=createAssistantEngineAdapter(assistantEngine);
 engineAdapter.catalog=()=>{
  assistantEngine.models=store.models().filter(model=>model.visibility!=='hide'&&model.supported_in_api!==false).map(model=>({
   model:model.slug,displayName:model.display_name||model.slug,available:true,
   supportedReasoningEfforts:(model.supported_reasoning_levels||[]).map(level=>({reasoningEffort:level.effort,description:level.description||''})),
   defaultReasoningEffort:model.default_reasoning_level,
  }));
  return assistantEngine.catalog();
 };
 const personalAssistant=new PersonalAssistant({directory:store.dir,gateway:listener,adapters:[engineAdapter]});
 const sessionService=sessions||new SessionService(home);
 const usageService=usage||new UsageService(store);const tools=maintenance||new Maintenance(store,{listener,metrics,processAdapter});
 const routingMigration=new RoutingMigration(store,tools.processAdapter,port);
 const sharedBackend=new SharedBackendControl(store,tools.processAdapter);
 const agyAccounts=new AgyAccountManager({directory:store.dir,acpCredentialFile:null});
 const claudeAccounts=new ClaudeAccountManager({dir:store.dir,harnessProfiles});
 const invalidateAgy=()=>{modelAccounts.readonlyAccounts.cached=null;modelAccounts.readonlyAccounts.at=0;modelAccounts.readonlyAccounts.agySnapshot=null;};
 const readModelAccounts=()=>agyAccounts.withQuotaRefresh(()=>modelAccounts.list(),{invalidateCache:invalidateAgy});
 const switches=new AccountSwitchControl({inspectActivity:async agent=>{
  const blocking=[];
  if(agent==='codex'){
   const before=sharedBackend.endpoint();
   if(before){blocking.push(...(await backendActivity(before)).filter(thread=>thread.status!=='idle'));const after=sharedBackend.endpoint();if(after?.url!==before.url||after?.token!==before.token)throw new Error('共享后端状态已变化，请重新预览');}
   if(assistantEngine.live.size)blocking.push({id:'assistant-engine',name:'助理任务',status:'active'});
  }else if(['claude','antigravity','deepseek','hermes','grok','opencode'].includes(agent)){
   const health=await personalAssistant.request('/api/agents/health'),state=health.agents?.find(item=>item.agent===agent);
   if(health.error||!state||!Number.isInteger(state.activeCount))throw new Error('无法确认助手的运行任务，请稍后重试');
   for(let index=0;index<state.activeCount;index++)blocking.push({id:agent+'-'+index,name:state.name,status:'active'});
  }
  return blocking;
 }});
 const codexSelection=async id=>{
  const state=store.accounts(),target=state.items.find(item=>item.id===id),entry=json(path.join(home,'accounts','registry.json'),{}).items?.find(item=>item.accountKey===id);
  if(!target||!entry)throw new Error('账号不存在');
  const base=fs.realpathSync(path.join(home,'accounts','snapshots')),file=fs.realpathSync(path.resolve(entry.snapshotPath));
  if(!file.startsWith(base+path.sep))throw new Error('账号快照不在本机账号目录内');
  const snapshot=json(file,{}),auth=snapshot.auth||snapshot;if(!auth.tokens?.access_token)throw new Error('账号快照没有可用登录，请重新登录');
  return {view:{id,accountId:id,target:'codex',label:target.alias||target.email,from:{email:state.email},to:target,message:'切换本机 Codex 登录凭据；新建连接使用该账号'},revision:JSON.stringify([json(path.join(home,'auth.json'),{}),auth])};
 };
 const agySelection=async body=>{const state=await agyAccounts.list(),target=state.items.find(item=>item.id===body.accountId),destination=state.targets.find(item=>item.id===body.target);if(!target)throw new Error('AGY 账号不存在');return {view:{id:target.id,accountId:target.id,target:body.target,label:target.email||target.name,from:state.current,to:target,canSwitch:!!destination?.available&&!target.disabled,message:destination?.available?'切换后新建 AGY 进程使用此账号':'此目标尚未完成登录配置'},revision:JSON.stringify([await agyAccounts.current(),(await agyAccounts.vault()).accounts.find(item=>item.id===target.id),body.target])};};
 const claudeSelection=async id=>{const view=await claudeAccounts.act('preview-switch',{id});return {view,revision:JSON.stringify([claudeAccounts.native(),claudeAccounts.state().items.find(item=>item.id===id)])};};
 const harnessSelection=async body=>{if(body.app==='opencode')return opencode.profileSelection(harnessProfiles.profile('opencode',body.id));const state=harnessProfiles.list(),item=state.apps[body.app],target=item?.profiles.find(profile=>profile.id===body.id);if(!target)throw new Error('配置不存在');return {view:{app:body.app,id:body.id,label:target.name,from:item.profiles.find(profile=>profile.id===item.activeId)||null,to:target,canSwitch:item.managed,message:'切换后新建进程使用此配置'},revision:JSON.stringify([harnessProfiles.live(body.app),harnessProfiles.profile(body.app,body.id)])};};
 const harnessAgent=app=>app==='codex'?'codex':app==='claude'?'claude':app==='gemini'?'antigravity':app;
 let agy;const getAgy=()=>agy??=new AgyUsage(path.join(store.dir,'analytics'));const externalUsage=new ExternalUsage(undefined,{dir:path.join(store.dir,'analytics'),refreshMs:60000});
 let analytics;const getAnalytics=()=>analytics??=new Analytics(home,path.join(store.dir,'analytics'));
 let nativeSpeed;const getNativeSpeed=()=>nativeSpeed??=new NativeSpeedService(home,store.dir);
 const origin=`http://127.0.0.1:${port}`;
 const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){send(403,{error:'仅允许本机访问'});return;}
  const pathname=new URL(req.url,origin).pathname;
  try {
   if(pathname.startsWith('/claude-desktop/')){await relayDesktop(req,res,{dir:store.dir});return;}
   if(routingMigration.busy&&req.method==='POST'){send(409,{error:'会话迁移正在进行，请稍后操作'});return;}
   if(sharedBackend.busy&&req.method==='POST'){send(409,{error:'共享后端正在重启，请稍后操作'});return;}
   if(pathname==='/health'&&req.method==='GET'){send(200,{ok:true,application:'local-console',version:'0.12.3'});return;}
   if(['/v1/responses','/v1/responses/compact','/relay/v1/responses','/relay/v1/responses/compact'].includes(pathname)&&req.method==='POST'){
    const a=store.auth();if(req.headers.authorization!=='Bearer '+a.tokens.access_token){send(401,{error:{message:'本地认证失败'}});return;}
    if(req.headers.origin&&![origin,`http://localhost:${port}`].includes(req.headers.origin)){send(403,{error:'来源不允许'});return;}
    const rawBody=decodeModelBody(await readBody(req,16*1024*1024,true),req.headers['content-encoding']);const body=JSON.parse(rawBody.toString());if(pathname.startsWith('/relay/')&&(!String(body.model).includes('::')||!store.resolveRoute(body.model).provider))throw new Error('独立中转入口只接受新增中转模型');const controller=new AbortController();const timer=setTimeout(()=>controller.abort(Object.assign(new Error('Upstream timeout'),{code:'UPSTREAM_TIMEOUT'})),300000);res.on('close',()=>{if(!res.writableEnded)controller.abort(Object.assign(new Error('Client closed'),{code:'CLIENT_CLOSED'}));});metrics.requests++;metrics.activeRequests++;metrics.lastRequest={at:new Date().toISOString(),model:body.model};
    const started=performance.now();let status=0,provider='openai',errorCode=null,errorSummary=null;const observer=usageObserver({startedAt:started});try{const r=await upstream(store,body,controller.signal,{onRoute:route=>provider=route.provider?.id||'openai',rawBody,requestHeaders:req.headers,resource:pathname.endsWith('/compact')?'responses/compact':'responses',fetchImpl:upstreamFetch});status=r.status;const responseHeaders=upstreamResponseHeaders(r.headers);responseHeaders['x-local-console-route']=provider==='openai'?'openai-passthrough':'relay';if(!r.ok){const failure=await readErrorResponse(r);errorSummary=failure.summary;errorCode=errorSummary.code||'UPSTREAM_HTTP_ERROR';responseHeaders['content-type']='application/json; charset=utf-8';delete responseHeaders['content-length'];res.writeHead(r.status,responseHeaders);res.end(JSON.stringify(failure.body));}else {observer.expectSSE(r.headers.get('content-type')?.includes('text/event-stream'));res.writeHead(r.status,responseHeaders);if(r.body)await pipeline(Readable.fromWeb(r.body),observer.stream,res);else res.end();errorSummary=observer.getFailure();if(errorSummary)errorCode=errorSummary.code||'UPSTREAM_STREAM_ERROR';}}catch(e){const failure=networkError(controller.signal.aborted?controller.signal.reason:e)||networkError(e);errorCode=failure?.code||'UPSTREAM_STREAM_ERROR';if(!status)status=failure?.status||502;errorSummary=summarizeError(status,{error:{code:errorCode,message:failure?.message||'上游响应流中断'}});throw e;}finally{clearTimeout(timer);metrics.activeRequests--;if(errorCode||status>=400)metrics.errors++;try{usageService.recordRequest({model:body.model,provider,status,errorCode,errorSummary,durationMs:performance.now()-started,resource:pathname.endsWith('/compact')?'responses/compact':'responses',usage:observer.getUsage(),tier:observer.getTier(),timings:observer.getTimings()});}catch{}}return;
   }
   if(pathname.startsWith('/api/')){
    if(req.headers.origin&&![origin,`http://localhost:${port}`].includes(req.headers.origin)){send(403,{error:'来源不允许'});return;}
    if(req.headers['x-local-token']!==store.secret){send(403,{error:'请重新打开控制台'});return;}
    if(pathname==='/api/access'&&req.method==='GET'){send(200,await access.state());return;}
    if(pathname==='/api/access/channels'&&req.method==='GET'){send(200,await access.channels());return;}
    if(req.method==='POST'&&['/api/access/pair','/api/access/remote','/api/access/devices/revoke','/api/access/channel'].includes(pathname)){
      const body=await readBody(req);const action=pathname.split('/').at(-1);
      send(200,await (action==='pair'?access.pair(body):action==='remote'?access.remote(body):action==='revoke'?access.revoke(body):access.channel(body)));return;
    }
    if(req.method==='GET'&&pathname==='/api/agy/usage'){const q=new URL(req.url,origin).searchParams;send(200,getAgy().summary(q.get('range')||'week',{from:q.get('from'),to:q.get('to')}));return;}
    if(req.method==='GET'&&pathname==='/api/external/usage'){const q=new URL(req.url,origin).searchParams;send(200,await externalUsage.summary(q.get('source')||'zcode',q.get('range')||'week',{from:q.get('from'),to:q.get('to')}));return;}
    if(req.method==='GET'&&pathname==='/api/analytics'){const q=new URL(req.url,origin).searchParams;send(200,getAnalytics().summary(q.get('range')||'week',{view:q.get('view')||'all',model:q.get('model')||'all',tier:q.get('tier')||'all',effort:q.get('effort')||'all',pricing:q.get('pricing')||'codex'},{from:q.get('from'),to:q.get('to')}));return;}
    if(req.method==='GET'&&pathname==='/api/usage/speed'){const q=new URL(req.url,origin).searchParams,source=q.get('source')||'router',range=q.get('range')||'week',bounds={from:q.get('from'),to:q.get('to')},filters={model:q.get('model')||'all',provider:q.get('provider')||'all'};if(!['native','router'].includes(source))throw new Error('速度来源无效');if(source==='native'){const service=getNativeSpeed();const result=service.summary(range,bounds,filters);service.start();send(200,{...result,progress:service.progress});}else send(200,{...usageService.speed(range,bounds,filters),source:'router'});return;}
    if(req.method==='GET'&&pathname==='/api/sessions'){const q=new URL(req.url,origin).searchParams;send(200,await sessionService.list({archived:q.get('archived')==='true',cursor:q.get('cursor'),search:q.get('search')||'',source:q.get('source')||'interactive',cwd:q.get('cwd')||'',olderThanDays:q.get('olderThanDays')||0,minBytes:q.get('minBytes')||0,onlyIdle:q.get('onlyIdle')==='true'}));return;}
    if(req.method==='GET'&&pathname==='/api/routing/progress'){send(200,routingMigration.status());return;}
    if(req.method==='GET'&&pathname==='/api/state'){
      let configuredModels=[];try{configuredModels=store.models();modelError=null;}catch(e){modelError=e.message;}let config;try{config=store.configInfo();}catch{config={provider:'unknown',model:null,owned:false,nativeCatalog:false,error:'配置语法异常'};}
      const models=configuredModels.map(m=>({id:m.slug,name:m.display_name||m.slug,context:m.context_window,official:!m.slug.includes('::'),enabled:m.visibility!=='hide',route:store.data.modelSettings?.[m.slug]?.route||null}));
      send(200,{home,port,version:'0.12.3',config,routingPreferences:{includeOfficial:store.data.includeOfficialInRelay===true},modelError,catalogSource:store.catalogSource,catalogRefresh:catalogUpdater.status(),compatibility:store.data.compatibility||{},accounts:store.accounts(),models,providers:store.providers(),metrics,backups:store.backups(),events:store.events(),processOperation:tools.processOperation(),sharedBackend:sharedBackend.summary(),gateway:{...await listener.status(),autoStart:store.data.gatewayAutoStart!==false},memoryMB:Math.round(process.memoryUsage().rss/1048576)});return;
    }
    if(req.method==='GET'&&pathname==='/api/usage/history'){const q=new URL(req.url,origin).searchParams,bounds={from:q.get('from'),to:q.get('to')};send(200,{...usageService.history(q.get('account')||undefined,Number(q.get('days')||7),q.get('range'),bounds),routing:usageService.requests(Number(q.get('days')||7),q.get('range'),bounds)});return;}
    if(req.method==='GET'&&pathname==='/api/maintenance/report'){send(200,await tools.exportReport());return;}
    if(req.method==='GET'&&pathname==='/api/maintenance/process-status'){send(200,tools.processOperation());return;}
    if(req.method==='GET'&&pathname==='/api/extensions'){send(200,store.extensions());return;}
    if(req.method==='GET'&&pathname==='/api/harnesses'){send(200,{...harnessProfiles.list(),desktop:desktopStatus({dir:store.dir}),opencode:opencode.state(harnessProfiles.rows('opencode'))});return;}
    if(req.method==='GET'&&pathname==='/api/harnesses/health'){send(200,await personalAssistant.request('/api/agents/health'));return;}
    if(req.method==='GET'&&pathname==='/api/harnesses/updates'){const q=new URL(req.url,origin).searchParams;send(200,await personalAssistant.request('/api/agents/updates'+(q.get('refresh')==='1'?'?refresh=1':'')));return;}
    if(req.method==='GET'&&pathname==='/api/opencode'){send(200,opencode.state(harnessProfiles.rows('opencode')));return;}
    if(req.method==='GET'&&pathname==='/api/agy/accounts'){send(200,await agyAccounts.list());return;}
    if(req.method==='GET'&&pathname==='/api/agy/history'){const q=new URL(req.url,origin).searchParams;send(200,agyAccounts.history({days:q.get('days'),accountId:q.get('accountId')}));return;}
    if(req.method==='GET'&&pathname==='/api/claude-accounts'){send(200,await claudeAccounts.list());return;}
    if(pathname.startsWith('/api/personal-assistant/')){
     if(req.method==='GET'&&pathname==='/api/personal-assistant/catalog'){send(200,await personalAssistant.catalog());return;}
     const match=/^\/api\/personal-assistant\/tasks\/([\w-]+)(?:\/(continue|stop|approve))?$/.exec(pathname);
     if(req.method==='GET'&&pathname==='/api/personal-assistant/tasks'){send(200,personalAssistant.list());return;}
     if(req.method==='GET'&&pathname==='/api/personal-assistant/projects'){send(200,await personalAssistant.projects());return;}
     if(req.method==='GET'&&match&&!match[2]){send(200,await personalAssistant.detail(match[1]));return;}
     if(req.method==='POST'){
      const body=await readBody(req);
      if(pathname==='/api/personal-assistant/tasks'){send(202,await personalAssistant.create(body));return;}
      if(match?.[2]==='continue'){send(202,await personalAssistant.continue(match[1],body));return;}
      if(match?.[2]==='stop'){send(200,await personalAssistant.stop(match[1]));return;}
      if(match?.[2]==='approve'){send(200,await personalAssistant.approve(match[1],body));return;}
     }
     send(404,{error:'未找到助理接口'});return;
    }
    if(req.method==='GET'&&pathname==='/api/model-accounts'){const q=new URL(req.url,origin).searchParams;send(200,q.get('editable')==='1'?await modelAccounts.list({editableOnly:true}):await readModelAccounts());return;}
    if(req.method==='GET'&&pathname==='/api/model-accounts/oauth'){send(200,modelAccounts.oauthStatus());return;}
    if(req.method!=='POST'){send(404,{error:'未找到接口'});return;}
    const b=await readBody(req);let result;
    if(pathname==='/api/agy/accounts/import')result=await agyAccounts.import(b);
    else if(pathname==='/api/agy/accounts/refresh'){
     const quota=await agyAccounts.withQuotaRefresh(async()=>{invalidateAgy();return {accounts:await modelAccounts.readonlyAccounts.list()};},{invalidateCache:invalidateAgy});
     const row=quota.accounts.find(account=>account.app==='agy');
     result={...await agyAccounts.list(),windows:row?.windows||[],history:agyAccounts.history(),message:row?.windows?.length&&!row.stale?'AGY 额度已刷新并记录历史':row?.note||row?.status||'AGY 额度暂不可读取'};
    }
    else if(pathname==='/api/agy/accounts/select-preview')result=await switches.preview('agy:'+b.target+':'+b.accountId,'antigravity',()=>agySelection(b));
    else if(pathname==='/api/agy/accounts/select')result=await switches.apply('agy:'+b.target+':'+b.accountId,'antigravity',b.planId,()=>agySelection(b),async()=>{const value=await agyAccounts.select(b);invalidateAgy();return value;});
    else if(pathname==='/api/claude-accounts/preview-switch')result=await switches.preview('claude:'+b.id,'claude',()=>claudeSelection(b.id));
    else if(pathname==='/api/claude-accounts/switch')result=await switches.apply('claude:'+b.id,'claude',b.planId,()=>claudeSelection(b.id),()=>claudeAccounts.act('switch',b));
    else if(/^\/api\/claude-accounts\/(import-current|import|import-cc-switch|select|refresh)$/.test(pathname))result=await claudeAccounts.act(pathname.split('/').at(-1),b);
    else if(pathname==='/api/model-accounts/save')result=await modelAccounts.act('save',b);
    else if(pathname==='/api/model-accounts/test')result=await modelAccounts.act('test',b);
    else if(pathname==='/api/model-accounts/models')result=await modelAccounts.act('models',b);
    else if(pathname==='/api/model-accounts/oauth/start')result=modelAccounts.startOAuth();
    else if(pathname==='/api/model-accounts/oauth/cancel')result=modelAccounts.cancelOAuth();
    else if(pathname==='/api/analytics/refresh')result=getAnalytics().start(b.rebuild===true);
    else if(pathname==='/api/analytics/pause')result=getAnalytics().pause();
    else if(pathname==='/api/maintenance/diagnose')result=await tools.diagnose();
    else if(pathname==='/api/maintenance/repair-preview')result=await tools.repairPreview();
    else if(pathname==='/api/maintenance/repair')result=await tools.repair(b.planId);
    else if(pathname==='/api/maintenance/cleanup-preview')result=tools.cleanupPreview(b);
    else if(pathname==='/api/maintenance/cleanup')result=tools.cleanup(b.planId,b.selected);
    else if(pathname==='/api/maintenance/process-preview')result=await tools.processPreview(b.action);
    else if(pathname==='/api/maintenance/process-apply')result=tools.scheduleProcessApply(b.planId,{allowActive:b.allowActive===true});
    else if(pathname==='/api/backend/restart-preview')result=await sharedBackend.preview();
    else if(pathname==='/api/backend/restart')result=await sharedBackend.restart(b.planId);
    else if(pathname==='/api/maintenance/send')result=await tools.sendReport(b.destination);
    else if(pathname==='/api/compatibility'){if(typeof b.filterImages!=='boolean'||typeof b.filterWebSearch!=='boolean')throw new Error('过滤开关无效');store.data.compatibility={filterImages:b.filterImages,filterWebSearch:b.filterWebSearch};store.save();result=store.data.compatibility;}
    else if(pathname==='/api/usage/auto'){if(typeof b.enabled!=='boolean')throw new Error('自动采样开关无效');store.data.usageAutoSample=b.enabled;store.save();result={enabled:b.enabled};}
    else if(pathname==='/api/sessions/delete-preview')result=await sessionService.previewDelete(b.ids,{source:b.source||'interactive'});
    else if(pathname==='/api/sessions/change')result=await sessionService.change(b.ids,b.action,{source:b.source||'interactive',planId:b.planId});
    else if(pathname==='/api/opencode/provider-preview')result=await opencode.preview('provider',b,switches);
    else if(pathname==='/api/opencode/model-preview')result=await opencode.preview('model',b,switches);
    else if(pathname==='/api/opencode/provider-apply'||pathname==='/api/opencode/model-apply'){if(b.confirmed!==true)throw new Error('请明确确认 OpenCode 配置预览');result=await opencode.apply(pathname.includes('provider-apply')?'provider':'model',b.planId,switches);}
    else if(pathname==='/api/harnesses/read')result=harnessProfiles.read(b.app,b.id);
    else if(pathname==='/api/harnesses/save')result=await harnessProfiles.save(b);
    else if(pathname==='/api/harnesses/delete')result=harnessProfiles.delete(b.app,b.id);
    else if(pathname==='/api/harnesses/switch-preview')result=await switches.preview('harness:'+b.app+':'+b.id,harnessAgent(b.app),()=>harnessSelection(b));
    else if(pathname==='/api/harnesses/switch')result=await switches.apply('harness:'+b.app+':'+b.id,harnessAgent(b.app),b.planId,()=>harnessSelection(b),async()=>{if(b.app==='claude-desktop'){const profile=harnessProfiles.profile('claude-desktop',b.id);return profile.category==='official'?setDesktopOfficial({dir:store.dir}):applyDesktop({dir:store.dir,providerId:b.id,port});}return await harnessProfiles.switch(b.app,b.id);});
    else if(pathname==='/api/gateway/start')result=await listener.ensure();
    else if(pathname==='/api/gateway/autostart'){if(typeof b.enabled!=='boolean')throw new Error('开关值无效');store.data.gatewayAutoStart=b.enabled;store.save();result={enabled:b.enabled};}
    else if(pathname==='/api/providers/import')result=store.importProviders();
    else if(pathname==='/api/providers/discover')result=await discoverProviderModels(store,b);
    else if(pathname==='/api/providers/save')result=await store.updateProvider(b);
    else if(pathname==='/api/providers/delete')result=store.deleteProvider(b.id);
    else if(pathname==='/api/model/settings'){if(b.connect===true&&!store.configInfo().owned)throw new Error('请先通过“连接中转路由”关闭 Codex 并迁移会话，再设置中转');result=store.updateModelSettings(b.id,b.settings,{connect:false,port});}
    else if(pathname==='/api/model/toggle')result=store.toggleModel(b.id,b.enabled);
    else if(pathname==='/api/model/order')result=store.moveModel(b.id,{beforeId:b.beforeId,afterId:b.afterId});
    else if(pathname==='/api/model')result=store.setModel(b.id);
    else if(pathname==='/api/routing/preview')result=await routingMigration.preview(b.enabled===true,b.includeOfficial,b.transport==='http'?'http':'auto');
    else if(pathname==='/api/takeover'){if(b.confirm!==true)throw new Error('请确认已退出原 AiMaMi，避免配置冲突');result=await routingMigration.apply(true,{restart:b.restart===true,includeOfficial:b.includeOfficial});}
    else if(pathname==='/api/routing/direct')result=await routingMigration.apply(false,{restart:b.restart===true});
    else if(pathname==='/api/routing/http'){if(b.confirm!==true)throw new Error('请确认关闭 Codex、迁移会话并切换官方 HTTPS');result=await routingMigration.apply(false,{restart:b.restart===true,transport:'http'});}
    else if(pathname==='/api/routing/profile')result=relayProfile(store,port);
    else if(pathname==='/api/backup')result={id:store.backup()};
    else if(pathname==='/api/restore'){if(!/^[0-9]+-[a-f0-9]+$/.test(b.id||''))throw new Error('无效备份');const saved=JSON.parse(fs.readFileSync(path.join(store.dir,'backups',b.id+'.json'),'utf8'));if(saved.kind==='config'&&(parseToml(saved.content).model_provider||'openai')!==store.configInfo().provider)throw new Error('该备份会改变会话入口，请先使用接管或恢复官方直连完成会话迁移');result=store.restore(b.id);}
    else if(pathname==='/api/account/switch-preview')result=await switches.preview('codex:'+b.id,'codex',()=>codexSelection(b.id));
    else if(pathname==='/api/account/switch')result=await switches.apply('codex:'+b.id,'codex',b.planId,()=>codexSelection(b.id),()=>store.switchAccount(b.id));
    else if(pathname==='/api/catalog/rebuild')result={count:store.rebuild().length};
    else if(pathname==='/api/catalog/refresh')result=await catalogUpdater.refresh();
    else if(pathname==='/api/mcp')result=store.toggleMcp(b.id,b.enabled);
    else if(pathname==='/api/subagents')result=store.updateSubagent(b);
    else if(pathname==='/api/usage'){result=await usageService.refresh();
    } else if(pathname==='/api/test'){
      const start=Date.now();const r=await upstream(store,{model:b.id,instructions:'Reply exactly OK.',input:[{role:'user',content:[{type:'input_text',text:'Reply exactly OK.'}]}],store:false,stream:true},AbortSignal.timeout(45000));
      let raw='';for await(const chunk of r.body){raw+=Buffer.from(chunk).toString();if(raw.length>1048576)throw new Error('测试响应超过限制');}let text='',completed=false,error=false;for(const line of raw.split('\n'))if(line.startsWith('data: ')){try{const e=JSON.parse(line.slice(6));if(e.type==='response.output_text.delta')text+=e.delta;if(e.type==='response.completed')completed=true;if(['response.failed','error'].includes(e.type))error=true;}catch{}}
      result={status:r.status,completed:completed&&!error,text:text.slice(0,200),ms:Date.now()-start};
    }else {send(404,{error:'未找到接口'});return;}send(200,result);return;
   }
   if(req.method!=='GET'){send(405,{error:'不支持该方法'});return;}
   const files={'/':'index.html','/app.js':'app.js','/app.css':'app.css','/management.css':'management.css'};const file=files[pathname];if(!file){res.writeHead(404);res.end();return;}
   let content=fs.readFileSync(path.join(webDir,file));if(file==='index.html')content=content.toString().replace('__LOCAL_TOKEN__',store.secret);
   res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(content);
  }catch(e){if(!res.headersSent){const failure=networkError(e);if(failure){res.setHeader('Retry-After','1');send(failure.status,{error:{message:failure.message,type:'upstream_connection_error',code:failure.code}});}else send(Number.isInteger(e.statusCode)&&e.statusCode>=400&&e.statusCode<600?e.statusCode:400,{error:e.message});}else res.destroy();}
 });
 attachResponsesWebSocket(server,{
  authorize:req=>{
   if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return 403;
   if(new URL(req.url,origin).pathname!=='/v1/responses')return 404;
   if(req.headers.origin&&![origin,`http://localhost:${port}`].includes(req.headers.origin))return 403;
   try{return req.headers.authorization==='Bearer '+store.auth().tokens.access_token?200:401;}catch{return 401;}
  },
  request:(body,signal,requestHeaders)=>upstream(store,body,signal,{requestHeaders,fetchImpl:upstreamFetch}),
  onRequest:model=>{metrics.requests++;metrics.activeRequests++;metrics.lastRequest={at:new Date().toISOString(),model};},
  onFinish:result=>{metrics.activeRequests--;if(result.errorCode||result.status>=400)metrics.errors++;try{usageService.recordRequest({...result,provider:'openai',resource:'responses',transport:'local-websocket'});}catch{}},
 });
 server.on('close',()=>{modelAccounts.cancelOAuth();usageService.stop();sessionService.close?.();analytics?.close();nativeSpeed?.close();catalogUpdater.stop();void assistantEngine.close();});server.on('close',()=>agy?.close());return {server,store,metrics,listener,usageService,getAnalytics,catalogUpdater};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);const home=args.includes('--home')?args[args.indexOf('--home')+1]:process.env.CODEX_HOME||path.join(os.homedir(),'.codex');const port=Number(process.env.LOCAL_CONSOLE_PORT||25819);const {server,store,listener,usageService,getAnalytics,catalogUpdater}=createServer({home,port});server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'控制台端口已占用':e.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>{console.log(`Local Console http://127.0.0.1:${port}`);usageService.start();catalogUpdater.start();if(process.env.LOCAL_CONSOLE_DISABLE_ANALYTICS!=='1'){try{getAnalytics().startSchedule();}catch(e){console.error('Analytics: '+e.message);}}if(store.data.gatewayAutoStart!==false)listener.ensure().catch(e=>console.error('Gateway: '+e.message));});
}


