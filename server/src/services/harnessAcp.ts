import {execa} from 'execa';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import {acpFileChanges,editedFilePaths} from './agentFileChanges.js';
import {agentNames} from './agentProtocol.js';
import type {PickerModel} from './modelCatalog.js';
import {deepseekDesktopProviderPatch,deepseekDesktopReasoningModels,canonicalDeepseekModel} from './deepseekDesktopConfig.js';
import {opencodeAcpEnvironment,refreshOpencodeModels} from './opencodeConfig.js';
import {createOpencodePolicy,type OpencodePolicy} from './opencodePolicy.js';
import {piEcnuEnvironment} from './piEcnu.js';

type Harness='deepseek'|'hermes'|'opencode'|'pi'|'acp';
const scripts=fileURLToPath(new URL('../../scripts/',import.meta.url));
function launchSettings(agent:Harness,permission?:string,catalog=false,customArgs:string[]=[]){
  if(agent==='acp')return {args:customArgs,env:{}};
  if(agent==='pi')return {args:[],env:{}};
  if(agent==='opencode')return {args:['acp'],env:opencodeAcpEnvironment()};
  if(agent==='hermes')return {args:['acp'],env:{CMC_HERMES_ACP_EXTENSION:'1',PYTHONPATH:[path.join(scripts,'hermes-mobile-acp'),process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)}};
  const preset=permission==='full'?'danger-full-access':'workspace-write';
  const providerPatch=deepseekDesktopProviderPatch();
  const patchDirectory=permission||providerPatch.length||catalog?mkdtempSync(path.join(os.tmpdir(),'cmc-dsh-policy-')):undefined;
  const patch=patchDirectory&&path.join(patchDirectory,'policy.yml');
  if(patch){
    const entries=[...providerPatch,...(catalog?[{id:'session-persistence-jsonl',config:{root:path.join(patchDirectory!,'sessions')}},{id:'session-query-sqlite',config:{path:':memory:'}}]:[]),...(permission?[{insert:[{id:'cmc-mobile-permission',name:path.join(scripts,'deepseek-mobile-policy.mjs')}]}]:[])];
    writeFileSync(patch,JSON.stringify(entries),{mode:0o600});
  }
  return {args:['--profile','acp',...(patch?['--patch',patch]:[])],env:{DSH_PERMISSION_MODE:preset,CMC_DSH_PERMISSION_PRESET:preset},patchDirectory};
}
const initialize={protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'codex-mobile-control',version:'0.6.0'}};

