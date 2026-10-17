import {execa} from 'execa';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {agentNames,agentUpdates,modelAgent,threadAgent,publicAgentAllowed,type Agent} from './agentProtocol.js';
import {imageInputs,type ImageAttachment} from './imageUploads.js';
import {resolveFiles,filePrompt} from './fileUploads.js';
import type {StateStore} from './stateStore.js';
import type {EventHub} from './eventHub.js';
import type {PickerModel} from './modelCatalog.js';
import {grokAcp} from './grokAcp.js';
import {harnessAcp,readHarnessCatalog} from './harnessAcp.js';
import {findAgentExecutable,type AgentExecutable,type CliAgent} from './agentExecutable.js';
import {readAgentCatalog} from './agentCatalog.js';
import {deepseekConfigStamp,canonicalDeepseekModel} from './deepseekDesktopConfig.js';
import {deepseekNativeSessions} from './deepseekNativeSessions.js';
import {AgyUsageReader} from './agyUsage.js';
import {AgyCliPool} from './agyCli.js';
import {officialAcp,readOfficialAcpCatalog} from './claudeAcp.js';
import {opencodeConfigStamp,refreshOpencodeModels} from './opencodeConfig.js';

const commands={claude:'claude',antigravity:'agy',grok:'grok',deepseek:'dsh',hermes:'hermes',opencode:'opencode'};
const agyEfforts=['low','medium','high','xhigh','max'];
const agyVariant=/-(low|medium|high|xhigh|max)$/;
type Meta={session?:string;model?:string;effort?:string;actualModel?:string;transport?:'acp';tokens?:Record<string,number|null>};
export class AgentSessions {
  onThreadCreated?:(requestId:string|undefined,threadId:string)=>Promise<void>;
  private active=new Map<string,{process:any;stopped:boolean}>();
  private starting=new Set<string>();
  private catalog?:{at:number;models:PickerModel[];deepseekStamp:string;opencodeStamp:string};
  private catalogRead?:Promise<PickerModel[]>;
  private permissions=new Map<string,{threadId:string;resolve:(accept:boolean)=>void}>();
  private questions=new Map<string,{threadId:string;questions:{id:string;question:string;header?:string;options?:any[]}[];resolve:(answers:Record<string,string>|null)=>void}>();
  private executables=new Map<CliAgent,AgentExecutable>();
  private discoveryErrors=new Map<CliAgent,string>();
  private protocolErrors=new Map<CliAgent,string>();
  private imageCapabilities=new Map<CliAgent,boolean>([['antigravity',false]]);
  private planCapabilities=new Map<CliAgent,boolean>();
  private healthVersions=new Map<CliAgent,{command:string;version:string;error:string;at:number}>();
  private healthVersionReads=new Map<string,Promise<void>>();
  private healthDiscoveryAt=0;
  private healthDiscoveryRead?:Promise<void>;
  private lastFailures=new Map<CliAgent,{message:string;at:string}>();
  private officialCatalogs=new Map<string,{at:number;models:PickerModel[];available:boolean;reason:string}>();
  private officialReads=new Map<string,Promise<{models:PickerModel[];available:boolean;reason:string}>>();
  async officialModels(agent:'claude'|'antigravity',refresh=false):Promise<{models:PickerModel[];available:boolean;reason:string}>{
    const cached=this.officialCatalogs.get(agent);
    if(!refresh&&cached&&Date.now()-cached.at<60000)return cached;
    let pending=this.officialReads.get(agent);
    if(!pending){
      pending=readOfficialAcpCatalog(agent,process.cwd()).then(result=>({models:result.models,available:true,reason:''}),error=>({models:[],available:false,reason:String((error as Error).message)})).then(result=>{this.officialCatalogs.set(agent,{...result,at:Date.now()});return result;}).finally(()=>this.officialReads.delete(agent));
      this.officialReads.set(agent,pending);
    }
    return pending!;
  }
  private agyUsage:AgyUsageReader;
  private agyCli:AgyCliPool;
  constructor(private store:StateStore,private hub:EventHub,private launch:typeof execa=execa,private discover:typeof execa=execa,private terminate:typeof execa=execa,private locate:typeof findAgentExecutable=findAgentExecutable){this.agyUsage=new AgyUsageReader(async()=>(await this.executable('antigravity')).command,this.discover);this.agyCli=new AgyCliPool(this.launch,this.terminate);}
  async close(){await this.agyCli.close();}
  async forget(id:string){if(this.owns(id))throw Error('任务仍在运行，请先停止再删除会话');await this.agyCli.forget(id);}
  private async executable(agent:CliAgent){const found=await this.locate(agent,this.discover);this.executables.set(agent,found);this.discoveryErrors.delete(agent);return found;}
  async backends(viaPublic=false){
    await this.models();
    return this.backendSnapshot(viaPublic);
  }
  private backendSnapshot(viaPublic=false){
    return Object.keys(commands).map(key=>{
      const agent=key as CliAgent,enabled=!process.env.CODEX_MOBILE_CONTROL_AGENTS||process.env.CODEX_MOBILE_CONTROL_AGENTS.split(',').includes(agent);
      const installed=this.executables.has(agent),publicAllowed=publicAgentAllowed(agent);
      const supportsPlan=this.planCapabilities.get(agent)===true||agent==='claude'||agent==='antigravity';
      const protocolError=this.protocolErrors.get(agent)||'';
      const loginExpired=/token refresh failed|session has ended|please log in again|not logged in|authentication required/i.test(protocolError);
      return {agent,name:agentNames[agent],installed,publicAllowed,available:enabled&&installed&&!this.protocolErrors.has(agent)&&(!viaPublic||publicAllowed),supportsImages:this.imageCapabilities.get(agent),supportsPlan,supportsPlanMode:supportsPlan,supportsApproval:agent!=='antigravity',accountStatus:loginExpired?'reauth-required':'not-checked',reason:!enabled?'此网关未启用该助手':viaPublic&&!publicAllowed?'此助手的公网访问已关闭':!installed?(this.discoveryErrors.get(agent)||'未检测到 CLI'):loginExpired?'登录已失效，请在账号中重新授权':protocolError,discovery:this.executables.get(agent)?.source};
    });
  }
  async health(refresh=false,viaPublic=false){
    // Remote model discovery can stall independently of local runtime health.
    // Refresh the local executable paths without launching model/ACP catalogs.
    if(refresh||!this.healthDiscoveryAt||Date.now()-this.healthDiscoveryAt>300000){
      if(!this.healthDiscoveryRead){
        this.healthDiscoveryRead=Promise.all((Object.keys(commands) as CliAgent[]).map(async agent=>{
          if(process.env.CODEX_MOBILE_CONTROL_AGENTS&&!process.env.CODEX_MOBILE_CONTROL_AGENTS.split(',').includes(agent))return;
          try{await this.executable(agent);}
          catch(error){this.executables.delete(agent);this.discoveryErrors.set(agent,String((error as Error).message));}
        })).then(()=>{this.healthDiscoveryAt=Date.now();}).finally(()=>{this.healthDiscoveryRead=undefined;});
      }
      await this.healthDiscoveryRead;
    }
    const backends=this.backendSnapshot(viaPublic);
    await Promise.all(backends.map(async backend=>{
      const agent=backend.agent,command=this.executables.get(agent)?.command;
      let version=this.healthVersions.get(agent);
      if(version?.command!==command)version=undefined;
      if(backend.installed&&command&&(refresh||!version||Date.now()-version.at>300000)){
        const readKey=JSON.stringify([agent,command]);
        let pending=this.healthVersionReads.get(readKey);
        if(!pending){
          pending=(async()=>{
            let next:{command:string;version:string;error:string;at:number};
            try{
              const result=await this.discover(command,['--version'],{timeout:agent==='hermes'?20000:10000,windowsHide:true,reject:false});
              next={command,version:result.exitCode===0?result.stdout.trim().split(/\r?\n/)[0].slice(0,160):version?.version||'',error:result.exitCode===0?'':'版本检查未成功',at:Date.now()};
            }catch{next={command,version:version?.version||'',error:'版本检查超时或不可用',at:Date.now()};}
            if(this.executables.get(agent)?.command===command)this.healthVersions.set(agent,next);
          })().finally(()=>{this.healthVersionReads.delete(readKey);});
          this.healthVersionReads.set(readKey,pending);
        }
        if(refresh||!version)await pending;
      }
    }));
    // Assemble runtime state after version I/O, so a slow CLI cannot leave
    // another harness's active task count or availability frozen in the past.
    return this.backendSnapshot(viaPublic).map(backend=>{
      const agent=backend.agent,command=this.executables.get(agent)?.command;
      const saved=this.healthVersions.get(agent),version=saved?.command===command?saved:undefined;
      const activeCount=[...new Set([...this.active.keys(),...this.starting])].filter(id=>threadAgent(id)===agent).length;
      return {agent,name:backend.name,installed:backend.installed,available:backend.available,publicAllowed:backend.publicAllowed,state:backend.available?'ready':'unavailable',reason:backend.reason.split(/[\r\n：]/)[0].slice(0,240),version:version?.version||'',versionError:version?.error||'',activeCount,modelCount:this.catalog?this.catalog.models.filter(m=>modelAgent(m.model)===agent).length:null,supportsImages:backend.supportsImages,supportsApproval:backend.supportsApproval,checkedAt:new Date().toISOString(),lastFailure:this.lastFailures.get(agent)||null};
    });
  }
  owns(id:string){return this.active.has(id)||this.starting.has(id);}
  async resolveApproval(id:string,decision:'accept'|'decline'){
    const question=this.questions.get(id);
    if(question){
      if(decision==='accept')throw Error('请填写问题的回答');
      await this.store.resolveApproval(id,'decline');this.questions.delete(id);question.resolve(null);
      this.hub.publish({type:'approval.resolved',threadId:question.threadId,approvalId:id,decision});return;
    }
    const entry=this.permissions.get(id);if(!entry)throw Error('审批已失效');
    await this.store.resolveApproval(id,decision);this.permissions.delete(id);entry.resolve(decision==='accept');
    this.hub.publish({type:'approval.resolved',threadId:entry.threadId,approvalId:id,decision});
  }
  async answerQuestions(id:string,answers:Record<string,{answers:string[]}>){
    const entry=this.questions.get(id);if(!entry)throw Error('问题已回答或失效');
    const values:Record<string,string>={};
    const questionReplies=entry.questions.map(question=>{
      const answer=answers[question.id]?.answers;
      if(!Array.isArray(answer)||answer.length!==1||!answer[0].trim())throw Error('请回答所有问题');
      values[question.question]=answer[0];return {question:question.question,answer:answer[0]};
    });
    await this.store.resolveApproval(id,'accept');this.questions.delete(id);entry.resolve(values);
    this.hub.publish({type:'user.message',threadId:entry.threadId,text:questionReplies.map(r=>r.answer).join('\n'),questionReplyId:id,questionReplies});
    this.hub.publish({type:'approval.resolved',threadId:entry.threadId,approvalId:id,decision:'accept'});
  }
  private async askQuestions(threadId:string,input:any):Promise<Record<string,string>|null>{
    if(!this.active.has(threadId)||this.active.get(threadId)?.stopped)return null;
    const questions=(Array.isArray(input?.questions)?input.questions:[]).filter((q:any)=>typeof q.question==='string'&&q.question.trim()).map((q:any,index:number)=>({id:'q'+index,question:q.question,header:q.header,options:Array.isArray(q.options)?q.options:[]}));
    if(!questions.length)return null;
    const id='agent-question-'+randomUUID(),detail=JSON.stringify({questions});
    await this.store.addApproval({id,rpcId:id,method:'agent/question',threadId,approvalId:id,approvalType:'question',title:'需要你的回答',detail});
    if(!this.active.has(threadId)||this.active.get(threadId)?.stopped){await this.store.resolveApproval(id,'decline');return null;}
    const result=new Promise<Record<string,string>|null>(resolve=>this.questions.set(id,{threadId,questions,resolve}));
    this.hub.publish({type:'approval.requested',threadId,approvalId:id,approvalType:'question',title:'需要你的回答',detail});return result;
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
  async models(refresh=false):Promise<PickerModel[]>{
    const forceRefresh=refresh;
    if(this.catalog&&this.catalog.deepseekStamp!==deepseekConfigStamp())refresh=true;
    if(this.catalog&&this.catalog.opencodeStamp!==opencodeConfigStamp())refresh=true;
    if(!refresh&&this.catalog&&Date.now()-this.catalog.at<300000)return this.catalog.models;
    if(!this.catalogRead){
      this.catalogRead=this.discoverModels(forceRefresh).then(models=>{this.catalogRead=undefined;return models;},error=>{this.catalogRead=undefined;throw error;});
    }
    // Keep the last loaded picker usable while CLI catalogs refresh in the background.
    if(this.catalog&&!refresh){void this.catalogRead.catch(()=>{});return this.catalog.models;}
    const models=await this.catalogRead;
    if(this.catalog&&this.catalog.opencodeStamp!==opencodeConfigStamp())return this.models();
    return models;
  }
  private async discoverModels(refresh=false):Promise<PickerModel[]>{
    const deepseekStamp=deepseekConfigStamp();
    let opencodeStamp=opencodeConfigStamp();
    const models:PickerModel[]=[];
    await Promise.all(Object.entries(commands).map(async([engine])=>{
      if(process.env.CODEX_MOBILE_CONTROL_AGENTS&&!process.env.CODEX_MOBILE_CONTROL_AGENTS.split(',').includes(engine))return;
      try{
        const agent=engine as Exclude<Agent,'codex'>;
        const command=(await this.executable(agent)).command;
        if(agent==='deepseek'||agent==='hermes'||agent==='opencode'){
          try{
            if(agent==='opencode'){await refreshOpencodeModels(command,process.cwd(),this.discover,refresh);opencodeStamp=opencodeConfigStamp();}
            const catalog=await readHarnessCatalog(agent,command,process.cwd(),this.discover);
            this.protocolErrors.delete(agent);this.imageCapabilities.set(agent,catalog.supportsImages);this.planCapabilities.set(agent,catalog.supportsPlanMode);models.push(...catalog.models);
          }catch(error){this.protocolErrors.set(agent,String((error as Error).message));}
          return;
        }
        const add=(id:string,name:string)=>{
          const fixed=agent==='antigravity'?agyVariant.exec(id)?.[1]:undefined;
          models.push({model:`${agent}::${id}`,displayName:`${agentNames[agent]} · ${name}`,supportedReasoningEfforts:fixed?[{reasoningEffort:fixed}]:[],defaultReasoningEffort:fixed});
        };
        if(agent==='antigravity'){
          this.agyUsage.warm();
          // AGY catalogs encode effort as model variants (gemini-x-high). Collapse them into one
          // base model with selectable efforts, and pass the choice via --effort at launch.
          const baseModels=new Map<string,PickerModel>();
          let result;
          try{
            result=await this.discover(command,['models'],{timeout:30000,windowsHide:true,reject:false});
            if(result.exitCode!==0)throw Error(result.stderr||result.stdout||'AGY 模型目录读取失败');
            if(!result.stdout.split(/\r?\n/).some(line=>/^([\w.-]+)\t(.+)$/.test(line)))throw Error('AGY 未返回可用模型目录');
          }catch(error){
            // A transient catalog failure must not erase models or interrupt existing conversations.
            const previous=this.catalog?.models.filter(m=>modelAgent(m.model)===agent)||[];
            if(previous.length){models.push(...previous);return;}
            this.protocolErrors.set(agent,String((error as Error).message));return;
          }
          this.protocolErrors.delete(agent);
          add('default','默认模型');
          for(const line of result.stdout.split(/\r?\n/)){
            const match=/^([\w.-]+)\t(.+)$/.exec(line);
            if(!match)continue;
            const variant=agyVariant.exec(match[1])?.[1];
            const base=variant?match[1].slice(0,-variant.length-1):match[1];
            const name=match[2].replace(/\s*\((?:Low|Medium|High|XHigh|Max)\)$/i,'');
            const existing=baseModels.get(base);
            if(existing){
              if(variant&&!existing.supportedReasoningEfforts.some(e=>e.reasoningEffort===variant))existing.supportedReasoningEfforts.push({reasoningEffort:variant});
            }else{
              const entry:PickerModel={model:`${agent}::${base}`,displayName:`${agentNames[agent]} · ${name}`,supportedReasoningEfforts:variant?[{reasoningEffort:variant}]:[],defaultReasoningEffort:variant};
              baseModels.set(base,entry);models.push(entry);
            }
          }
          for(const entry of baseModels.values()){
            // CLI variant order is a catalog order, not slider intensity.
            const effortOrder=agyEfforts;
            entry.supportedReasoningEfforts.sort((a,b)=>effortOrder.indexOf(a.reasoningEffort)-effortOrder.indexOf(b.reasoningEffort));
            if(entry.supportedReasoningEfforts.some(e=>e.reasoningEffort==='medium'))entry.defaultReasoningEffort='medium';
            else{
              const ordered=effortOrder.find(e=>entry.supportedReasoningEfforts.some(x=>x.reasoningEffort===e));
              if(ordered)entry.defaultReasoningEffort=ordered;
            }
          }
        }else{
          const catalog=await readAgentCatalog(agent,command,this.discover).catch(()=>({models:[],supportsImages:undefined}));
          if(typeof catalog.supportsImages==='boolean')this.imageCapabilities.set(agent,catalog.supportsImages);
          if(catalog.models.length){models.push(...catalog.models);return;}
          add('default','默认模型');
          // Claude has no models subcommand: it treats this word as a prompt and starts a session.
          if(agent==='claude')return;
          const result=await this.discover(command,['models'],{timeout:12000,windowsHide:true,reject:false});
          for(const line of result.stdout.split(/\r?\n/)){
            const match=/^\s*[-*]\s+([\w.-]+)(?:\s|$)/.exec(line);
            if(match)add(match[1],match[1]);
          }
        }
      }catch(error){this.executables.delete(engine as CliAgent);this.discoveryErrors.set(engine as CliAgent,String((error as Error).message));}
    }));
    models.sort((a,b)=>modelAgent(a.model)==='opencode'&&modelAgent(b.model)==='opencode'?(a.providerId||'').localeCompare(b.providerId||'')||(a.model==='opencode::default'?-1:b.model==='opencode::default'?1:0)||(a.shortName||a.displayName).localeCompare(b.shortName||b.displayName):a.model.localeCompare(b.model));this.catalog={at:Date.now(),models,deepseekStamp,opencodeStamp};return models;
  }
  async validate(model?:string,id?:string){
    if(model?.startsWith('deepseek::'))model='deepseek::'+canonicalDeepseekModel(model.slice('deepseek::'.length));
    const agent=id?threadAgent(id):modelAgent(model);
    if(model&&modelAgent(model)!==agent)throw Error('这个会话属于 '+agentNames[agent]+'，请在新会话中切换助手');
    if(id&&this.store.readAgentMeta(id)?.transport==='acp'&&(agent==='claude'||agent==='antigravity')){
      const catalog=await this.officialModels(agent);
      if(!catalog.available)throw Error(catalog.reason);
      if(model&&!catalog.models.some(entry=>entry.model===model))throw Error('该模型不在 ACP 目录中');
      return;
    }
    if(model&&!(await this.models()).some(m=>m.model===model)){
      // Legacy AGY selections encode effort as a variant suffix (…-high); those collapse
      // into the base model with an explicit --effort, so accept them when the base exists.
      const legacy=/^(antigravity::[\w.-]+)-(low|medium|high|xhigh|max)$/.exec(model);
      if(!legacy||!(await this.models()).some(m=>m.model===legacy[1]))throw Error(agent==='opencode'?'模型已不在当前可用目录，请重新选择':'此助手或模型不可用，请刷新模型列表');
    }
  }
  async usage(id:string,agent:Agent=threadAgent(id),selectedModel?:string){
    const meta:Meta=id?this.store.readAgentMeta(id)||{}:{};
    const model=selectedModel&&modelAgent(selectedModel)===agent?selectedModel:meta.actualModel||meta.model;
    return {quota:agent==='antigravity'?await this.agyUsage.read(model):{windows:[],source:agent,stale:false},tokens:meta.tokens||null};
  }
  settings(id:string){
    const meta:Meta=this.store.readAgentMeta(id)||{};
    const legacy=threadAgent(id)==='antigravity'&&meta.transport!=='acp'&&meta.model?agyVariant.exec(meta.model):null;
    return {model:legacy?meta.model!.slice(0,-legacy[1].length-1):meta.model,effort:meta.effort||legacy?.[1],...(meta.actualModel?{actualModel:meta.actualModel}:{})};
  }
  private async ensureNativeDeepSeekThread(id:string){
    if(!id.startsWith('deepseek-'))return null;
    const session=await deepseekNativeSessions.read(id);if(!session)return null;
    if(!this.store.threads.some(thread=>thread.id===id)){
      await this.store.upsertThread({id,projectPath:session.thread.projectPath,title:session.thread.title,status:session.thread.status});
      this.store.writeAgentMeta(id,{session:session.sessionId,model:session.model,effort:session.effort});
    }
    return session;
  }
  async resume(id:string){await this.ensureNativeDeepSeekThread(id);const thread=this.store.threads.find(t=>t.id===id);if(!thread)throw Error('会话不存在');this.hub.publish({type:'thread.started',threadId:id,thread});}
  async handle(command:any){
    if(command.permission==='custom')throw Error('自定义权限仅适用于 Codex');
    // AGY 图片校验前置：否则 thread.start 先建线程、后因图片抛错，列表里会留下空会话。
    if(command.agentTransport!=='acp'&&command.images?.length&&command.type==='thread.start'&&modelAgent(command.model)==='antigravity')throw Error('当前 Antigravity CLI 不支持图片消息；请改用文件附件或支持图片的后端');
    if(command.type==='turn.interrupt'){
      const run=this.active.get(command.threadId);if(!run)throw Error('当前没有运行中的任务');
      run.stopped=true;for(const [id,p] of this.permissions)if(p.threadId===command.threadId)await this.resolveApproval(id,'decline');
      for(const [id,p] of this.questions)if(p.threadId===command.threadId)await this.resolveApproval(id,'decline');
      try{
        if(typeof run.process.interrupt==='function')await run.process.interrupt();
        else if(process.platform==='win32'&&run.process.pid){
          const result=await this.terminate('taskkill.exe',['/PID',String(run.process.pid),'/T','/F'],{windowsHide:true,reject:false});
          if(result.exitCode!==0){
            // taskkill may race the owned process's exit; wait for its own completion,
            // including closed pipes, before interpreting a nonzero taskkill status.
            let timer:ReturnType<typeof setTimeout>|undefined;
            const exited=await Promise.race([
              Promise.resolve(run.process).then(()=>true,()=>true),
              new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),1000);}),
            ]).finally(()=>clearTimeout(timer));
            if(!exited)throw Error(`停止失败：后台进程仍在运行，请重试（taskkill ${result.exitCode}：${String(result.stderr||result.stdout||'未提供原因').trim().slice(0,400)}）`);
          }
        }else if(run.process.kill()===false)throw Error('停止失败：后台进程仍在运行，请重试');
      }catch(error){if(this.active.get(command.threadId)===run)run.stopped=false;throw error;}
      return;
    }
    if(command.type==='thread.resume'){await this.resume(command.threadId);return;}
    if(!['thread.start','turn.start'].includes(command.type))throw Error('此助手暂不支持这个操作');
    const existing=command.threadId;
    if(existing&&this.starting.has(existing))throw Error('任务仍在运行，请将消息加入队列');
    if(existing)this.starting.add(existing);
    try{await this.start(command);}finally{if(existing)this.starting.delete(existing);}
  }
  private async start(command:any){
    let id=command.threadId;
    try{
    const native=id?await this.ensureNativeDeepSeekThread(id):null;
    if(id&&!this.store.threads.some(t=>t.id===id))throw Error('会话不存在');
    if(this.active.has(id))throw Error('任务仍在运行，请将消息加入队列');
    if(native?.thread.status==='running')throw Error('DeepSeek 桌面会话仍在运行，请等待当前轮完成');
    const meta:Meta=id?this.store.readAgentMeta(id)||{}:{};
    let model=command.model||meta.model;
    if(model?.startsWith('deepseek::'))model='deepseek::'+canonicalDeepseekModel(model.slice('deepseek::'.length));

    const agent=(id?threadAgent(id):modelAgent(model)) as Exclude<Agent,'codex'>;
    const official=(command.agentTransport==='acp'||meta.transport==='acp')&&(agent==='claude'||agent==='antigravity');
    if(official&&meta.session&&meta.transport!=='acp')throw Error('原会话使用 CLI 协议，请创建新的 ACP 助理任务');
    if(official){const catalog=await this.officialModels(agent);if(!catalog.available)throw Error(catalog.reason);if(model&&!catalog.models.some(entry=>entry.model===model))throw Error('该模型不在 ACP 目录中');}
    else await this.validate(model,id);
    if(['grok','deepseek','hermes','opencode'].includes(agent)&&command.mode==='plan'&&this.planCapabilities.get(agent)!==true)throw Error(`${agentNames[agent]} 当前配置未提供计划模式`);
    if(command.fast===true)throw Error('当前助手未提供快速模式切换');
    if(!official&&command.images?.length&&this.imageCapabilities.get(agent)===false)throw Error(`当前 ${agentNames[agent]} CLI 不支持图片消息；请使用支持图片的后端，或作为文件附件发送。`);
    const text=command.initialText??command.text??'';
    if(agent==='antigravity'&&!official&&(text.trim()||command.images?.length||command.files?.length)&&!['auto','full'].includes(command.permission)){
      throw Error('Antigravity CLI 无逐条审批能力，不能执行“询问”权限任务；请选择自动审批或完全访问，或改用支持审批的后端。');
    }
    const files=await resolveFiles(command.files);
    if(agent==='antigravity'&&!official&&command.images?.length)throw Error('当前 Antigravity CLI 不支持图片消息；请改用文件附件或支持图片的后端');
    const images=await imageInputs(command.images);
    let effort=(command.effort||(model===meta.model?meta.effort:undefined)) as string|undefined;
    if(agent==='deepseek'||agent==='hermes'||agent==='opencode'){
      const entry=(await this.models()).find(m=>m.model===model);
      if(!command.effort&&effort&&!entry?.supportedReasoningEfforts.some(level=>level.reasoningEffort===effort))effort=entry?.defaultReasoningEffort;
    }
    if(agent==='antigravity'&&!official){
      const legacy=model&&agyVariant.exec(model);
      const base=legacy?model.slice(0,-legacy[1].length-1):model;
      const oldBase=meta.model?.replace(agyVariant,'');
      const entry=(await this.models()).find(m=>m.model===base);
      effort=effort||legacy?.[1]||(base===oldBase?meta.effort:undefined)||entry?.defaultReasoningEffort;
      if(effort&&(!agyEfforts.includes(effort)||(entry?.supportedReasoningEfforts?.length&&!entry.supportedReasoningEfforts.some(e=>e.reasoningEffort===effort))))throw Error('此模型不支持所选推理强度，请刷新模型列表');
      model=base;
    }
    const executable=official?{command:''}:await this.executable(agent);
    if(model!==meta.model)delete meta.actualModel;
    if(command.type==='thread.start'){
      id=`${agent}-${randomUUID()}`;
      // The ID becomes visible before asynchronous CLI startup finishes.
      this.starting.add(id);
      await this.onThreadCreated?.(command.requestId,id);
      const thread=await this.store.upsertThread({id,projectPath:command.projectPath,title:command.initialText?.trim().slice(0,60)||'新会话',status:'idle'});
      this.store.writeAgentMeta(id,{model,effort,...(official||agent==='opencode'?{transport:'acp'}:{})});
      this.hub.publish({type:'thread.started',threadId:id,thread,requestId:command.requestId});
    }
    if(!text.trim()&&!command.images?.length&&!files.length)return;
    const prompt=text+filePrompt(files);
    const content:any[]=[{type:'text',text:prompt}];
    for(const image of images){
      const match=/^data:([^;]+);base64,(.*)$/.exec(image.url)!;
      content.push({type:'image',source:{type:'base64',media_type:match[1],data:match[2]}});
    }
    // AGY's documented stream input accepts text blocks only; never silently discard attachments.
    if(agent==='antigravity'&&!official&&content.length>1)throw Error('当前 Antigravity CLI 不支持图片消息；请改用文件附件或支持图片的后端');
    const args:string[]=[];let input:string|undefined;
    const rawModel=model?.slice(model.indexOf('::')+2);
    if(agent==='claude'){
      args.push('-p','--verbose','--include-partial-messages','--permission-prompt-tool','stdio','--input-format','stream-json','--output-format','stream-json','--permission-mode',command.mode==='plan'?'plan':command.permission==='full'?'bypassPermissions':command.permission==='auto'?'acceptEdits':'default');
      if(meta.session)args.push('--resume',meta.session);
      input=JSON.stringify({type:'user',message:{role:'user',content}})+'\n';
    }else if(agent==='antigravity'&&!official){
      args.push('--input-format','stream-json','--output-format','stream-json');
      if(meta.session)args.push('--conversation',meta.session);
      if(command.permission==='full')args.push('--dangerously-skip-permissions');
      if(command.mode==='plan')args.push('--mode','plan');
      else if(command.permission==='auto')args.push('--mode','accept-edits');
      input=JSON.stringify({event:'user',message:{content:prompt}})+'\n';
    }
    if(rawModel&&rawModel!=='default')args.push('--model',rawModel);
    // AGY catalog ids no longer encode effort; --effort is the single source for both
    // fresh picks (base model + effort) and legacy variant ids mapped above.
    if(agent==='antigravity'&&!official){if(effort)args.push('--effort',effort);}
    else if(effort)args.push(agent==='grok'?'--reasoning-effort':'--effort',effort);
    const cwd=command.projectPath||this.store.threads.find(t=>t.id===id)?.projectPath;
    const acpOptions={command:executable.command,cwd,session:meta.session,model:rawModel,effort,mode:command.mode,permission:command.permission,content,approve:(params:any)=>this.approve(id,params)};
    const child=official?officialAcp({agent,cwd,session:meta.session,model:rawModel,effort,permission:command.permission,mode:command.mode,content,approve:acpOptions.approve},this.launch,this.terminate):agent==='grok'?grokAcp(acpOptions,this.launch,this.terminate):agent==='deepseek'||agent==='hermes'||agent==='opencode'?harnessAcp({agent,...acpOptions},this.launch,this.terminate):agent==='antigravity'?(await this.agyCli.run(id,executable.command,args,cwd,input!)).process:this.launch(executable.command,args,{cwd,windowsHide:true,reject:false,buffer:false,stdin:'pipe'});
    if(agent==='claude'&&'stdin' in child)child.stdin?.write(input!);
    const run={process:child,stopped:false};this.active.set(id,run);
    meta.model=model;meta.effort=effort;if(official||agent==='opencode')meta.transport='acp';this.store.writeAgentMeta(id,meta);
    await this.store.upsertThread({id,status:'running'});
    const turnId=randomUUID();
    this.hub.publish({type:'user.message',threadId:id,turnId,text,images:command.images,files:command.files,requestId:command.requestId});
    this.hub.publish({type:'turn.started',threadId:id,turnId,requestId:command.requestId});
    void this.consume(id,agent,child,run,meta,model,turnId);
    }finally{if(command.type==='thread.start'&&id)this.starting.delete(id);}
  }
  private async consume(id:string,agent:CliAgent,child:any,run:{stopped:boolean},meta:Meta,model:string,turnId:string){
    const legacyAgy=agent==='antigravity'&&meta.transport!=='acp';
    let stderr='',responded=false,resultSeen=false,failed=false,streamed=false,compacting=false;
    const agyResponses=new Map<string,string>();
    let agyResponseId='',agyFinal:string|undefined,agyIntegrityError='';
    const seenTools=new Set<string>(),completedTools=new Set<string>(),toolOutput=new Map<string,string>();
    const toolFiles=new Map<string,string[]>();
    const assistantTextIds=new Set<string>();
    child.stderr?.on('data',(data:Buffer)=>{stderr=(stderr+data.toString()).slice(-6000);});
    try{
      for await(const line of createInterface({input:child.stdout})){
        let record;try{record=JSON.parse(line);}catch{continue;}
        if(agent==='claude'&&record.type==='system'){
          if(record.subtype==='status'&&record.status==='compacting'){
            compacting=true;this.hub.publish({type:'context.compaction',threadId:id,itemId:turnId+':compact',title:'正在压缩上下文',status:'running'});
          }else if(compacting&&(record.subtype==='compact_boundary'||record.subtype==='status'&&record.status==null)){
            compacting=false;this.hub.publish({type:'context.compaction',threadId:id,itemId:turnId+':compact',title:'上下文已压缩',status:'ok'});
          }
        }
        const actualModel=record.model||record.model_id||record.message?.model||record.result?.model;
        if(typeof actualModel==='string'&&actualModel.length<=200&&actualModel!==meta.actualModel){meta.actualModel=actualModel;this.store.writeAgentMeta(id,meta);}
        if(agent==='claude'&&record.type==='control_request'){
          const request=record.request;
          if(request?.subtype==='can_use_tool'){
            if(request.tool_name==='AskUserQuestion'){
              void this.askQuestions(id,request.input).then(answers=>{
                if(child.stdin?.writable)child.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:record.request_id,response:answers?{behavior:'allow',updatedInput:{...request.input,answers}}:{behavior:'deny',message:'问题已取消'}}})+'\n');
              });continue;
            }
            void this.approve(id,{toolCall:{title:request.tool_name,rawInput:request.input}}).then(accepted=>{
              if(child.stdin?.writable)child.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:record.request_id,response:accepted?{behavior:'allow',updatedInput:request.input}:{behavior:'deny',message:'用户拒绝本次操作'}}})+'\n');
            });
          }else if(child.stdin?.writable)child.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'error',request_id:record.request_id,error:'Unsupported client request'}})+'\n');
          continue;
        }
        if(record.type==='stream_event'&&record.event?.delta?.type==='text_delta'){
          const text=record.event.delta.text;if(text){streamed=true;responded=true;this.hub.publish({type:'message.delta',threadId:id,turnId,itemId:turnId+':reply',text});}
        }
        // Claude repeats completed messages after text deltas; ACP messages are distinct chunks
        // of the same reply and must all reach the timeline.
        const assistantId=agent==='claude'&&record.type==='assistant'?record.message?.id:undefined;
        const repeatedAssistant=!!assistantId&&assistantTextIds.has(assistantId);
        const updates=agentUpdates(meta.transport==='acp'?'claude':agent,record).filter(e=>!(record.type==='assistant'&&(streamed||repeatedAssistant)&&e.kind==='text'));
        if(assistantId)assistantTextIds.add(assistantId);
        if(record.type==='assistant')streamed=false;
        for(const event of updates){
          const itemId=turnId+':'+(event.id||'reply');
          if(event.kind==='session'&&event.id){meta.session=event.id;meta.model=model;this.store.writeAgentMeta(id,meta);}
          if(event.kind==='plan'&&event.text)this.hub.publish({type:'plan.updated',threadId:id,turnId,title:'任务计划',text:event.text});
          if(event.kind==='retry'&&event.text)this.hub.publish({type:'error',threadId:id,turnId,title:'正在重试',message:event.text,willRetry:true});
          if(event.kind==='text'&&event.text){
            responded=true;
            if(legacyAgy){agyResponseId=itemId;agyResponses.set(itemId,(agyResponses.get(itemId)||'')+event.text);}
            this.hub.publish({type:'message.delta',threadId:id,turnId,itemId,text:event.text});
          }
          if(event.kind==='tool'){
            if(event.files?.length)toolFiles.set(itemId,event.files);
            if(!seenTools.has(itemId)){seenTools.add(itemId);this.hub.publish({type:'tool.started',threadId:id,itemId,title:event.name||'执行工具',detail:event.text});}
          }
          if(event.kind==='output'){
            const value=event.text||'',previous=toolOutput.get(itemId)||'';
            const delta=legacyAgy&&value.startsWith(previous)?value.slice(previous.length):value;
            toolOutput.set(itemId,value);
            if(delta)this.hub.publish({type:'tool.output',threadId:id,itemId,text:delta});
          }
          if(event.kind==='complete'&&!completedTools.has(itemId)){
            completedTools.add(itemId);this.hub.publish({type:'tool.completed',threadId:id,itemId,status:event.error?'error':'ok'});
            const files=event.files?.length?event.files:toolFiles.get(itemId);
            if(!event.error&&files?.length)this.hub.publish({type:'file.changed',threadId:id,turnId,itemId,files,summary:`${files.length} 个文件变更`,diff:event.diff});
          }
          if(event.kind==='result'){
            if(resultSeen){
              if(legacyAgy&&(event.error||event.text!==agyFinal))agyIntegrityError='AGY 最终结果不一致，回答未能确认完整；请保留当前内容并检查服务状态。';
              continue;
            }
            resultSeen=true;failed=!!event.error;
            if(agent==='claude')child.stdin?.end();
            if(legacyAgy)agyFinal=event.text;
            else if(!responded&&event.text&&!failed)this.hub.publish({type:'message.delta',threadId:id,turnId,itemId,text:event.text});
            if(failed&&event.text)stderr=event.text;
            if(event.usage){
              const u=event.usage,old=meta.tokens||{};
              const metric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
              const cached=metric(u.cache_read_input_tokens??u.cache_read_tokens),rawOutput=metric(u.output_tokens),rawInput=metric(u.input_tokens);
              const output=rawOutput===null?null:rawOutput+(agent==='opencode'?(metric(u.thinking_tokens)??0):0);
              const input=rawInput===null?null:rawInput+((agent==='claude'||legacyAgy||agent==='opencode')?(cached??0)+(metric(u.cache_creation_input_tokens)??0):0);
              const total=input!==null&&output!==null?input+output:metric(u.total_tokens);
              const accumulate=(previous:number|null|undefined,value:number|null)=>value===null?previous??null:(previous??0)+value;
              const contextWindow=u.context_window??record.modelUsage?.[meta.actualModel||'']?.contextWindow??old.contextWindow??null;
              meta.tokens={input:accumulate(old.input,input),cached:accumulate(old.cached,cached),output:accumulate(old.output,output),reasoning:accumulate(old.reasoning,metric(u.thinking_tokens)),total:accumulate(old.total,total),last:total,contextWindow,context:metric(u.context_used)??old.context??null};this.store.writeAgentMeta(id,meta);
              this.hub.publish({type:'usage.updated',threadId:id});
            }
          }
        }
      }
      const result=await child;
      if(!run.stopped&&(failed||result.exitCode!==0||!resultSeen))throw Error(stderr||`${agentNames[agent]} 未正常结束（${result.exitCode}）`);
      // Reconcile after stdout drains: EOF may include an unterminated final line
      // or text arriving after the result. Never synthesize text on failed/cancelled runs.
      if(legacyAgy&&!run.stopped){
        if(agyIntegrityError)throw Error(agyIntegrityError);
        if(agyFinal!==undefined){
          const responseId=agyResponseId||turnId+':reply',partial=agyResponses.get(responseId)||'';
          if(!agyFinal.startsWith(partial))throw Error('AGY 流式正文与最终结果不一致，回答未能确认完整；请保留当前内容并检查服务状态。');
          const suffix=agyFinal.slice(partial.length);
          if(suffix)this.hub.publish({type:'message.delta',threadId:id,turnId,itemId:responseId,text:suffix});
        }
      }
      await this.store.upsertThread({id,status:run.stopped?'interrupted':'completed'});
      this.hub.publish({type:'turn.completed',threadId:id,turnId,status:run.stopped?'interrupted':'completed'});
    }catch(error){if(legacyAgy)try{await this.agyCli.forget(id);}catch(closeError){error=Error(String((error as Error).message)+'；'+String((closeError as Error).message));}await this.store.upsertThread({id,status:run.stopped?'interrupted':'error'});if(!run.stopped){this.lastFailures.set(agent,{message:String((error as Error).message).slice(0,500),at:new Date().toISOString()});this.hub.publish({type:'error',threadId:id,message:String((error as Error).message)});}this.hub.publish({type:'turn.completed',threadId:id,turnId,status:run.stopped?'interrupted':'error'});}
    finally{for(const itemId of seenTools)if(!completedTools.has(itemId))this.hub.publish({type:'tool.completed',threadId:id,itemId,status:run.stopped?'cancelled':'error'});for(const [approval,p] of this.permissions)if(p.threadId===id)await this.resolveApproval(approval,'decline');for(const [question,p] of this.questions)if(p.threadId===id)await this.resolveApproval(question,'decline');this.active.delete(id);if(legacyAgy)this.agyCli.release(id);}
  }
}
