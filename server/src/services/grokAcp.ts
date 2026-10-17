import {execa} from 'execa';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {acpFileChanges} from './agentFileChanges.js';

// ACP keeps images off the Windows command line and cancels the specific session.
export function grokAcp(options:{command?:string;cwd:string;session?:string;model?:string;effort?:string;permission?:string;content:any[];approve:(params:any)=>Promise<boolean>},launch:typeof execa=execa,terminate:typeof execa=execa){
  // Override the process default even for ask/auto; otherwise a local always-approve
  // preference silently defeats the permission selected on the phone.
  const args=['--permission-mode',options.permission==='full'?'bypassPermissions':'default','agent','--no-leader'];
  if(options.model&&options.model!=='default')args.push('--model',options.model);
  if(options.effort)args.push('--reasoning-effort',options.effort);
  if(options.permission==='full')args.push('--always-approve');
  args.push('stdio');
  const process=launch(options.command||'grok',args,{cwd:options.cwd,windowsHide:true,reject:false,buffer:false});
  const stdout=new PassThrough(),stderr=new PassThrough();
  process.stderr?.pipe(stderr,{end:false});
  let sequence=0,session=options.session,stopped=false,settled=false,promptStarted=false;
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer?:NodeJS.Timeout}>();
  const send=(message:any)=>{if(process.stdin?.writable)process.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');};
  const emit=(message:any)=>stdout.write(JSON.stringify(message)+'\n');
  const request=(method:string,params:any,timeout=30000)=>new Promise<any>((resolve,reject)=>{
    const id=++sequence;
    const timer=timeout?setTimeout(()=>{pending.delete(id);reject(Error(`Grok ${method} 超时`));},timeout):undefined;
    pending.set(id,{resolve,reject,timer});send({id,method,params});
  });
  const reader=createInterface({input:process.stdout!});
  reader.on('line',line=>{
    let message:any;try{message=JSON.parse(line);}catch{return;}
    if(message.id!==undefined&&!message.method){const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);clearTimeout(waiter.timer);if(message.error)waiter.reject(Error([message.error.message||'Grok 请求失败',typeof message.error.data==='string'?message.error.data:message.error.data?.message].filter(Boolean).join('：')));else waiter.resolve(message.result);return;}
    if(message.method==='session/request_permission'){
      const respond=(accepted:boolean)=>{const item=(message.params.options||[]).find((o:any)=>o.kind===(accepted?'allow_once':'reject_once'))||(message.params.options||[]).find((o:any)=>String(o.kind).startsWith(accepted?'allow':'reject'));send({id:message.id,result:{outcome:item?{outcome:'selected',optionId:item.optionId}:{outcome:'cancelled'}}});};
      if(stopped)respond(false);
      else if(options.permission==='full')respond(true);
      else if(options.permission==='auto'&&message.params.toolCall?.kind==='edit'&&message.params.toolCall.locations?.length&&message.params.toolCall.locations.every((location:any)=>{const relative=path.relative(options.cwd,path.resolve(options.cwd,location.path||''));return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}))respond(true);
      else void options.approve(message.params).then(respond,()=>respond(false));
      return;
    }
    if(message.id!==undefined&&message.method){send({id:message.id,error:{code:-32601,message:'Client method not supported'}});return;}
    if(message.method!=='session/update'||!promptStarted||message.params?._meta?.isReplay)return;
    const update=message.params?.update;if(!update)return;
    if(update.sessionUpdate==='plan')emit({type:'plan',entries:update.entries});
    if(update.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text')emit({type:'assistant',message:{id:'reply',content:[{type:'text',text:update.content.text}]}});
    if(update.sessionUpdate==='tool_call')emit({type:'assistant',message:{content:[{type:'tool_use',id:update.toolCallId,name:update.title||update.kind||'工具',input:update.rawInput||{}}]}});
    if(update.sessionUpdate==='tool_call_update'){
      const text=(update.content||[]).map((c:any)=>c.type==='content'&&c.content?.type==='text'?c.content.text:'').filter(Boolean).join('\n');
      if(update.status==='completed'||update.status==='failed')emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:update.toolCallId,content:text,is_error:update.status==='failed',file_change:update.status==='completed'?acpFileChanges(update.content||[]):undefined}]}});
    }
  });
  void process.then(result=>{
    for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error(`Grok 进程已退出：${result.exitCode}`));}pending.clear();
  });
  const done=(async()=>{
    try{
      const init=await request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'codex-mobile-control',version:'0.6.0'}});
      if(options.content.some(c=>c.type==='image')&&init.agentCapabilities?.promptCapabilities?.image===false)throw Error('当前 Grok CLI 不支持图片消息；请改用文件附件或其他后端。');
      // Existing local model credentials are resolved by Grok; never launch an interactive login here.
      const loaded=session?await request('session/load',{sessionId:session,cwd:options.cwd,mcpServers:[]}):await request('session/new',{cwd:options.cwd,mcpServers:[]});
      session=session||loaded.sessionId;
      if(!session)throw Error('Grok 未返回会话编号');
      // Loading a saved session may restore the upstream response model instead of
      // the configured custom alias. Reapply the selected route before resuming.
      const selectedModel=options.model&&options.model!=='default'?options.model:init._meta?.modelState?.currentModelId;
      if(options.session&&selectedModel)await request('session/set_config_option',{sessionId:session,configId:'model',value:selectedModel});
      if(options.session&&options.effort)await request('session/set_config_option',{sessionId:session,configId:'reasoning_effort',value:options.effort});
      emit({type:'system',session_id:session});
      if(stopped)return {exitCode:0};
      promptStarted=true;
      const prompt=options.content.map(c=>c.type==='image'?{type:'image',mimeType:c.source.media_type,data:c.source.data}:c);
      const result=await request('session/prompt',{sessionId:session,prompt},0);
      // EOF lets the CLI finish its output before the public stream is closed.
      process.stdin?.end();
      let drainTimer:NodeJS.Timeout|undefined;
      await Promise.race([Promise.resolve(process),new Promise(resolve=>{drainTimer=setTimeout(resolve,1500);})]).finally(()=>clearTimeout(drainTimer));
      const usage=result._meta?.usage;
      const actualModel=result._meta?.modelId;
      const contextWindow=init._meta?.modelState?.availableModels?.find((m:any)=>m.modelId===actualModel)?._meta?.totalContextTokens;
      emit({type:'result',session_id:session,is_error:false,result:'',stopReason:result.stopReason,model:actualModel,usage:usage?{input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,cache_read_input_tokens:usage.cachedReadTokens,total_tokens:usage.totalTokens,thinking_tokens:usage.reasoningTokens,context_window:contextWindow}:undefined});
      return {exitCode:0};
    }catch(error){stderr.write(String((error as Error).message));emit({type:'result',is_error:true,result:String((error as Error).message)});return {exitCode:1};}
    finally{process.stdin?.end();process.kill();await process;reader.close();stdout.end();stderr.end();settled=true;}
  })();
  const interrupt=async()=>{
    stopped=true;
    if(session&&promptStarted)send({method:'session/cancel',params:{sessionId:session}});
    let timer:NodeJS.Timeout|undefined;
    await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]).finally(()=>clearTimeout(timer));
    if(!settled){
      if(globalThis.process.platform==='win32'&&process.pid){
        const result=await terminate('taskkill.exe',['/PID',String(process.pid),'/T','/F'],{windowsHide:true,reject:false});
        if(result.exitCode!==0&&!settled)throw Error(`停止失败：Grok 后台进程仍在运行（taskkill ${result.exitCode}）`);
      }else if(process.kill()===false&&!settled)throw Error('停止失败：Grok 后台进程仍在运行');
      await done;
    }
  };
  return {get pid(){return process.pid;},stdout,stderr,then:done.then.bind(done),interrupt,kill(){void interrupt();return true;}};
}