// The harness owns its filesystem and tools; advertise no client services we cannot supply.
class AcpConnection {
  child:any;
  private reader!:ReturnType<typeof createInterface>;
  private ready:Promise<void>;
  private opencodePolicy?:OpencodePolicy;
  private sequence=0;
  private patchDirectory?:string;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer?:NodeJS.Timeout}>();
  stderr='';
  private permissionAdapterReady=false;
  onRequest:(message:any)=>void=message=>this.send({id:message.id,error:{code:-32601,message:'Client method not supported'}});
  onPolicyRequest:(params:any)=>Promise<boolean>=async()=>false;
  onUpdate:(params:any)=>void=()=>{};
  constructor(readonly agent:Harness,command:string,cwd:string,launch:typeof execa,private terminate:typeof execa=execa,permission?:string,catalog=false,customArgs:string[]=[]){
    const settings=launchSettings(agent,permission,catalog,customArgs);
    if(agent==='pi')settings.env={...settings.env,PATH:[path.dirname(command),process.env.PATH].filter(Boolean).join(path.delimiter)};
    this.patchDirectory='patchDirectory' in settings?settings.patchDirectory:undefined;
    const start=(env:Record<string,string>)=>{
      this.child=launch(command,settings.args,{cwd,env,windowsHide:true,reject:false,buffer:false,stdin:'pipe'});
      this.child.stderr?.on('data',(chunk:Buffer)=>{this.stderr=(this.stderr+chunk.toString()).slice(-6000);if(this.stderr.includes('CMC_DSH_PERMISSION_ADAPTER_READY'))this.permissionAdapterReady=true;});
      this.reader=createInterface({input:this.child.stdout});
      this.reader.on('line',line=>{
        let message:any;try{message=JSON.parse(line);}catch{return;}
        if(message.id!==undefined&&!message.method){
          const waiter=this.pending.get(message.id);if(!waiter)return;
          this.pending.delete(message.id);clearTimeout(waiter.timer);
          if(message.error)waiter.reject(Error([message.error.message,typeof message.error.data==='string'?message.error.data:message.error.data?.message||message.error.data?.details].filter(Boolean).join('：')||'ACP 请求失败'));
          else waiter.resolve(message.result);return;
        }
        if(message.id!==undefined&&message.method)this.onRequest(message);
        else if(message.method==='session/update')this.onUpdate(message.params);
      });
      void Promise.resolve(this.child).then(result=>this.exited(`进程已退出（${result.exitCode}）`),error=>this.exited(error.message));
    };
    if(agent==='opencode'&&permission)this.ready=createOpencodePolicy(params=>this.onPolicyRequest(params)).then(policy=>{this.opencodePolicy=policy;start({...settings.env,...policy.env});});
    else if(agent==='pi')this.ready=piEcnuEnvironment().then(env=>{start({...settings.env,...env});});
    else{start(settings.env);this.ready=Promise.resolve();}
  }
  private exited(reason:string){for(const waiter of this.pending.values()){clearTimeout(waiter.timer);waiter.reject(Error(`${agentNames[this.agent]} ${reason}${this.stderr?'：'+this.stderr:''}`));}this.pending.clear();}
  send(message:any){if(this.child?.stdin?.writable)this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');}
  assertPermissionAdapter(){
    if(this.agent==='deepseek'&&!this.permissionAdapterReady)throw Error('DeepSeek 权限适配器未加载，已停止发送任务，请更新电脑网关');
    if(this.agent==='opencode'&&!this.opencodePolicy?.ready)throw Error('OpenCode 权限插件未加载，已停止发送任务，请更新电脑网关');
  }
  // Prompt-only dispatch: register the JSON-RPC pending entry before touching
  // stdin so an immediate synchronous reply can be matched, and report whether
  // the write actually happened. Must be called after `ready` has resolved.
  attempt(method:string,params:any,timeout=0):{request:Promise<any>;write:'written'|'uncertain'|'not_started';error?:unknown}{
    const id=++this.sequence;
    let resolve!:(value:any)=>void,reject!:(error:Error)=>void;
    const request=new Promise<any>((res,rej)=>{resolve=res;reject=rej;});
    const timer=timeout?setTimeout(()=>{this.pending.delete(id);reject(Error(`${agentNames[this.agent]} ${method} 超时${this.stderr?'：'+this.stderr:''}`));},timeout):undefined;
    this.pending.set(id,{resolve,reject,timer});
    let payload:string;
    try{payload=JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n';}
    catch(error){this.pending.delete(id);clearTimeout(timer);const failure=Error(`${agentNames[this.agent]} 无法序列化 ${method} 消息`);reject(failure);return {request,write:'not_started',error};}
    const stdin=this.child?.stdin;
    if(!stdin?.writable){this.pending.delete(id);clearTimeout(timer);const failure=Error(`${agentNames[this.agent]} 标准输入不可写，任务未发送${this.stderr?'：'+this.stderr:''}`);reject(failure);return {request,write:'not_started',error:failure};}
    try{stdin.write(payload);}catch(error){this.pending.delete(id);clearTimeout(timer);const failure=Error(`${agentNames[this.agent]} 写入任务失败：${(error as Error)?.message||error}`);reject(failure);return {request,write:'uncertain',error};}
    return {request,write:'written'};
  }
  async request(method:string,params:any,timeout=30000):Promise<any>{
    await this.ready;
    return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=timeout?setTimeout(()=>{this.pending.delete(id);reject(Error(`${agentNames[this.agent]} ${method} 超时${this.stderr?'：'+this.stderr:''}`));},timeout):undefined;this.pending.set(id,{resolve,reject,timer});this.send({id,method,params});});
  }
  async cancelPolicy(){await this.ready.catch(()=>{});await this.opencodePolicy?.close();}
  async close(){
    await this.cancelPolicy();
    if(!this.child)return;
    this.child.stdin?.end();
    let timer:NodeJS.Timeout|undefined;
    const exited=await Promise.race([Promise.resolve(this.child).then(()=>true,()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),1500);})]).finally(()=>clearTimeout(timer));
    if(!exited){
      if(process.platform==='win32'&&this.child.pid){
        const result=await this.terminate('taskkill.exe',['/PID',String(this.child.pid),'/T','/F'],{windowsHide:true,reject:false});
        if(result.exitCode!==0){
          let raceTimer:NodeJS.Timeout|undefined;
          const alreadyExited=await Promise.race([Promise.resolve(this.child).then(()=>true,()=>true),new Promise<boolean>(resolve=>{raceTimer=setTimeout(()=>resolve(false),1000);})]).finally(()=>clearTimeout(raceTimer));
          if(!alreadyExited){this.reader.close();throw Error(`${agentNames[this.agent]} 进程收尾失败（taskkill ${result.exitCode}）`);}
        }
      }else this.child.kill();
    }
    await Promise.resolve(this.child).catch(()=>{});this.reader.close();
    if(this.patchDirectory)rmSync(this.patchDirectory,{recursive:true,force:true});
  }
}

