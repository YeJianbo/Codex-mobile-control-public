import {execa} from 'execa';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import path from 'node:path';

// ACP keeps images off the Windows command line and cancels the specific session.
export function grokAcp(options:{cwd:string;session?:string;model?:string;effort?:string;permission?:string;content:any[];approve:(params:any)=>Promise<boolean>}){
  const args=['agent','--no-leader'];
  if(options.model&&options.model!=='default')args.push('--model',options.model);
  if(options.effort)args.push('--reasoning-effort',options.effort);
  if(options.permission==='full')args.push('--always-approve');
  args.push('stdio');
  const process=execa('grok',args,{cwd:options.cwd,windowsHide:true,reject:false,buffer:false});
  const stdout=new PassThrough(),stderr=new PassThrough();
  process.stderr?.pipe(stderr);
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
    if(message.id!==undefined&&!message.method){const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);clearTimeout(waiter.timer);if(message.error)waiter.reject(Error(message.error.message||'Grok 请求失败'));else waiter.resolve(message.result);return;}
    if(message.method==='session/request_permission'){
      const respond=(accepted:boolean)=>{const item=(message.params.options||[]).find((o:any)=>o.kind===(accepted?'allow_once':'reject_once'))||(message.params.options||[]).find((o:any)=>String(o.kind).startsWith(accepted?'allow':'reject'));send({id:message.id,result:{outcome:item?{outcome:'selected',optionId:item.optionId}:{outcome:'cancelled'}}});};
      if(stopped)respond(false);
      else if(options.permission==='full')respond(true);
      else if(options.permission==='auto'&&message.params.toolCall?.kind==='edit'&&message.params.toolCall.locations?.length&&message.params.toolCall.locations.every((location:any)=>{const relative=path.relative(options.cwd,path.resolve(options.cwd,location.path||''));return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}))respond(true);
      else void options.approve(message.params).then(respond,()=>respond(false));
      return;
    }
    if(message.id!==undefined&&message.method){send({id:message.id,error:{code:-32601,message:'Client method not supported'}});return;}
    if(message.method!=='session/update'||!promptStarted)return;
    const update=message.params?.update;if(!update)return;
    if(update.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text')emit({type:'assistant',message:{id:'reply',content:[{type:'text',text:update.content.text}]}});
    if(update.sessionUpdate==='tool_call')emit({type:'assistant',message:{content:[{type:'tool_use',id:update.toolCallId,name:update.title||update.kind||'工具',input:update.rawInput||{}}]}});
    if(update.sessionUpdate==='tool_call_update'){
      const text=(update.content||[]).map((c:any)=>c.type==='content'&&c.content?.type==='text'?c.content.text:'').filter(Boolean).join('\n');
      if(update.status==='completed'||update.status==='failed')emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:update.toolCallId,content:text,is_error:update.status==='failed'}]}});
    }
  });
  void process.then(result=>{
    for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error(`Grok 进程已退出：${result.exitCode}`));}pending.clear();
  });
  const done=(async()=>{
    try{
      await request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'codex-mobile-control',version:'0.6.0'}});
      // Existing local model credentials are resolved by Grok; never launch an interactive login here.
      if(session)await request('session/load',{sessionId:session,cwd:options.cwd,mcpServers:[]});
      else session=(await request('session/new',{cwd:options.cwd,mcpServers:[]})).sessionId;
      if(!session)throw Error('Grok 未返回会话编号');
      emit({type:'system',session_id:session});
      if(stopped)return {exitCode:0};
      promptStarted=true;
      const prompt=options.content.map(c=>c.type==='image'?{type:'image',mimeType:c.source.media_type,data:c.source.data}:c);
      const result=await request('session/prompt',{sessionId:session,prompt},0);
      emit({type:'result',session_id:session,is_error:false,result:'',stopReason:result.stopReason});
      return {exitCode:0};
    }catch(error){stderr.write(String((error as Error).message));emit({type:'result',is_error:true,result:String((error as Error).message)});return {exitCode:1};}
    finally{settled=true;stdout.end();process.stdin?.end();process.kill();reader.close();}
  })();
  return {stdout,stderr,then:done.then.bind(done),async kill(){stopped=true;if(session&&promptStarted)send({method:'session/cancel',params:{sessionId:session}});else process.kill();const timer=setTimeout(()=>{if(!settled)process.kill();},5000);timer.unref();}};
}
