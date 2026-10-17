import {execa} from 'execa';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {acpFileChanges} from './agentFileChanges.js';
import type {PickerModel} from './modelCatalog.js';

export type OfficialAcpAgent='claude'|'antigravity';
export function officialAcpExecutable(agent:OfficialAcpAgent){
  if(agent==='claude'){
    const require=createRequire(import.meta.url);
    return {command:process.execPath,args:[require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')]};
  }
  const command=process.env.CODEX_MOBILE_CONTROL_AGY_ACP_BIN||fileURLToPath(new URL('../../runtime/antigravity-acp/agy_acp_server.exe',import.meta.url));
  if(!fs.existsSync(command))throw Error('未安装 Google Antigravity ACP 服务，请运行 scripts/install-antigravity-acp.ps1');
  return {command,args:[]};
}

// Discover the authenticated ACP session's catalog without sending a prompt or
// loading an existing user session. Authentication failures stay unavailable.
export async function readOfficialAcpCatalog(agent:OfficialAcpAgent,cwd:string,launch:typeof execa=execa,terminate:typeof execa=execa):Promise<{models:PickerModel[]}>{
  const executable=officialAcpExecutable(agent);
  const child=launch(executable.command,executable.args,{cwd,windowsHide:true,reject:false,buffer:false,stdin:'pipe'});
  let sequence=0,exited=false;
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  const send=(message:any)=>{if(child.stdin?.writable)child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');};
  const reader=createInterface({input:child.stdout!});
  child.stderr?.on('data',()=>{});
  reader.on('line',line=>{
    let message:any;try{message=JSON.parse(line);}catch{return;}
    if(message.method){if(message.id!==undefined)send({id:message.id,error:{code:-32601,message:'Catalog supplies no client services'}});return;}
    const waiter=pending.get(message.id);if(!waiter)return;
    pending.delete(message.id);clearTimeout(waiter.timer);
    if(message.error)waiter.reject(Error([-32000,-32001].includes(message.error.code)?`${agent==='antigravity'?'Google Antigravity':'Claude'} ACP 尚未就绪，请在该 ACP 服务完成独立认证`:`ACP 目录请求失败（${message.error.code}）`));
    else waiter.resolve(message.result);
  });
  void Promise.resolve(child).then(()=>{exited=true;for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error('ACP 目录进程已退出'));}pending.clear();},()=>{exited=true;for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error('ACP 目录进程无法启动'));}pending.clear();});
  const request=(method:string,params:any)=>new Promise<any>((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`ACP ${method} 目录检查超时`));},20000);pending.set(id,{resolve,reject,timer});send({id,method,params});});
  try{
    await request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'codex-mobile-control-catalog',version:'0.6.0'}});
    const state=await request('session/new',{cwd,mcpServers:[]});
    if(!state.sessionId)throw Error('ACP 未返回目录会话');
    if(!state.modes?.availableModes?.some((mode:any)=>mode.id==='default'))throw Error('ACP 未提供需要审批的默认权限模式');
    const options=state.configOptions||[],modelOption=options.find((option:any)=>option.category==='model'||option.id==='model');
    const flatten=(rows:any[]):any[]=>rows.flatMap(row=>Array.isArray(row.options)?flatten(row.options):[row]);
    const models=flatten(modelOption?.options||[]);
    const entries=models.length?models:(state.models?.availableModels||[]).map((model:any)=>({value:model.modelId,name:model.name}));
    const current=modelOption?.currentValue||state.models?.currentModelId;
    if(!entries.length&&current)entries.push({value:current,name:current});
    const effort=options.find((option:any)=>option.category==='thought_level'||/^(effort|reasoning_effort)$/.test(option.id));
    const levels=flatten(effort?.options||[]).filter((option:any)=>typeof option.value==='string').map((option:any)=>({reasoningEffort:option.value}));
    const result:PickerModel[]=entries.filter((entry:any)=>typeof entry.value==='string'&&entry.value).map((entry:any)=>({model:`${agent}::${entry.value}`,displayName:`${agent==='claude'?'Claude':'Antigravity'} · ${entry.name||entry.value}`,supportedReasoningEfforts:entry.value===current?levels:[],defaultReasoningEffort:entry.value===current?effort?.currentValue:undefined}));
    if(!result.length)throw Error('ACP 未返回可用模型目录');
    return {models:result};
  }finally{
    for(const waiter of pending.values())clearTimeout(waiter.timer);pending.clear();
    child.stdin?.end();reader.close();
    if(!exited){
      if(process.platform==='win32'&&child.pid){const result=await terminate('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,reject:false,timeout:10000});if(result.exitCode!==0&&!exited)throw Error('ACP 目录检查进程未能停止');}
      else child.kill();
    }
  }
}

// The transport is the upstream ACP implementation, not a prompt CLI wrapper.
export function officialAcp(options:{agent:OfficialAcpAgent;cwd:string;session?:string;model?:string;effort?:string;mode?:string;permission?:string;content:any[];approve:(params:any)=>Promise<boolean>},launch:typeof execa=execa,terminate:typeof execa=execa){
  const executable=officialAcpExecutable(options.agent);
  const child=launch(executable.command,executable.args,{cwd:options.cwd,windowsHide:true,reject:false,buffer:false,stdin:'pipe'});
  const stdout=new PassThrough(),stderr=new PassThrough();
  let sequence=0,session=options.session,stopped=false,promptStarted=false,settled=false;
  let config:any[]=[],actualModel:string|undefined,contextWindow:number|undefined,contextUsed:number|undefined;
  const tools=new Map<string,any>(),completed=new Set<string>();
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer?:NodeJS.Timeout}>();
  const emit=(event:any)=>stdout.write(JSON.stringify(event)+'\n');
  const send=(message:any)=>{if(child.stdin?.writable)child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');};
  const request=(method:string,params:any,timeout=45000)=>new Promise<any>((resolve,reject)=>{const id=++sequence;const timer=timeout?setTimeout(()=>{pending.delete(id);reject(Error(`ACP ${method} 超时`));},timeout):undefined;pending.set(id,{resolve,reject,timer});send({id,method,params});});
  child.stderr?.on('data',()=>{}); // Upstream diagnostics may contain environment values; expose only structured errors.
  const reader=createInterface({input:child.stdout!});
  reader.on('line',line=>{
    let message:any;try{message=JSON.parse(line);}catch{return;}
    if(message.id!==undefined&&!message.method){const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);clearTimeout(waiter.timer);if(message.error)waiter.reject(Error(message.error.code===-32000||message.error.code===-32001?'ACP 无法创建或恢复会话，请检查该助手的认证状态':`ACP 请求失败（${message.error.code}）`));else waiter.resolve(message.result);return;}
    if(message.method==='session/request_permission'){
      const params={...message.params,toolCall:{...tools.get(message.params?.toolCall?.toolCallId),...message.params?.toolCall}};
      const respond=(accepted:boolean)=>{const choices=params.options||[],choice=choices.find((o:any)=>o.kind===(accepted?'allow_once':'reject_once'))||choices.find((o:any)=>String(o.kind).startsWith(accepted?'allow':'reject'));send({id:message.id,result:{outcome:choice?{outcome:'selected',optionId:choice.optionId}:{outcome:'cancelled'}}});};
      const workspaceEdit=params.toolCall?.kind==='edit'&&params.toolCall.locations?.length&&params.toolCall.locations.every((loc:any)=>{if(typeof loc.path!=='string')return false;const relative=path.relative(options.cwd,path.resolve(options.cwd,loc.path));return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);});
      if(stopped)respond(false);else if(options.permission==='full'||options.permission==='auto'&&workspaceEdit)respond(true);else void options.approve(params).then(respond,()=>respond(false));return;
    }
    if(message.id!==undefined&&message.method){send({id:message.id,error:{code:-32601,message:'Client service not supported'}});return;}
    if(message.method!=='session/update'||message.params?.sessionId!==session)return;
    const update=message.params.update;if(!update)return;
    if(update.sessionUpdate==='config_option_update')config=update.configOptions||config;
    if(!promptStarted||message.params?._meta?.isReplay)return;
    if(update.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text')emit({type:'assistant',message:{content:[{type:'text',text:update.content.text}]}});
    if(update.sessionUpdate==='usage_update'){contextWindow=update.size;contextUsed=update.used;}
    if(update.sessionUpdate==='tool_call'||update.sessionUpdate==='tool_call_update'){
      const id=update.toolCallId,previous=tools.get(id),tool={...previous,...update};tools.set(id,tool);
      if(!previous)emit({type:'assistant',message:{content:[{type:'tool_use',id,name:tool.title||tool.kind||'工具',input:tool.rawInput||{}}]}});
      if(['completed','failed'].includes(tool.status)&&!completed.has(id)){completed.add(id);emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:(tool.content||[]).map((c:any)=>c.type==='content'&&c.content?.type==='text'?c.content.text:'').filter(Boolean).join('\n'),is_error:tool.status==='failed',file_change:tool.status==='completed'?acpFileChanges(tool.content||[]):undefined}]}});}
    }
  });
  void Promise.resolve(child).then(result=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(`ACP 进程退出（${result.exitCode}）`));}pending.clear();},()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('ACP 进程无法启动'));}pending.clear();});
  const stopProcess=async()=>{if(child.exitCode!=null)return;if(process.platform==='win32'&&child.pid){const result=await terminate('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,reject:false});if(result.exitCode!==0&&child.exitCode==null)throw Error('ACP 子进程未能停止');}else child.kill();};
  const done=(async()=>{
    try{
      const init=await request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'codex-mobile-control',version:'0.6.0'}});
      if(session&&init.agentCapabilities?.loadSession!==true)throw Error('该 ACP 服务未声明恢复会话能力');
      if(options.content.some(c=>c.type==='image')&&init.agentCapabilities?.promptCapabilities?.image!==true)throw Error('该 ACP 服务未声明图片输入能力');
      const state=await request(session?'session/load':'session/new',{...(session?{sessionId:session}:{}),cwd:options.cwd,mcpServers:[]});session=session||state.sessionId;if(!session)throw Error('ACP 未返回会话 ID');config=state.configOptions||[];
      if(options.model&&options.model!=='default'){
        const modelOption=config.find(o=>o.category==='model'||o.id==='model');
        const changed=await request(modelOption?'session/set_config_option':'session/set_model',modelOption?{sessionId:session,configId:modelOption.id,value:options.model}:{sessionId:session,modelId:options.model});config=changed.configOptions||config;actualModel=options.model;
      }
      if(options.effort&&options.effort!=='default'){const effort=config.find(o=>o.category==='thought_level'||/^(effort|reasoning_effort)$/.test(o.id));if(!effort)throw Error('该 ACP 模型未提供思考强度设置');const changed=await request('session/set_config_option',{sessionId:session,configId:effort.id,value:options.effort});if(changed.configOptions?.find((o:any)=>o.id===effort.id)?.currentValue!==options.effort)throw Error('ACP 未确认思考强度设置');config=changed.configOptions;}
      const wanted=options.mode==='plan'?'plan':options.permission==='full'?'bypassPermissions':options.permission==='auto'?'acceptEdits':'default';
      const modes=state.modes?.availableModes||[];
      const selected=modes.find((m:any)=>m.id===wanted);
      if(selected)await request('session/set_mode',{sessionId:session,modeId:selected.id});
      else throw Error(`ACP 未提供所需权限模式：${wanted}`);
      emit({type:'system',session_id:session,model:actualModel});if(stopped)return {exitCode:0};
      promptStarted=true;
      const result=await request('session/prompt',{sessionId:session,prompt:options.content.map(c=>c.type==='image'?{type:'image',mimeType:c.source.media_type,data:c.source.data}:c)},0);
      if(result.stopReason==='cancelled'&&!stopped)throw Error('ACP 任务已被取消');
      const u=result.usage||result._meta?.usage;
      emit({type:'result',session_id:session,model:actualModel,is_error:false,result:'',stopReason:result.stopReason,usage:u||contextWindow?{input_tokens:u?.inputTokens||0,output_tokens:u?.outputTokens||0,total_tokens:u?.totalTokens,cache_read_input_tokens:u?.cachedReadTokens||0,context_window:contextWindow,context_used:contextUsed}:undefined});return {exitCode:0};
    }catch(error){const message=String((error as Error).message);stderr.write(message);emit({type:'result',is_error:true,result:message});return {exitCode:1};}
    finally{child.stdin?.end();try{await stopProcess();await Promise.resolve(child).catch(()=>{});}finally{reader.close();stdout.end();stderr.end();settled=true;}}
  })();
  const interrupt=async()=>{stopped=true;if(session&&promptStarted)send({method:'session/cancel',params:{sessionId:session}});let timer:NodeJS.Timeout|undefined;await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]).finally(()=>clearTimeout(timer));if(!settled){await stopProcess();await done;}};
  return {get pid(){return child.pid;},stdout,stderr,then:done.then.bind(done),interrupt,kill(){void interrupt();return true;}};
}