function selectOptions(options:any[]):any[]{return options.flatMap(option=>Array.isArray(option.options)?selectOptions(option.options):[option]);}
function modelOptions(options:any[],providerName?:string):any[]{return options.flatMap(option=>Array.isArray(option.options)?modelOptions(option.options,option.name||providerName):[{...option,...(providerName?{providerName}:{})}]);}
function opencodeModelLabels(entry:any){
  const id=String(entry.value),separator=id.indexOf('/'),providerId=separator>0?id.slice(0,separator):undefined;
  const name=String(entry.name||id),nameSeparator=name.indexOf('/');
  const providerName=entry.providerName||(nameSeparator>0?name.slice(0,nameSeparator):providerId);
  const shortName=entry.providerName?(name.startsWith(entry.providerName+'/')?name.slice(entry.providerName.length+1):name):nameSeparator>0?name.slice(nameSeparator+1):name;
  return {...(providerId?{providerId}:{}),...(providerName?{providerName}:{}),shortName};
}
function compareOpencodeModels(a:PickerModel,b:PickerModel){return (a.providerId||'').localeCompare(b.providerId||'')||(a.model==='opencode::default'?-1:b.model==='opencode::default'?1:0)||(a.shortName||a.displayName).localeCompare(b.shortName||b.displayName);}
function configOption(state:any,category:string,id=category):any{return (state?.configOptions||[]).find((option:any)=>option.category===category||option.id===id);}
function sessionModes(state:any):string[]{
  const option=configOption(state,'mode');
  return option?selectOptions(option.options||[]).map(entry=>entry.value).filter(value=>typeof value==='string')
    :(state?.modes?.availableModes||[]).map((entry:any)=>entry.id).filter((value:any)=>typeof value==='string');
}

