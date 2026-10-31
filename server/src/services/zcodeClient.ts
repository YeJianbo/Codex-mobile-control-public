import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {execa} from 'execa';
import type {AgentExecutable} from './agentExecutable.js';
import type {PickerModel} from './modelCatalog.js';
import {readZcodeAccount,zcodeEnvironment} from './zcodeAccount.js';
import {syncZcodeDesktopSession} from './zcodeDesktop.js';
import {sharedZcodeProxy} from './zcodeShared.js';
import {registerZcodeModelWindows} from './zcodeUsage.js';
import {setTimeout as delay} from 'node:timers/promises';
import {zcodeToolStream} from './zcodeStream.js';
import {isZcodeBusyError,zcodeRecoveryEnabled,zcodeRecoveryDelay,zcodeRecoveryInputPrefix,zcodeRecoveryPrompt} from './zcodeRecovery.js';
import {createAcpDispatch,type AcpDispatch} from './acpPromptDispatch.js';

type ReverseRequest=(method:string,params:any)=>Promise<any>;
/** Native NDJSON RPC. A shared connection owns its proxy, never the shared runtime. */
export class ZcodeConnection{
  readonly child:any;
  readonly shared:boolean;
  private sequence=0;
  private pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private closed=false;
  private reader:ReturnType<typeof createInterface>;
  onEvent?:(method:string,params:any)=>void;
  onExit?:(error:Error)=>void;
  constructor(executable:AgentExecutable,cwd:string,env:Record<string,string>,private reverse:ReverseRequest,launch:typeof execa=execa){
    const proxy=launch===execa?sharedZcodeProxy(executable):undefined;this.shared=!!proxy;
    this.child=launch(proxy?.command||executable.command,proxy?.args||[...(executable.args||[]),'app-server','--stdio','--surface','terminal'],{cwd,env,windowsHide:true,reject:false,buffer:false,stdin:'pipe'});
    // Native diagnostics are not part of the timeline and may contain local paths.
    // Drain them even for catalog reads so a full stderr pipe cannot stall RPC.
    this.child.stderr?.resume();
    this.reader=createInterface({input:this.child.stdout});
    this.reader.on('line',line=>{let value:any;try{value=JSON.parse(line);}catch{return;}
      if(value.id!==undefined&&typeof value.method==='string'){
        void Promise.resolve().then(()=>this.reverse(value.method,value.params||{})).then(result=>this.write({id:value.id,result}),error=>this.write({id:value.id,error:{
          code:typeof error?.code==='number'?error.code:-32603,
          message:error?.code===-32601?`ZCode 当前未接入此请求：${value.method}`:`ZCode 请求处理失败：${value.method}`,
        }}));return;
      }
      if(value.id!==undefined){const entry=this.pending.get(String(value.id));if(!entry)return;this.pending.delete(String(value.id));clearTimeout(entry.timer);value.error?entry.reject(Error(`ZCode ${value.error.message||'请求失败'} (${value.error.code})`)):entry.resolve(value.result);return;}
      if(typeof value.method==='string')this.onEvent?.(value.method,value.params||{});
    });
    Promise.resolve(this.child).then(result=>this.exit(Error(`ZCode 进程已退出 (${result.exitCode})`)),()=>this.exit(Error('ZCode 进程无法启动')));
  }
  private write(value:any){if(!this.closed&&this.child.stdin?.writable)this.child.stdin.write(JSON.stringify(value)+'\n');}
  private exit(error:Error){if(this.closed)return;this.closed=true;this.reader.close();for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(error);}this.pending.clear();this.onExit?.(error);}
  request(method:string,params:any={},timeout=30000):Promise<any>{
    if(this.closed)return Promise.reject(Error('ZCode 连接已关闭'));
    return new Promise((resolve,reject)=>{const id='gateway-'+(++this.sequence),timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`ZCode ${method} 超时`));},timeout);this.pending.set(id,{resolve,reject,timer});this.write({id,method,params});});
  }
  attemptSend(params:any,timeout=30000):{request:Promise<any>;phase:AcpDispatch['phase'];error?:unknown}{
    if(this.closed){const error=Error('ZCode 连接已关闭');return {request:Promise.reject(error),phase:'not_started',error};}
    const id='gateway-'+(++this.sequence);
    let resolve!:(value:any)=>void,reject!:(error:Error)=>void;
    const request=new Promise<any>((res,rej)=>{resolve=res;reject=rej;});
    const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('ZCode session/send 超时'));},timeout);
    this.pending.set(id,{resolve,reject,timer});
    let payload:string;
    try{payload=JSON.stringify({id,method:'session/send',params})+'\n';}
    catch(error){clearTimeout(timer);this.pending.delete(id);reject(Error('ZCode 消息无法序列化'));return {request,phase:'not_started',error};}
    const stdin=this.child.stdin;
    if(!stdin?.writable){clearTimeout(timer);this.pending.delete(id);const error=Error('ZCode 标准输入不可写，任务未发送');reject(error);return {request,phase:'not_started',error};}
    try{stdin.write(payload);}catch(error){clearTimeout(timer);this.pending.delete(id);reject(Error('ZCode 写入任务失败'));return {request,phase:'uncertain',error};}
    return {request,phase:'written'};
  }
  close(){if(this.closed)return;this.exit(Error('ZCode 连接已关闭'));this.child.stdin?.end();this.child.kill();}
}

