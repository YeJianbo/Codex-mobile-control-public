import {execa} from 'execa';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {agentNames,agentUpdates,modelAgent,threadAgent,type Agent} from './agentProtocol.js';
import {imageInputs,type ImageAttachment} from './imageUploads.js';
import {resolveFiles,filePrompt} from './fileUploads.js';
import type {StateStore} from './stateStore.js';
import type {EventHub} from './eventHub.js';
import type {PickerModel} from './modelCatalog.js';
import {grokAcp} from './grokAcp.js';

const commands={claude:'claude',antigravity:'agy',grok:'grok'};
type Meta={session?:string;model?:string;tokens?:Record<string,number|null>};
export class AgentSessions {
  private active=new Map<string,{process:any;stopped:boolean}>();
  private catalog?:{at:number;models:PickerModel[]};
  private permissions=new Map<string,{threadId:string;resolve:(accept:boolean)=>void}>();
  constructor(private store:StateStore,private hub:EventHub,private launch:typeof execa=execa){}
  owns(id:string){return this.active.has(id);}
  async resolveApproval(id:string,decision:'accept'|'decline'){
    const entry=this.permissions.get(id);if(!entry)throw Error('审批已失效');
    await this.store.resolveApproval(id,decision);this.permissions.delete(id);entry.resolve(decision==='accept');
    this.hub.publish({type:'approval.resolved',threadId:entry.threadId,approvalId:id,decision});
  }
  private async approve(threadId:string,params:any):Promise<boolean>{
    if(!this.active.has(threadId)||this.active.get(threadId)?.stopped)return false;
    const id='agent-'+randomUUID();
    const title=params.toolCall?.title||'执行工具',detail=JSON.stringify(params.toolCall?.rawInput||{});
    await this.store.addApproval({id,rpcId:id,method:'agent/permission',threadId,approvalId:id,approvalType:'command',title,detail});
    if(!this.active.has(threadId)||this.active.get(threadId)?.stopped){await this.store.resolveApproval(id,'decline');return false;}
    const response=new Promise<boolean>(resolve=>this.permissions.set(id,{threadId,resolve}));
    this.hub.publish({type:'approval.requested',threadId,approvalId:id,approvalType:'command',title,detail});
    return response;
  }
  async models():Promise<PickerModel[]>{
    if(this.catalog&&Date.now()-this.catalog.at<300000)return this.catalog.models;
    const models:PickerModel[]=[];
    await Promise.all(Object.entries(commands).map(async([engine,command])=>{
      if(process.env.CODEX_MOBILE_CONTROL_AGENTS&&!process.env.CODEX_MOBILE_CONTROL_AGENTS.split(',').includes(engine))return;
      try{
        await execa(process.platform==='win32'?'where.exe':'which',[command],{timeout:5000,windowsHide:true});
        const agent=engine as Exclude<Agent,'codex'>;
        const add=(id:string,name:string)=>{
          const fixed=agent==='antigravity'?/-(low|medium|high|max)$/.exec(id)?.[1]:undefined;
          models.push({model:`${agent}::${id}`,displayName:`${agentNames[agent]} · ${name}`,supportedReasoningEfforts:fixed?[{reasoningEffort:fixed}]:[],defaultReasoningEffort:fixed});
        };
        add('default','默认模型');
        if(agent!=='claude'){
          const result=await execa(command,['models'],{timeout:12000,windowsHide:true,reject:false});
          for(const line of result.stdout.split(/\r?\n/)){
            const match=agent==='antigravity'?/^([\w.-]+)\t(.+)$/.exec(line):/^\s*[-*]\s+([\w.-]+)(?:\s|$)/.exec(line);
            if(match)add(match[1],agent==='antigravity'?match[2]:match[1]);
          }
        }
      }catch{/* An unavailable executable does not block the remaining agents. */}
    }));
    models.sort((a,b)=>a.model.localeCompare(b.model));this.catalog={at:Date.now(),models};return models;
  }
  async validate(model?:string,id?:string){
    const agent=id?threadAgent(id):modelAgent(model);
    if(model&&modelAgent(model)!==agent)throw Error('这个会话属于 '+agentNames[agent]+'，请在新会话中切换助手');
    if(model&&!(await this.models()).some(m=>m.model===model))throw Error('此助手或模型不可用，请刷新模型列表');
  }
  usage(id:string,agent:Agent=threadAgent(id)){return {quota:{windows:[],source:agent,stale:false},tokens:id?this.store.readAgentMeta(id)?.tokens||null:null};}
  async resume(id:string){const thread=this.store.threads.find(t=>t.id===id);if(!thread)throw Error('会话不存在');this.hub.publish({type:'thread.started',threadId:id,thread});}
  async handle(command:any){
    if(command.permission==='custom')throw Error('自定义权限仅适用于 Codex');
    if(command.type==='turn.interrupt'){
      const run=this.active.get(command.threadId);if(!run)throw Error('当前没有运行中的任务');
      run.stopped=true;for(const [id,p] of this.permissions)if(p.threadId===command.threadId)await this.resolveApproval(id,'decline');
      if(process.platform==='win32'&&run.process.pid)await execa('taskkill.exe',['/PID',String(run.process.pid),'/T','/F'],{windowsHide:true,reject:false});
      else await run.process.kill();return;
    }
    if(command.type==='thread.resume'){await this.resume(command.threadId);return;}
    let id=command.threadId;
    if(command.type==='thread.start'){
      const agent=modelAgent(command.model);id=`${agent}-${randomUUID()}`;
      const thread=await this.store.upsertThread({id,projectPath:command.projectPath,title:command.initialText?.trim().slice(0,60)||'新会话',status:'idle'});
      this.store.writeAgentMeta(id,{model:command.model});
      this.hub.publish({type:'thread.started',threadId:id,thread,requestId:command.requestId});
    }
    if(!['thread.start','turn.start'].includes(command.type))throw Error('此助手暂不支持这个操作');
    if(this.active.has(id))throw Error('任务仍在运行，请将消息加入队列');
    const meta:Meta=this.store.readAgentMeta(id)||{};
    const model=command.model||meta.model;
    await this.validate(model,id);
    const text=command.initialText??command.text??'';
    const files=await resolveFiles(command.files);
    if(!text.trim()&&!command.images?.length&&!files.length)return;
    const prompt=text+filePrompt(files);
    const agent=threadAgent(id) as Exclude<Agent,'codex'>;
    const content:any[]=[{type:'text',text:prompt}];
    for(const image of await imageInputs(command.images)){
      const match=/^data:([^;]+);base64,(.*)$/.exec(image.url)!;
      content.push({type:'image',source:{type:'base64',media_type:match[1],data:match[2]}});
    }
    // AGY's documented stream input accepts text blocks only; never silently discard attachments.
    if(agent==='antigravity'&&content.length>1)throw Error('当前 Antigravity CLI 不支持图片消息；请使用 Claude Code、Grok Build 或 Codex');
    const args:string[]=[];let input:string|undefined;
    const rawModel=model?.split('::')[1];
    if(agent==='claude'){
      args.push('-p','--verbose','--include-partial-messages','--permission-prompt-tool','stdio','--input-format','stream-json','--output-format','stream-json','--permission-mode',command.permission==='full'?'bypassPermissions':command.permission==='auto'?'acceptEdits':'default');
      if(meta.session)args.push('--resume',meta.session);
      input=JSON.stringify({type:'user',message:{role:'user',content}})+'\n';
    }else if(agent==='antigravity'){
      args.push('--input-format','stream-json','--output-format','stream-json');
      if(meta.session)args.push('--conversation',meta.session);
      if(command.permission==='full')args.push('--dangerously-skip-permissions');
      else if(command.permission==='auto')args.push('--mode','accept-edits');
      input=JSON.stringify({event:'user',message:{content:prompt}})+'\n';
    }
    if(rawModel&&rawModel!=='default')args.push('--model',rawModel);
    // AGY catalog IDs already encode the variant. Old clients may still send a
    // stale Codex effort; never override the explicitly selected AGY model.
    if(command.effort&&agent!=='antigravity')args.push(agent==='grok'?'--reasoning-effort':'--effort',command.effort);
    const cwd=command.projectPath||this.store.threads.find(t=>t.id===id)?.projectPath;
    const child=agent==='grok'?grokAcp({cwd,session:meta.session,model:rawModel,effort:command.effort,permission:command.permission,content,approve:params=>this.approve(id,params)}):this.launch(commands[agent],args,{cwd,windowsHide:true,reject:false,input:agent==='claude'?undefined:input,buffer:false,stdin:'pipe'});
    if(agent==='claude'&&'stdin' in child)child.stdin?.write(input!);
    const run={process:child,stopped:false};this.active.set(id,run);
    await this.store.upsertThread({id,status:'running'});
    this.hub.publish({type:'user.message',threadId:id,text,images:command.images,files:command.files});
    const turnId=randomUUID();this.hub.publish({type:'turn.started',threadId:id,turnId,requestId:command.requestId});
    void this.consume(id,agent,child,run,meta,model,turnId);
  }
  private async consume(id:string,agent:Agent,child:any,run:{stopped:boolean},meta:Meta,model:string,turnId:string){
    let stderr='',responded=false,resultSeen=false,failed=false,streamed=false;
    const seenTools=new Set<string>();
    child.stderr?.on('data',(data:Buffer)=>{stderr=(stderr+data.toString()).slice(-6000);});
    try{
      for await(const line of createInterface({input:child.stdout})){
        let record;try{record=JSON.parse(line);}catch{continue;}
        if(agent==='claude'&&record.type==='control_request'){
          const request=record.request;
          if(request?.subtype==='can_use_tool'){
            void this.approve(id,{toolCall:{title:request.tool_name,rawInput:request.input}}).then(accepted=>{
              if(child.stdin?.writable)child.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:record.request_id,response:accepted?{behavior:'allow',updatedInput:request.input}:{behavior:'deny',message:'用户拒绝本次操作'}}})+'\n');
            });
          }else if(child.stdin?.writable)child.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'error',request_id:record.request_id,error:'Unsupported client request'}})+'\n');
          continue;
        }
        if(record.type==='stream_event'&&record.event?.delta?.type==='text_delta'){
          const text=record.event.delta.text;if(text){streamed=true;responded=true;this.hub.publish({type:'message.delta',threadId:id,turnId,itemId:turnId+':reply',text});}
        }
        const updates=agentUpdates(agent,record).filter(e=>!(record.type==='assistant'&&streamed&&e.kind==='text'));
        if(record.type==='assistant')streamed=false;
        for(const event of updates){
          const itemId=turnId+':'+(event.id||'reply');
          if(event.kind==='session'&&event.id){meta.session=event.id;meta.model=model;this.store.writeAgentMeta(id,meta);}
          if(event.kind==='text'&&event.text){responded=true;this.hub.publish({type:'message.delta',threadId:id,turnId,itemId,text:event.text});}
          if(event.kind==='tool'&&!seenTools.has(itemId)){seenTools.add(itemId);this.hub.publish({type:'tool.started',threadId:id,itemId,title:event.name||'执行工具',detail:event.text});}
          if(event.kind==='output')this.hub.publish({type:'tool.output',threadId:id,itemId,text:event.text||''});
          if(event.kind==='complete')this.hub.publish({type:'tool.completed',threadId:id,itemId,status:event.error?'error':'ok'});
          if(event.kind==='result'){
            resultSeen=true;failed=!!event.error;
            if(agent==='claude')child.stdin?.end();
            if(!responded&&event.text&&!failed)this.hub.publish({type:'message.delta',threadId:id,turnId,itemId,text:event.text});
            if(failed&&event.text)stderr=event.text;
            if(event.usage){const u=event.usage;const old=meta.tokens||{};const input=Number(u.input_tokens||0),cached=Number(u.cache_read_input_tokens??u.cache_read_tokens??0),output=Number(u.output_tokens||0);const total=Number(u.total_tokens??input+cached+output);meta.tokens={input:(old.input||0)+input+(agent==='claude'?cached:0),cached:(old.cached||0)+cached,output:(old.output||0)+output,reasoning:u.thinking_tokens==null?null:(old.reasoning||0)+Number(u.thinking_tokens),total:(old.total||0)+total,last:total,contextWindow:null};this.store.writeAgentMeta(id,meta);}
          }
        }
      }
      const result=await child;
      if(!run.stopped&&(failed||result.exitCode!==0||!resultSeen))throw Error(stderr||`${agentNames[agent]} 未正常结束（${result.exitCode}）`);
      await this.store.upsertThread({id,status:run.stopped?'interrupted':'completed'});
      this.hub.publish({type:'turn.completed',threadId:id,status:run.stopped?'interrupted':'completed'});
    }catch(error){await this.store.upsertThread({id,status:run.stopped?'interrupted':'error'});if(!run.stopped)this.hub.publish({type:'error',threadId:id,message:String((error as Error).message)});this.hub.publish({type:'turn.completed',threadId:id,status:run.stopped?'interrupted':'error'});}
    finally{for(const [approval,p] of this.permissions)if(p.threadId===id)await this.resolveApproval(approval,'decline');this.active.delete(id);}
  }
}