async function opencodeReasoningCatalog(connection:AcpConnection,state:any,sessionId:string,agent:Harness='opencode'){
  const model=configOption(state,'model');
  if(!model||typeof model.currentValue!=='string')return state;
  const originalEffort=configOption(state,'thought_level','reasoning_effort')?.currentValue;
  const metadata:any[]=[];
  const capture=(id:string,value:any)=>{
    const option=configOption(value,'thought_level','reasoning_effort');
    const efforts=selectOptions(option?.options||[]).map(entry=>entry.value).filter(value=>typeof value==='string'&&value);
    metadata.push({modelId:id,efforts,...(typeof option?.currentValue==='string'&&efforts.includes(option.currentValue)?{defaultEffort:option.currentValue}:{})});
  };
  capture(model.currentValue,state);
  // Select only within this disposable catalog session. These are configuration
  // requests, never prompts; unknown models keep an empty effort list.
  const deadline=Date.now()+12000;
  let selected=false;
  try{
    for(const entry of selectOptions(model.options||[])){
      if(typeof entry.value!=='string'||entry.value===model.currentValue)continue;
      if(agent==='pi'&&!/^ecnu\/ecnu-(max|plus)$/.test(entry.value))continue;
      const remaining=deadline-Date.now();if(remaining<=0)break;
      try{
        selected=true;
        const changed=await connection.request('session/set_config_option',{sessionId,configId:model.id,value:entry.value},Math.min(remaining,3000));
        if(configOption(changed,'model')?.currentValue===entry.value)capture(entry.value,changed);
      }catch{/* Missing effort metadata must not invent a model capability. */}
    }
  }finally{
    if(selected){
      const restored=await connection.request('session/set_config_option',{sessionId,configId:model.id,value:model.currentValue},3000);
      if(configOption(restored,'model')?.currentValue!==model.currentValue)throw Error('OpenCode 目录探测后未能恢复原模型');
      if(typeof originalEffort==='string'){
        const option=configOption(restored,'thought_level','reasoning_effort');
        if(!option)throw Error('OpenCode 目录探测后未能恢复原思考强度');
        const restoredEffort=await connection.request('session/set_config_option',{sessionId,configId:option.id,value:originalEffort},3000);
        if(configOption(restoredEffort,'thought_level','reasoning_effort')?.currentValue!==originalEffort)throw Error('OpenCode 目录探测后未能恢复原思考强度');
      }
    }
  }
  return {...state,_meta:{...state._meta,reasoningModels:metadata}};
}
function catalogFromSession(agent:Harness,state:any):PickerModel[]{
  const options=state?.configOptions||[],modelOption=options.find((o:any)=>o.category==='model'||o.id==='model');
  const reasoning=options.find((o:any)=>o.category==='thought_level'||o.id==='reasoning_effort');
  const current=agent==='deepseek'?canonicalDeepseekModel(modelOption?.currentValue||state?.models?.currentModelId||''):modelOption?.currentValue||state?.models?.currentModelId;
  const rawEntries:any[]=modelOption?(agent==='opencode'?modelOptions(modelOption.options||[]):selectOptions(modelOption.options||[])):(state?.models?.availableModels||[]).map((m:any)=>({value:m.modelId,name:m.name}));
  const entries=[...new Map(rawEntries.map(e=>{const value=agent==='deepseek'?canonicalDeepseekModel(e.value):e.value;return [value,{...e,value}];})).values()];
  const efforts=selectOptions(reasoning?.options||[]).filter(o=>typeof o.value==='string'&&o.value).map(o=>({reasoningEffort:o.value}));
  const label=(entry:any)=>agent==='hermes'?String(entry.name||entry.value).split(' · ').at(-1):entry.name||entry.value;
  const perModel=state?._meta?.reasoningModels||[];
  // DeepSeek's ACP advertises thought levels only for its current model. The
  // desktop's explicit declarations also describe the other configured routes.
  const declared=agent==='deepseek'?deepseekDesktopReasoningModels():new Map<string,{efforts:string[];defaultEffort?:string}>();
  const modelEfforts=(value:string)=>perModel.find((m:any)=>m.modelId===value)?.efforts?.map((level:string)=>({reasoningEffort:level}))||declared.get(value)?.efforts.map(reasoningEffort=>({reasoningEffort}))||(value===current?efforts:[]);
  const models:PickerModel[]=entries.filter(e=>typeof e.value==='string'&&e.value).map(e=>{
    const defaultEffort=declared.get(e.value)?.defaultEffort||perModel.find((entry:any)=>entry.modelId===e.value)?.defaultEffort||(e.value===current?reasoning?.currentValue:agent==='hermes'&&modelEfforts(e.value).length?'default':undefined);
    return {model:`${agent}::${e.value}`,displayName:`${agentNames[agent]} · ${label(e)}`,...(agent==='opencode'?opencodeModelLabels(e):{}),supportedReasoningEfforts:modelEfforts(e.value),...(defaultEffort?{defaultReasoningEffort:defaultEffort}:{})};
  });
  const selected=entries.find(e=>e.value===current);
  const defaultEffort=declared.get(current)?.defaultEffort||reasoning?.currentValue;
  const defaultLabels=agent==='opencode'&&selected?opencodeModelLabels(selected):undefined;
  models.unshift({model:`${agent}::default`,displayName:`${agentNames[agent]} · ${selected?`${label(selected)}（默认）`:'默认模型'}`,...(defaultLabels?{...defaultLabels,shortName:defaultLabels.shortName+'（默认）'}:{}),supportedReasoningEfforts:modelEfforts(current),...(defaultEffort?{defaultReasoningEffort:defaultEffort}:{})});
  return agent==='opencode'?models.sort(compareOpencodeModels):models;
}