const workspace=(cwd:string)=>({workspacePath:cwd,workspaceKey:cwd});
function modelRef(model:string,effort?:string){
  const slash=model.indexOf('/');if(slash<1||slash===model.length-1)throw Error('ZCode 模型引用无效，请刷新模型目录');
  return {providerId:decodeURIComponent(model.slice(0,slash)),modelId:decodeURIComponent(model.slice(slash+1)),...(effort?{options:{reasoningLevel:effort}}:{})};
}
const modelId=(ref:any)=>encodeURIComponent(ref.providerId)+'/'+encodeURIComponent(ref.modelId);
async function connect(executable:AgentExecutable,cwd:string,reverse:ReverseRequest,launch:typeof execa){
  const cli=executable.args?.[0]||executable.command,env=await zcodeEnvironment(cli),account=await readZcodeAccount(env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE);
  const connection=new ZcodeConnection(executable,cwd,env,async(method,params)=>{
    if(method==='session/requestRuntimePreferences')return {nativeSearchEnhancementsEnabled:true,askUserQuestionAutoResolutionEnabled:false};
    // A desktop-materialized runtime can keep this capability after the desktop disconnects.
    // Use the native fallback contract; built-in agents remain available without a profile host.
    if(method==='subagents/readRuntimeConfig')return {kind:'built-in-fallback'};
    if(method==='interaction/requestProviderRuntimeHeaders')return account.auth(params);
    return reverse(method,params);
  },launch);
  try{await connection.request('provider/updateAccountConfig',account.snapshot);return {connection,account};}catch(error){connection.close();throw error;}
}

export async function readZcodeCatalog(executable:AgentExecutable,cwd:string,launch:typeof execa=execa){
  const {connection,account}=await connect(executable,cwd,async()=>{throw Error('目录读取不支持交互');},launch);
  const sessionId='sess_gateway_catalog_'+randomUUID();let created=false;
  try{
    const snapshot=await connection.request('session/create',{sessionId,workspace:workspace(cwd),persistence:'deferred',titleGenerationEnabled:false});created=true;
    const available=(snapshot.settings?.model?.available||[]).filter((entry:any)=>!entry.disabledReason);
    registerZcodeModelWindows(available);
    const models:PickerModel[]=available.map((entry:any)=>({model:'zcode::'+modelId(entry.ref),displayName:'ZCode · '+entry.label,shortName:entry.label,harness:'zcode',providerId:entry.ref.providerId,providerName:entry.providerLabel||entry.ref.providerId,supportedReasoningEfforts:(entry.reasoning?.levels||[]).map((level:any)=>({reasoningEffort:level.value})),defaultReasoningEffort:entry.reasoning?.defaultLevel}));
    if(!models.length)throw Error(account.reason||'ZCode 当前账号没有可用模型，请在 ZCode 桌面端检查登录和套餐');
    return {models,supportsImages:available.some((entry:any)=>entry.properties?.inputFormat?.supportsImage===true),supportsPlanMode:true};
  }finally{if(created)await connection.request('session/close',{sessionId,expectedPersistence:'deferred'}).catch(()=>{});connection.close();}
}

export function zcodeUsageSnapshot(usage:any,projection:any={}){
  return {cumulative:true,input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,total_tokens:usage.totalTokens,thinking_tokens:usage.reasoningTokens,cache_read_input_tokens:usage.cacheReadTokens,cache_creation_input_tokens:usage.cacheCreationTokens,context_used:projection.contextUsed,context_window:projection.contextWindow};
}

type RunOptions={executable:AgentExecutable;cwd:string;session?:string;model:string;effort?:string;mode?:string;permission?:string;prompt:string;images?:{absolutePath:string;name:string;mime:string}[];approve:(params:any)=>Promise<boolean>;ask:(params:any)=>Promise<Record<string,string>|null>;recovery?:{enabled:()=>Promise<boolean>;delay:(attempt:number)=>number}};
/** Emits the existing timeline wire format; only this adapter knows ZCode's event schema. */
export function zcodeRun(options:RunOptions,launch:typeof execa=execa,terminate:typeof execa=execa){
  const stdout=new PassThrough(),stderr=new PassThrough();let connection:ZcodeConnection|undefined,sessionId=options.session,ending=false,stopped=false;
  const dispatch=createAcpDispatch();let dispatchPhase:AcpDispatch['phase']='not_started',dispatchError:unknown,sessionReady=!!options.session;
  const settleDispatch=()=>dispatch.settle({phase:dispatchPhase,...(dispatchError?{error:dispatchError}:{}),...(sessionReady&&sessionId?{session:sessionId}:{})});
  let resolveDone!:(value:{exitCode:number})=>void;
  const done=new Promise<{exitCode:number}>(resolve=>resolveDone=resolve);
  let settled=false;
  let steering=0,checkingCompletion=false;
  let terminal:{payload:any;failed:boolean}|undefined;
  const write=(record:any)=>{if(!settled&&!stdout.destroyed)stdout.write(JSON.stringify(record)+'\n');};
  const tools=zcodeToolStream(write),recovery=options.recovery||{enabled:zcodeRecoveryEnabled,delay:zcodeRecoveryDelay};
  let retryWait:AbortController|undefined,retryAttempt=0;
  const mode=options.mode==='plan'?'plan':options.permission==='full'?'yolo':options.permission==='auto'?'edit':'build';
  let desktopWarning=false;
  const syncDesktop=(status:'running'|'completed'|'error'|'interrupted')=>{
    if(!sessionId)return;
    try{syncZcodeDesktopSession(sessionId,{title:options.prompt,model:decodeURIComponent(options.model),mode,status});}
    catch(reason){if(!desktopWarning){desktopWarning=true;stderr.write(`ZCode 桌面会话索引同步失败：${reason instanceof Error?reason.message:String(reason)}\n`);}}
  };
  const finish=(exitCode:number)=>{if(settled)return;settleDispatch();settled=true;retryWait?.abort();connection?.close();stdout.end();stderr.end();resolveDone({exitCode});};
  const error=(reason:unknown)=>{if(ending)return;if(dispatchPhase!=='written'&&!dispatchError)dispatchError=reason;settleDispatch();ending=true;syncDesktop('error');write({type:'result',is_error:true,result:reason instanceof Error?reason.message:'ZCode 执行失败'});finish(1);};
  const settleTerminal=async()=>{
    if(ending||checkingCompletion||steering||!terminal)return;
    const current=terminal;checkingCompletion=true;
    try{
      const [usage,snapshot]=await Promise.all([connection!.request('session/usage',{sessionId}),connection!.request('session/read',{sessionId,contentProfile:'index'})]);
      // A guide can fall back to ZCode's own queue. Keep its process alive until
      // those inputs drain and their resulting turn ends instead of losing them.
      if(ending||terminal!==current||steering||snapshot.projection?.pendingSteerInputs?.length)return;
      const {payload,failed}=current;
      if(!stopped&&failed&&isZcodeBusyError(payload.error||payload)&&await recovery.enabled()){
        if(ending||stopped||terminal!==current||steering)return;
        const wait=new AbortController();retryWait=wait;
        const attempt=++retryAttempt,waitMs=recovery.delay(attempt),until=Date.now()+waitMs;
        write({type:'system',subtype:'api_retry',attempt,message:`模型当前繁忙，${Math.ceil(waitMs/1000)} 秒后自动重试（第 ${attempt} 次）`});
        try{
          while(Date.now()<until){
            await delay(Math.min(1000,until-Date.now()),undefined,{signal:wait.signal});
            if(!await recovery.enabled())break;
          }
          if(ending||stopped||terminal!==current||steering)return;
          if(await recovery.enabled()){
            // Native retryTurn rewinds the conversation and can rerun committed tools.
            // Continue in the original session instead, with an identifiable recovery input.
            terminal=undefined;
            await connection!.request('session/send',{sessionId,content:zcodeRecoveryPrompt,modelSelection:modelRef(options.model,options.effort),inputId:zcodeRecoveryInputPrefix+randomUUID()});
            return;
          }
        }catch(reason){if(wait.signal.aborted)return;throw reason;}
        finally{if(retryWait===wait)retryWait=undefined;}
      }
      if(ending||terminal!==current)return;
      ending=true;
      syncDesktop(stopped?'interrupted':failed?'error':'completed');
      write({type:'result',is_error:failed,result:failed?payload.error?.message||'ZCode 执行失败':payload.response||'',usage:zcodeUsageSnapshot(usage,snapshot.projection)});
      finish(failed?1:0);
    }catch(reason){if(!ending){ending=true;syncDesktop(stopped?'interrupted':current.failed?'error':'completed');write({type:'result',is_error:true,result:reason instanceof Error?reason.message:'ZCode 结果读取失败'});finish(1);}}
    finally{checkingCompletion=false;if(!ending&&terminal&&terminal!==current)void settleTerminal();}
  };
  const complete=(payload:any,failed=false)=>{
    terminal={payload,failed};void settleTerminal();
  };
  const onEvent=(method:string,event:any)=>{
    if(method!=='session/event'||event.sessionId!==sessionId||ending)return;
    const payload=event.payload||{};
    if(event.type==='turn.started'){terminal=undefined;retryWait?.abort();}
    if(event.type==='model.streaming'&&payload.kind==='text_delta'&&typeof payload.delta==='string')write({type:'assistant',message:{id:payload.partId||payload.assistantMessageId||event.turnId,content:[{type:'text',text:payload.delta}]}});
    tools(event.type,payload);
    if(event.type==='turn.completed'||event.type==='turn.failed')complete(payload,event.type==='turn.failed'||payload.resultType?.startsWith('error'));
  };
  // Startup is deferred so AgentSessions registers the active run before reverse requests arrive.
  setImmediate(()=>{void (async()=>{
    const opened=await connect(options.executable,options.cwd,async(method,params)=>{
      if(params.sessionId&&params.sessionId!==sessionId)throw Error('ZCode 交互会话不匹配');
      if(method==='interaction/requestPermission'){
        const accepted=options.permission==='full'||await options.approve({toolCall:{title:params.toolName,rawInput:params.input}});
        return {decision:accepted?'allow':'deny'};
      }
      if(method==='interaction/requestUserInput'){
        const questions=params.questions||[{question:params.prompt||'请输入回答',header:'提问',options:[]}],answers=await options.ask({questions});
        return answers?{action:'accept',content:{answers}}:{action:'cancel'};
      }
      throw Object.assign(Error('ZCode 此交互尚未接入：'+method),{code:-32601});
    },launch);
    connection=opened.connection;connection.onEvent=onEvent;connection.onExit=reason=>{if(!ending)error(reason);};
    if(stopped){ending=true;finish(0);return;}
    if(sessionId)await connection.request('session/resume',{sessionId,workspace:workspace(options.cwd)});
    else{
      sessionId='sess_'+randomUUID();
      await connection.request('session/create',{sessionId,workspace:workspace(options.cwd),persistence:'immediate',titleGenerationEnabled:false,model:modelRef(options.model,options.effort)});
      sessionReady=true;
    }
    write({type:'system',session_id:sessionId,model:decodeURIComponent(options.model.slice(options.model.indexOf('/')+1))});
    await connection.request('session/setMode',{sessionId,mode});
    await connection.request('session/subscribe',{sessionId,deliveryKind:'desktop-continuous'});
    if(stopped){ending=true;finish(0);return;}
    const attempt=connection.attemptSend({sessionId,content:options.prompt,modelSelection:modelRef(options.model,options.effort),inputId:randomUUID(),...(options.images?.length?{attachments:options.images.map(image=>({type:'image',path:image.absolutePath,mimeType:image.mime,name:image.name}))}:{})});
    dispatchPhase=attempt.phase;dispatchError=attempt.error;settleDispatch();
    await attempt.request;
    if(!ending)syncDesktop('running');
  })().catch(error);});
  return {stdout,stderr,promptDispatch:dispatch.promise,then:done.then.bind(done),get pid(){return connection?.child.pid;},
    async steer(prompt:string,images:RunOptions['images']=[]){
      if(ending||stopped||!connection||!sessionId)throw Error('当前 ZCode 轮次不可引导，消息仍保留在队列中');
      steering++;
      try{
        const result=await connection.request('v4/command',{commandId:randomUUID(),clientId:'codex-mobile-control',sessionId,type:'sendText',issuedAt:Date.now(),payload:{text:prompt,requestedDelivery:'guide',inputOrigin:'mobile',...(images?.length?{attachments:images.map(image=>({type:'image',path:image.absolutePath,mimeType:image.mime,name:image.name}))}:{})}});
        if(!['accepted','duplicate'].includes(result.status))throw Error(result.message||`ZCode 未接受引导消息（${result.reasonCode||result.status}）`);
        return result.result?.delivery;
      }finally{steering--;if(terminal)void settleTerminal();}
    },
    async interrupt(){
      stopped=true;
      if(retryWait&&terminal){ending=true;syncDesktop('interrupted');finish(0);return;}
      if(connection&&sessionId){
        try{
          await connection.request('session/stop',{sessionId},5000);
          let timer:ReturnType<typeof setTimeout>|undefined;
          try{await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}
        }catch(reason){if(connection.shared){stopped=false;throw reason;}/* Only independent runtimes can be terminated by this adapter. */}
        if(settled)return;
        if(connection.shared){stopped=false;throw Error('ZCode 尚未确认任务已停止，请重试');}
        if(process.platform==='win32'&&connection?.child.pid){
          const result=await terminate('taskkill.exe',['/PID',String(connection.child.pid),'/T','/F'],{windowsHide:true,reject:false});
          if(result.exitCode!==0&&!settled)throw Error('停止 ZCode 失败，请重试');
        }else if(connection?.child.kill()===false&&!settled)throw Error('停止 ZCode 失败，请重试');
      }
      ending=true;syncDesktop('interrupted');finish(0);
    },
    kill(){stopped=true;if(!ending){ending=true;syncDesktop('interrupted');finish(0);}return true;}};
}