export async function readHarnessCatalog(agent:Harness,command:string,cwd:string,launch:typeof execa=execa,refresh=false,customArgs:string[]=[]){
  if(agent==='opencode')await refreshOpencodeModels(command,cwd,launch,refresh);
  const connection=new AcpConnection(agent,command,cwd,launch,execa,undefined,true,customArgs);
  let session:string|undefined,canClose=false;
  try{
    const init=await connection.request('initialize',initialize,20000);
    canClose=init.agentCapabilities?.sessionCapabilities?.close!=null;
    // Standard ACP catalogs are session-scoped; this creates no prompt or model invocation.
    let state=await connection.request('session/new',{cwd,mcpServers:[]},20000);session=state.sessionId;
    if((agent==='opencode'||agent==='pi')&&session)state=await opencodeReasoningCatalog(connection,state,session,agent);
    return {models:catalogFromSession(agent,state),supportsImages:init.agentCapabilities?.promptCapabilities?.image===true,supportsPlanMode:sessionModes(state).includes('plan')};
  }finally{
    if((agent==='deepseek'||canClose)&&session)await connection.request('session/close',{sessionId:session},3000).catch(()=>{});
    await connection.close();
  }
}

export function harnessAcp(options:{agent:Harness;command:string;cwd:string;session?:string;model?:string;effort?:string;mode?:string;permission?:string;content:any[];approve:(params:any)=>Promise<boolean>;customArgs?:string[]},launch:typeof execa=execa,terminate:typeof execa=execa){
  const connection=new AcpConnection(options.agent,options.command,options.cwd,launch,terminate,options.permission||'ask',false,options.customArgs);
  const stdout=new PassThrough(),stderr=new PassThrough();
  let session=options.session,promptStarted=false,stopped=false,settled=false,contextWindow:number|undefined,contextUsed:number|undefined,actualModel:string|undefined;
  let dispatchPhase:'written'|'not_started'|'uncertain'='not_started',dispatchError:unknown;
  let resolveDispatch!:(value:{phase:'written'|'not_started'|'uncertain';error?:unknown;session?:string;actualModel?:string})=>void;
  const promptDispatch=new Promise<{phase:'written'|'not_started'|'uncertain';error?:unknown;session?:string;actualModel?:string}>(resolve=>{resolveDispatch=resolve;});
  // Dispatch status must be available as soon as the prompt write is attempted,
  // not when the whole turn settles; every path resolves exactly once.
  let dispatchResolved=false;
  const settleDispatch=()=>{
    if(dispatchResolved)return;dispatchResolved=true;
    resolveDispatch({phase:dispatchPhase,...(dispatchPhase!=='written'&&dispatchError?{error:dispatchError}:{}),...(session?{session}:{}),...(actualModel!==undefined?{actualModel}:{})});
  };
  const tools=new Map<string,any>(),completed=new Set<string>();let config:any[]=[];
  const permissionDecisions=new Map<string,Promise<boolean>>();
  const emit=(message:any)=>stdout.write(JSON.stringify(message)+'\n');
  const enrichPermission=(params:any)=>({...params,toolCall:{...tools.get(params?.toolCall?.toolCallId),...params?.toolCall}});
  const permissionKey=(params:any)=>`${params?.sessionId||session}\0${params?.toolCall?.toolCallId}`;
  const evaluatePermission=async(params:any)=>{
    const workspaceEdit=params.toolCall?.kind==='edit'&&params.toolCall?.locations?.length&&params.toolCall.locations.every((location:any)=>{if(typeof location.path!=='string')return false;const relative=path.relative(options.cwd,path.resolve(options.cwd,location.path));return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);});
    if(stopped)return false;
    if(options.permission==='full'||options.permission==='auto'&&workspaceEdit)return true;
    return options.approve(params).then(accepted=>!stopped&&accepted===true,()=>false);
  };
  const decidePermission=(params:any):Promise<boolean>=>{
    if(stopped)return Promise.resolve(false);
    if(options.agent!=='opencode'||typeof params?.toolCall?.toolCallId!=='string'||!params.toolCall.toolCallId)return evaluatePermission(params);
    const key=permissionKey(params);
    let decision=permissionDecisions.get(key);
    if(!decision){decision=Promise.resolve().then(()=>evaluatePermission(params)).catch(()=>false);permissionDecisions.set(key,decision);}
    return decision.then(accepted=>!stopped&&accepted);
  };
  connection.onPolicyRequest=data=>decidePermission(enrichPermission(data));
  connection.onRequest=message=>{
    if(message.method!=='session/request_permission'){connection.send({id:message.id,error:{code:-32601,message:'Client method not supported'}});return;}
    const params=enrichPermission(message.params);
    const respond=(accepted:boolean)=>{const choices=message.params.options||[],choice=choices.find((o:any)=>o.kind===(accepted?'allow_once':'reject_once'))||choices.find((o:any)=>String(o.kind).startsWith(accepted?'allow':'reject'));connection.send({id:message.id,result:{outcome:choice?{outcome:'selected',optionId:choice.optionId}:{outcome:'cancelled'}}});};
    void decidePermission(params).then(respond,()=>respond(false));
  };
  connection.onUpdate=params=>{
    if(params?.sessionId===session&&params?.update?.sessionUpdate==='config_option_update')config=params.update.configOptions||[];
    if(!promptStarted||params?.sessionId!==session||params?._meta?.isReplay||params?.update?._meta?.isReplay)return;
    const update=params?.update;if(!update)return;
    if(update.sessionUpdate==='plan')emit({type:'plan',entries:update.entries});
    if(update.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text')emit({type:'assistant',message:{id:update.messageId||'reply',content:[{type:'text',text:update.content.text}]}});
    if(update.sessionUpdate==='usage_update'){contextWindow=Number.isFinite(update.size)?update.size:contextWindow;contextUsed=Number.isFinite(update.used)?update.used:contextUsed;}
    if(update.sessionUpdate==='tool_call'||update.sessionUpdate==='tool_call_update'){
      const id=update.toolCallId,previous=tools.get(id),tool={...previous,...update};tools.set(id,tool);
      if(!previous||JSON.stringify([previous.title,previous.kind,previous.rawInput])!==JSON.stringify([tool.title,tool.kind,tool.rawInput]))emit({type:'assistant',message:{content:[{type:'tool_use',id,name:tool.title||tool.kind||'工具',input:tool.rawInput||{}}]}});
      if(['completed','failed'].includes(tool.status)&&!completed.has(id)){
        permissionDecisions.delete(`${params.sessionId}\0${id}`);
        completed.add(id);
        const text=(tool.content||[]).map((c:any)=>c.type==='content'&&c.content?.type==='text'?c.content.text:'').filter(Boolean).join('\n');
        const change=acpFileChanges(tool.content||[])||(()=>{const files=editedFilePaths(tool.title,tool.rawInput);return files.length?{files}:undefined;})();
        emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:text,is_error:tool.status==='failed',file_change:tool.status==='completed'?change:undefined}]}});
      }
    }
  };
  const done=(async()=>{
    try{
      const init=await connection.request('initialize',initialize);
      if(options.content.some(c=>c.type==='image')&&init.agentCapabilities?.promptCapabilities?.image!==true)throw Error(`${agentNames[options.agent]} 当前模型不支持图片消息`);
      const canResume=options.agent==='deepseek'||(options.agent==='opencode'||options.agent==='pi'||options.agent==='acp')&&init.agentCapabilities?.sessionCapabilities?.resume!=null;
      if((options.agent==='pi'||options.agent==='acp')&&session&&!canResume&&init.agentCapabilities?.loadSession!==true)throw Error(`${agentNames[options.agent]} 未声明恢复会话能力，未创建替代会话`);
      if(options.agent==='opencode'&&session&&!canResume&&init.agentCapabilities?.loadSession!==true)throw Error('OpenCode ACP 未声明恢复会话能力，未创建替代会话');
      const state=await connection.request(session?(canResume?'session/resume':'session/load'):'session/new',{...(session?{sessionId:session}:{}),cwd:options.cwd,mcpServers:[]});
      if(options.agent==='deepseek'&&session&&state?.sessionId&&state.sessionId!==session)throw Error('DeepSeek 恢复会话返回了不同的会话编号，请检查原会话后重试');
      session=session||state?.sessionId;if(!session)throw Error('ACP 未返回会话编号');
      // Save the native identity before configuration can fail, so a retry resumes
      // this session instead of creating another conversation.
      emit({type:'system',session_id:session});
      connection.assertPermissionAdapter();
      config=state?.configOptions||[];
      const requestedModel=options.agent==='deepseek'?canonicalDeepseekModel(options.model&&options.model!=='default'?options.model:config.find((o:any)=>o.id==='model'||o.category==='model')?.currentValue||state?.models?.currentModelId||''):options.model;
      if(requestedModel&&requestedModel!=='default'){
        if(options.agent==='deepseek'||(options.agent==='opencode'||options.agent==='pi'||options.agent==='acp')&&configOption({configOptions:config},'model')){
          const modelOption=configOption({configOptions:config},'model');
          if(options.agent==='opencode'&&!selectOptions(modelOption.options||[]).some(entry=>entry.value===requestedModel))throw Error('模型已不在当前可用目录，请重新选择');
          const configId=options.agent==='deepseek'?'model':modelOption.id;
          config=(await connection.request('session/set_config_option',{sessionId:session,configId,value:requestedModel})).configOptions||[];
          if((options.agent==='opencode'||options.agent==='pi'||options.agent==='acp')&&configOption({configOptions:config},'model')?.currentValue!==requestedModel)throw Error(`${agentNames[options.agent]} 未确认所选模型已应用`);
        }
        else {
          const changed=await connection.request('session/set_model',{sessionId:session,modelId:options.model});
          if(changed?.configOptions)config=changed.configOptions;
          else if(options.agent==='hermes'&&options.effort&&options.effort!=='default')config=(await connection.request('session/load',{sessionId:session,cwd:options.cwd,mcpServers:[]})).configOptions||[];
        }
      }
      if(options.effort){
        const option=config.find((o:any)=>o.id==='reasoning_effort'||o.category==='thought_level');
        if(!option&&options.effort!=='default')throw Error(`${agentNames[options.agent]} 当前模型未提供推理强度切换`);
        if(option){
          if(options.agent==='opencode'&&!selectOptions(option.options||[]).some(entry=>entry.value===options.effort))throw Error('OpenCode 当前模型不支持所选推理强度');
          const changed=await connection.request('session/set_config_option',{sessionId:session,configId:option.id,value:options.effort});
          if(changed?.configOptions?.find((o:any)=>o.id===option.id)?.currentValue!==options.effort)throw Error(`${agentNames[options.agent]} 未确认思考强度已应用`);
        }
      }
      // Reset the session policy explicitly, including on resume; do not inherit a prior grant.
      if(options.agent==='hermes')await connection.request('session/set_mode',{sessionId:session,modeId:options.permission==='full'?'dont_ask':options.permission==='auto'?'accept_edits':'default'});
      if(options.agent!=='opencode'&&options.mode==='plan'){
        if(!sessionModes({...state,configOptions:config}).includes('plan'))throw Error(`${agentNames[options.agent]} 当前配置未提供计划模式`);
        await connection.request('session/set_mode',{sessionId:session,modeId:'plan'});
      }
      if(options.agent==='opencode'){
        const modes=sessionModes({...state,configOptions:config}),modeId=options.mode==='plan'?'plan':modes.includes('build')?'build':configOption({configOptions:config},'mode')?.currentValue||state?.modes?.currentModeId;
        if(options.mode==='plan'&&!modes.includes('plan'))throw Error('OpenCode ACP 当前配置未提供计划模式');
        if(modeId){
          const changed=await connection.request('session/set_mode',{sessionId:session,modeId});
          if(changed?.configOptions)config=changed.configOptions;
        }
      }
      actualModel=requestedModel&&requestedModel!=='default'?requestedModel:config.find((o:any)=>o.id==='model'||o.category==='model')?.currentValue||state?.models?.currentModelId;
      emit({type:'system',session_id:session,model:actualModel});
      if(stopped)return {exitCode:0};
      promptStarted=true;
      const prompt=options.content.map(c=>c.type==='image'?{type:'image',mimeType:c.source.media_type,data:c.source.data}:c);
      const attempt=connection.attempt('session/prompt',{sessionId:session,prompt},0);
      dispatchPhase=attempt.write;if(attempt.error)dispatchError=attempt.error;
      settleDispatch();
      const result=await attempt.request;
      const u=result?.usage||result?._meta?.usage;
      if(result?.stopReason==='cancelled'&&!stopped)throw Error('任务被助手取消');
      emit({type:'result',session_id:session,model:actualModel,is_error:false,result:'',usage:u||contextWindow?{...(u?{input_tokens:u.inputTokens,output_tokens:u.outputTokens,total_tokens:u.totalTokens,cache_read_input_tokens:u.cachedReadTokens,thinking_tokens:u.thoughtTokens}:{}),context_window:contextWindow,context_used:contextUsed}:undefined});
      return {exitCode:0};
    }catch(error){
      if(!stopped&&dispatchPhase!=='written'&&!dispatchError)dispatchError=error;
      settleDispatch();
      const detail=String((error as Error).message);stderr.write(detail);emit({type:'result',is_error:true,result:detail});return {exitCode:1};}
    finally{
      settleDispatch();
      try{await connection.close();}
      finally{stdout.end();stderr.end();settled=true;}
    }
  })();
  const interrupt=async()=>{
    stopped=true;await connection.cancelPolicy();if(session&&promptStarted)connection.send({method:'session/cancel',params:{sessionId:session}});
    let timer:NodeJS.Timeout|undefined;
    await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]).finally(()=>clearTimeout(timer));
    if(!settled){
      if(process.platform==='win32'&&connection.child.pid){const result=await terminate('taskkill.exe',['/PID',String(connection.child.pid),'/T','/F'],{windowsHide:true,reject:false});if(result.exitCode!==0&&!settled)throw Error(`停止失败：${agentNames[options.agent]} 仍在运行（taskkill ${result.exitCode}）`);}
      else if(connection.child.kill()===false&&!settled)throw Error('停止失败：后台进程仍在运行');
      await done;
    }
  };
  return {get pid(){return connection.child?.pid;},stdout,stderr,promptDispatch,then:done.then.bind(done),interrupt,kill(){void interrupt();return true;}};
}
