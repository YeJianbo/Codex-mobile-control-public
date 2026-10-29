import {CommandReceipts,SubmissionNotStartedError} from './commandReceipts.js';
import {stripSessionInstructionPrefix} from './agentInstructions.js';
import {deepseekNativeSessions} from './deepseekNativeSessions.js';
import {zcodeNativeSessions} from './zcodeNativeSessions.js';
import {assertControllableThread} from './cloudSnapshots.js';
import {historyToolPresentation,invalidateCodexHistory,desktopAsyncQuestionEvent,splitDesktopAttachments} from './codexSessions.js';
import {codexImageInputs,type ImageAttachment} from './imageUploads.js';
import {resolveFiles,codexFilePrompt,type FileAttachment} from './fileUploads.js';
import type { CodexAppServerClient } from "../codex/appServerClient.js";
import type { EventHub } from "./eventHub.js";
import type { StateStore } from "./stateStore.js";
import {readModelCatalog,consoleModelOverrides} from './modelCatalog.js';
import {desktopThreadSettings} from './desktopSidebar.js';
import {readUserSettings,readCustomPermissions} from './codexSettings.js';
import {isWriterOccupied} from './userFacingError.js';
import {AgentSessions,type AgentSessionPort} from './agentSessions.js';
import {modelAgent,threadAgent,publicAgentAllowed} from './agentProtocol.js';
import {readRemoteAutoApproval} from './remoteApprovalSettings.js';
import {latestMobileThreadLifecycle} from './mobileHistory.js';
import {readCodexGoals} from './codexGoals.js';
import type {GatewayEvent,PendingApproval} from '../types.js';
import {codexErrorPresentation,isCapacityError} from './codexError.js';
import {LoadedThreadSubscriptions} from './loadedThreadSubscriptions.js';
import {mcpElicitationMethod,elicitationPrompt,elicitationDecision,elicitationAnswer,confirmationElicitation,elicitationParams} from './mcpElicitation.js';
import type {CodexGoal} from './codexGoals.js';
import {CodexCommandOutput} from './codexCommandOutput.js';

type ThreadStartResult = {
  thread?: {
    id?: string;
  };
};

export const APP_SERVER_CLIENT_REQUEST_METHODS = [
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/goal/clear",
  "thread/unsubscribe",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/terminate",
  "review/start",
  "turn/start",
  "turn/interrupt",
] as const;

export const APP_SERVER_NOTIFICATION_METHODS = [
  "thread/tokenUsage/updated",
  "thread/started",
  "thread/settings/updated",
  "serverRequest/resolved",
  "thread/status/changed",
  "thread/name/updated",
  "turn/started",
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "turn/plan/updated",
  "item/plan/delta",
  "turn/completed",
  "turn/diff/updated",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "warning",
  "guardianWarning",
  "configWarning",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "autoApprovalReview/strictReviewRequired",
  "item/started",
  "item/completed",
  "remoteControl/status/changed",
  "error",
] as const;

export const APP_SERVER_REQUEST_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "execCommandApproval",
  "applyPatchApproval",
] as const;

type MethodObservation = {
  method: string;
  count: number;
  lastSeenAt: string;
};

export type ClientCommand = (
  | { type: "thread.start"; requestId?: string; projectPath?: string; model?: string; effort?:string; mode?:"plan"|"default"; fast?:boolean; permission?:"ask"|"auto"|"full"|"custom"; initialText?: string; images?: ImageAttachment[]; files?:FileAttachment[] }
  | { type: "thread.resume"; requestId?: string; threadId: string; projectPath?: string; model?: string }
  | { type: "turn.start"; requestId?: string; threadId: string; projectPath?: string; model?: string; effort?:string; mode?:"plan"|"default"; fast?:boolean; permission?:"ask"|"auto"|"full"|"custom"; text: string; images?: ImageAttachment[]; files?:FileAttachment[]; continueGoal?:boolean; replaceTurnId?:string; keepAttachmentPaths?:string[] }
  | { type: "turn.interrupt"; requestId?: string; threadId: string }
  | { type: "approval.resolve"; requestId?: string; approvalId: string; decision: "accept" | "decline" }
  | { type: "debug.echo"; requestId?: string; threadId?: string; text: string; images?: ImageAttachment[] }) & {agentTransport?:'acp'};

async function permissionOverrides(permission:"ask"|"auto"|"full"|"custom") {
  if(permission === "custom") return readCustomPermissions();
  return permission === "full"
    ? {approvalPolicy:"never",approvalsReviewer:"user",sandbox:"danger-full-access",sandboxPolicy:{type:"dangerFullAccess"}}
    : {approvalPolicy:"on-request",approvalsReviewer:permission === "auto" ? "auto_review" : "user",sandbox:"workspace-write",sandboxPolicy:{type:"workspaceWrite"}};
}

function mirroredApproval(left:Pick<PendingApproval,'rpcId'|'method'|'threadId'|'turnId'|'itemId'|'approvalId'>,right:Pick<PendingApproval,'rpcId'|'method'|'threadId'|'turnId'|'itemId'|'approvalId'>):boolean {
  const source=(id:string|number)=>/^desktop:\d+:(?:\d+:)?(.+)$/.exec(String(id))?.[1];
  const a=source(left.rpcId),b=source(right.rpcId);
  // Only compare the direct and bridge copies of one operation. Distinct
  // desktop connections can reuse RPC IDs and must remain independent.
  return Boolean(a)!==Boolean(b)&&(a??String(left.rpcId))===(b??String(right.rpcId))
    &&left.method===right.method&&left.threadId===right.threadId&&Boolean(left.itemId)&&left.itemId===right.itemId
    &&left.turnId===right.turnId&&left.approvalId===right.approvalId;
}

export class SessionManager {
  private readonly commandOutput=new CodexCommandOutput(event=>this.hub.publish(event));
  readonly agents:AgentSessionPort;
  readonly receipts=new CommandReceipts();
  private reconcilingApprovalMirrors?:Promise<void>;
  private readonly compactionOutputs=new Map<string,{itemId?:string;parts:string[]}>();

  private readonly publicActiveTurns = new Set<string>();
  private readonly activeThreads = new Set<string>();
  private readonly relayThreads = new Map<string,boolean>();
  private readonly activeTurns = new Map<string, string>();
  private readonly statusReads = new Map<string,Promise<unknown>>();
  private readonly startingTurns = new Set<string>();
  private readonly pausingGoals = new Map<string,Promise<void>>();
  private readonly completedDuringStart = new Map<string, Set<string>>();
  private readonly approvalPermissions = new Map<string, Record<string, unknown>>();
  private readonly resolvingApprovals = new Set<string>();
  private readonly unknownNotifications = new Map<string, MethodObservation>();
  private readonly unsupportedServerRequests = new Map<string, MethodObservation>();
  private capacityAutoRetry=false;
  private readonly loadedSubscriptions:LoadedThreadSubscriptions;
  private readonly capacityErrors=new Map<string,{turnId?:string;error:unknown}>();
  private readonly explicitlyStopped=new Set<string>();
  private readonly turnGoals=new Map<string,CodexGoal>();
  private readonly capacityStarts=new Map<string,Promise<void>>();
  private readonly capacityRetries=new Map<string,{turnId:string;attempt:number;goal?:CodexGoal;timer?:NodeJS.Timeout;launching:boolean;awaitingStart?:boolean;startedTurnId?:string}>();

  setCapacityAutoRetry(enabled:boolean){
    this.capacityAutoRetry=enabled;
    this.loadedSubscriptions.setEnabled(enabled);
    if(!enabled)for(const [id,entry] of [...this.capacityRetries]){this.cancelCapacityRetry(id);if(!entry.launching&&!entry.awaitingStart)void this.finishCapacityFailure(id,'容量不足自动重试已关闭');}
  }
  cancelCapacityRetry(threadId:string){
    const entry=this.capacityRetries.get(threadId);if(entry?.timer)clearTimeout(entry.timer);
    this.capacityRetries.delete(threadId);this.capacityErrors.delete(threadId);this.turnGoals.delete(threadId);
  }
  capacityRetryStatus(){return {...this.loadedSubscriptions.status(),pendingRetries:this.capacityRetries.size};}
  closeCapacityRetries(){this.loadedSubscriptions.close();for(const id of [...this.capacityRetries.keys()])this.cancelCapacityRetry(id);this.explicitlyStopped.clear();}
  async cancelCapacityWork(threadId:string){this.cancelCapacityRetry(threadId);await this.capacityStarts.get(threadId);}
  isCapacityRetryPending(threadId:string){return this.capacityRetries.has(threadId);}
  private async finishCapacityFailure(threadId:string,message:string){
    await this.store.upsertThread({id:threadId,status:'error'});
    this.hub.publish({type:'error',threadId,message,title:'自动重试已停止',willRetry:false});
    this.hub.publish({type:'turn.completed',threadId,status:'error'});
    await this.pauseInterruptedGoal(threadId,'error').catch(()=>{});
  }
  private queueCapacityRetry(threadId:string,turnId:string|undefined,error:unknown,waitingForSession=false):boolean {
    if(!this.capacityAutoRetry||this.explicitlyStopped.has(threadId)||!turnId||threadId==='unknown'||!waitingForSession&&!isCapacityError(error))return false;
    const previous=this.capacityRetries.get(threadId);
    if(previous?.turnId===turnId&&(previous.timer||previous.launching||previous.awaitingStart))return true;
    const attempt=(previous?.attempt??0)+1;
    const latestGoal=this.goals().get(threadId);
    const goal=previous?.goal??this.turnGoals.get(threadId)??(latestGoal?.status==='active'?{...latestGoal}:undefined);
    const entry={turnId,attempt,goal,launching:false,timer:undefined as NodeJS.Timeout|undefined};
    // Reattaching a session is local recovery, not another model capacity failure.
    const delay=Math.round((waitingForSession?Math.min(1000*2**Math.min(attempt-1,3),8000):Math.min(15000*2**Math.min(attempt-1,3),120000))*(1+Math.random()*.1));
    this.capacityRetries.set(threadId,entry);
    void this.store.upsertThread({id:threadId,status:'running'});
    this.hub.publish({type:'error',threadId,turnId,title:waitingForSession?'等待会话恢复':'容量不足，等待重试',message:`${waitingForSession?'正在重新连接会话':'模型繁忙'}，${Math.ceil(delay/1000)} 秒后自动重试（第 ${attempt} 次）`,willRetry:true});
    entry.timer=setTimeout(()=>{
      entry.timer=undefined;const work=this.retryCapacityTurn(threadId,entry);this.capacityStarts.set(threadId,work);
      void work.finally(()=>{if(this.capacityStarts.get(threadId)===work)this.capacityStarts.delete(threadId);}).catch(()=>{});
    },delay);
    entry.timer.unref?.();
    return true;
  }
  private async retryCapacityTurn(threadId:string,entry:{turnId:string;attempt:number;goal?:CodexGoal;launching:boolean;awaitingStart?:boolean}){
    const current=()=>this.capacityAutoRetry&&this.capacityRetries.get(threadId)===entry;
    if(!current())return;
    let starting=false;
    try{
      await this.pausingGoals.get(threadId);
      if(!current())return;
      let result=readRecord(await this.codex.request('thread/read',{threadId,includeTurns:false}));
      if(!current())return;
      const status=()=>readString(readRecord(result?.thread)?.status)??readString(readRecord(readRecord(result?.thread)?.status)?.type);
      let backend=status();
      if(backend==='notLoaded'){
        this.activeThreads.delete(threadId);
        await this.resumeThread(threadId);
        if(!current())return;
        result=readRecord(await this.codex.request('thread/read',{threadId,includeTurns:false}));
        if(!current())return;
        backend=status();
      }
      if(backend==='active'){this.cancelCapacityRetry(threadId);return;}
      // systemError describes the previous failed turn. Like manual Continue,
      // a new turn can start from it; waiting for idle would never clear it.
      if(backend!=='idle'&&backend!=='systemError')throw Object.assign(new Error('等待电脑会话恢复'),{code:'CAPACITY_RETRY_SESSION_PENDING'});
      if(this.startingTurns.has(threadId)){this.cancelCapacityRetry(threadId);return;}
      if(entry.goal){
        const goal=this.goals().get(threadId);
        if(!goal||goal.objective!==entry.goal.objective||goal.goalId!==entry.goal.goalId||!['active','paused','blocked'].includes(goal.status)){
          this.cancelCapacityRetry(threadId);await this.finishCapacityFailure(threadId,'目标状态已改变，请确认后手动继续');return;
        }
      }
      entry.launching=true;entry.awaitingStart=true;starting=true;this.startingTurns.add(threadId);
      if(entry.goal)await this.codex.request('thread/goal/set',{threadId,status:'active'});
      else{
        // A standalone client tool result resumes existing input without adding
        // another user message or repeating actions from the failed turn.
        const started=readRecord(await this.codex.request('turn/start',{threadId,input:[],turnTrigger:'capacity_retry',toolOutput:{name:'gateway_capacity_retry',output:JSON.stringify({failedTurnId:entry.turnId,reason:'model_at_capacity',attempt:entry.attempt})}}));
        const id=readNestedString(started??{},['turn','id']);
        if(id&&!this.activeTurns.has(threadId)&&this.store.threads.find(t=>t.id===threadId)?.status==='running')this.activeTurns.set(threadId,id);
      }
    }catch(error){
      if(!current())return;
      entry.launching=false;entry.awaitingStart=false;
      if(isCapacityError(error)&&this.queueCapacityRetry(threadId,entry.turnId,error))return;
      if(!starting&&((error as {code?:string})?.code==='CAPACITY_RETRY_SESSION_PENDING'||/timeout|timed out|EPIPE|ECONNRESET|ETIMEDOUT|closed|disconnect|超时|断开|退出|已关闭|尚未启动/i.test(String(error)))&&this.queueCapacityRetry(threadId,entry.turnId,error,true))return;
      if(starting){this.startingTurns.delete(threadId);starting=false;}
      this.cancelCapacityRetry(threadId);await this.finishCapacityFailure(threadId,String(error instanceof Error?error.message:error));
    }finally{if(starting)this.startingTurns.delete(threadId);entry.launching=false;}
  }



  constructor(
    private readonly codex: CodexAppServerClient,
    private readonly hub: EventHub,
    private readonly store: StateStore,
    private readonly goals=readCodexGoals,
    private readonly defaultWorkspace?: (prompt?:string)=>Promise<string>,
    agents?:AgentSessionPort,
  ) {
    this.loadedSubscriptions=new LoadedThreadSubscriptions(this.codex,{
      canSubscribe:id=>!this.store.isThreadHidden(id),
      onError:(error,id)=>console.warn('容量重试会话订阅失败',id??'',String(error instanceof Error?error.message:error).slice(0,240)),
    });
    this.agents=agents??new AgentSessions(store,hub);
    this.agents.onThreadCreated=(requestId,threadId)=>this.receipts.noteThread(requestId,threadId);
    this.codex.on("notification", (message) => this.handleCodexNotification(message));
    this.codex.on("serverRequest", (message) => void this.handleServerRequest(message));
    this.codex.on("stderr", (text) => {
      this.hub.publish({ type: "terminal.output", threadId: "app-server", stream: "stderr", text: String(text) });
    });
    this.codex.on("exit", (_code:unknown,context?:{shared?:boolean}) => {
      this.compactionOutputs.clear();
      this.activeThreads.clear();
      this.relayThreads.clear();
      this.activeTurns.clear();
      this.approvalPermissions.clear();
      const pending = this.store.approvals.filter(approval => approval.status === "pending");
      void this.store.expirePendingApprovals();
      for (const approval of pending) this.hub.publish({ type: "approval.resolved", threadId: approval.threadId, approvalId: approval.id, decision: "resolved" });
      for (const thread of this.store.threads.filter((item) => item.status === "running"&&!context?.shared&&threadAgent(item.id)==='codex')) {
        void this.store.upsertThread({ id: thread.id, status: "error" });
        this.hub.publish({ type: "turn.completed", threadId: thread.id, status: "error" });
      }
    });
  }

  ownsThread(threadId:string):boolean { return this.capacityRetries.has(threadId)||this.agents.owns(threadId)||this.activeTurns.has(threadId) || this.startingTurns.has(threadId); }
  async pauseInterruptedGoal(threadId:string,status:string):Promise<void> {
    if(this.capacityRetries.has(threadId)||this.capacityAutoRetry&&this.capacityErrors.has(threadId)||!['interrupted','error'].includes(status)||threadAgent(threadId)!=='codex'||this.startingTurns.has(threadId)||this.goals().get(threadId)?.status!=='active')return;
    const pending=this.pausingGoals.get(threadId);if(pending)return pending;
    const work=(async()=>{
      const result=readRecord(await this.codex.request('thread/read',{threadId,includeTurns:false}));
      const backend=readString(readRecord(readRecord(result?.thread)?.status)?.type);
      if(this.capacityRetries.has(threadId)||!['idle','notLoaded'].includes(backend||'')||this.startingTurns.has(threadId)||this.goals().get(threadId)?.status!=='active')return;
      await this.codex.request('thread/goal/set',{threadId,status:'paused'});
    })();
    this.pausingGoals.set(threadId,work);
    try{await work;}finally{if(this.pausingGoals.get(threadId)===work)this.pausingGoals.delete(threadId);}
  }
  async currentThreadStatus(threadId:string,events:GatewayEvent[],refreshBackend=true):Promise<string> {
    if(this.capacityRetries.has(threadId))return 'running';
    const savedStatus=()=>this.store.threads.find(thread=>thread.id===threadId)?.status||(this.ownsThread(threadId)?'running':'idle');
    if(this.agents.owns(threadId)||this.startingTurns.has(threadId))return 'running';
    if(threadId.startsWith('zcode-')){
      const native=(await zcodeNativeSessions.list()).find(session=>session.thread.id===threadId);if(native)return native.thread.status;
    }
    if(threadId.startsWith('deepseek-')){
      const native=await deepseekNativeSessions.read(threadId);if(native)return native.thread.status;
    }
    const trackedTurn=this.activeTurns.get(threadId);
    const lifecycle=latestMobileThreadLifecycle(events,this.store.recentEventsForThread(threadId));
    const historicalStatus=lifecycle?(lifecycle.type==='turn.started'?'running':lifecycle.status):savedStatus();
    const saved=this.store.threads.find(thread=>thread.id===threadId);
    // The event replay ring can evict a recovery event. The persisted thread
    // status still records that this older turn has already ended.
    const recordedTerminal=saved&&['interrupted','error','completed'].includes(saved.status)
      &&Date.parse(saved.updatedAt||'')>=Date.parse(lifecycle?.createdAt||'');
    const fallback=trackedTurn?savedStatus():recordedTerminal?saved.status:historicalStatus;
    if(!refreshBackend)return fallback;
    if(threadAgent(threadId)!=='codex'||historicalStatus!=='running'&&!trackedTurn
      &&!(['interrupted','error'].includes(fallback)&&this.goals().get(threadId)?.status==='active'))return fallback;
    let backendStatus:string|undefined;
    let timer:NodeJS.Timeout|undefined;
    try {
      let pending=this.statusReads.get(threadId);
      if(!pending){
        pending=this.codex.request('thread/read',{threadId,includeTurns:false}).finally(()=>{if(this.statusReads.get(threadId)===pending)this.statusReads.delete(threadId);});
        this.statusReads.set(threadId,pending);
      }
      // This check precedes steer and queue actions. A slow diagnostic RPC must
      // not consume their entire HTTP timeout; the actual action validates the
      // expected turn atomically. Keep the real request shared until it settles.
      const result=readRecord(await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('状态检查暂未返回')),1500);})]));
      backendStatus=readString(readRecord(readRecord(result?.thread)?.status)?.type);
    }catch{return this.currentThreadStatus(threadId,events,false);}
    finally{clearTimeout(timer);}
    // A live notification can arrive while the status read is pending.
    if(this.startingTurns.has(threadId)||this.activeTurns.get(threadId)!==trackedTurn)return savedStatus();
    const latest=latestMobileThreadLifecycle(events,this.store.recentEventsForThread(threadId));
    if(latest!==lifecycle)return latest?(latest.type==='turn.started'?'running':latest.status):savedStatus();
    if(backendStatus==='active')return 'running';
    if(backendStatus!=='idle'&&backendStatus!=='notLoaded'&&backendStatus!=='systemError')return fallback;
    this.activeTurns.delete(threadId);this.publicActiveTurns.delete(threadId);
    if(backendStatus==='notLoaded')this.activeThreads.delete(threadId);
    if(backendStatus==='systemError'){
      void this.store.upsertThread({id:threadId,status:'error'});
      if(trackedTurn||lifecycle?.type==='turn.started')this.hub.publish({type:'turn.completed',threadId,turnId:trackedTurn||lifecycle?.turnId,status:'error'});
      return 'error';
    }
    if(latest?.type==='turn.completed'&&(!trackedTurn||latest.turnId===trackedTurn))return latest.status;
    if(recordedTerminal)return saved.status;
    // Persist a terminal event as well as the sidebar status, so stale rollout
    // task_started records cannot reintroduce a dead turn after reconnect.
    void this.store.upsertThread({id:threadId,status:'interrupted'});
    this.hub.publish({type:'turn.completed',threadId,turnId:trackedTurn||lifecycle?.turnId,status:'interrupted'});
    return 'interrupted';
  }
  async currentTurnId(threadId:string):Promise<string|undefined> {
    const tracked=this.activeTurns.get(threadId);
    if(tracked)return tracked;
    // Only fetch turn metadata; operation bodies can span hundreds of MB.
    const result=readRecord(await this.codex.request('thread/turns/list',{threadId,limit:1,sortDirection:'desc',itemsView:'notLoaded'}));
    const turns=Array.isArray(result?.data)?result.data:[];
    const turn=turns.map(readRecord).find(item=>item?.status==='inProgress');
    return this.activeTurns.get(threadId)||(turn&&readString(turn.id));
  }
  canSteer(threadId:string):boolean { return this.activeTurns.has(threadId)||threadAgent(threadId)==='zcode'&&this.agents.owns(threadId); }
  canSteerPublic(threadId:string):boolean { return this.publicActiveTurns.has(threadId)&&this.activeTurns.has(threadId); }
  async interrupt(threadId:string,desktopTurnId?:string,requestId?:string):Promise<void> {
    this.explicitlyStopped.add(threadId);
    const waiting=this.capacityRetries.has(threadId);await this.cancelCapacityWork(threadId);
    this.explicitlyStopped.add(threadId);
    const turnId=this.activeTurns.get(threadId)||desktopTurnId;
    if(waiting&&!turnId){await this.store.upsertThread({id:threadId,status:'interrupted'});this.hub.publish({type:'turn.completed',threadId,requestId,status:'interrupted'});await this.pauseInterruptedGoal(threadId,'interrupted');return;}
    if(!turnId)throw new Error("当前会话没有正在运行的任务");
    // Pause the goal before interrupting its turn so the goal scheduler cannot
    // start another turn between completion and the status reconciliation.
    if(this.goals().get(threadId)?.status==='active')await this.codex.request('thread/goal/set',{threadId,status:'paused'});
    await this.codex.request("turn/interrupt", {threadId,turnId});
    // A queued turn can start while the interrupt reply is on its way back.
    const current=this.activeTurns.get(threadId);
    if(current&&current!==turnId)return;
    this.activeTurns.delete(threadId);
    this.publicActiveTurns.delete(threadId);
    await this.store.upsertThread({id:threadId,status:"interrupted"});
    this.hub.publish({type:"turn.completed",threadId,requestId,status:"interrupted"});
    await this.pauseInterruptedGoal(threadId,'interrupted');
  }
  async steer(threadId:string,text:string,images:ImageAttachment[]=[],files:FileAttachment[]=[],desktopTurnId?:string):Promise<void> {
    if(['antigravity','zcode'].includes(threadAgent(threadId)))return this.agents.steer(threadId,text,images,files);
    const expectedTurnId=this.activeTurns.get(threadId)||desktopTurnId;
    if(!expectedTurnId)throw new Error('当前没有可引导的运行轮次，消息已保留在队列中');
    const resolved=await resolveFiles(files);const prompt=codexFilePrompt(text,resolved);
    const input=[...(prompt.trim()?[{type:'text',text:prompt,text_elements:[]}]:[]),...await codexImageInputs(images)];
    await this.codex.request('turn/steer',{threadId,expectedTurnId,input});
    this.hub.publish({type:'user.message',threadId,text,images,files});
  }

  async handleClientCommand(command: ClientCommand,viaPublic=false,consumeQueued=false,identity:ClientCommand=structuredClone(command)): Promise<void> {
    if(command.type==='turn.start'&&command.replaceTurnId&&threadAgent(command.threadId)!=='codex')throw new Error('当前助手不支持覆盖已发送消息');
    if('threadId' in command)assertControllableThread(command.threadId||'');
    if((command.type==='thread.start'||command.type==='turn.start')&&(command.type==='thread.start'?modelAgent(command.model):threadAgent(command.threadId))!=='codex'){
      await this.receipts.run(identity as typeof command,()=>this.executeClientCommand(command,viaPublic),()=>{},consumeQueued);
      this.hub.publish({type:'command.accepted',threadId:(await this.receipts.get(command.requestId||''))?.threadId||('threadId' in command?command.threadId:''),requestId:command.requestId});
      return;
    }
    if((command.type==='thread.start'||command.type==='turn.start')&&modelAgent(command.model)==='codex'&&(!('threadId' in command)||threadAgent(command.threadId)==='codex')){
      const submitted={...command};
      if(submitted.type==='thread.start'&&!submitted.model)submitted.model='gpt-6-sol';
      if(submitted.model && !submitted.effort)submitted.effort=submitted.model.includes('astra')?'medium':submitted.model.includes('sol')?'high':undefined;
      if(submitted.model&&submitted.effort){
        const model=(await readModelCatalog(this.codex)).models.find(m=>m.model===submitted.model);
        if(!model||!model.supportedReasoningEfforts.some(e=>e.reasoningEffort===submitted.effort))throw new Error('当前模型不支持所选思考等级，请重新选择');
      }
      await this.receipts.run(identity as typeof submitted,async()=>{
        const existing=submitted.type==='thread.start'?(await this.receipts.get(submitted.requestId||''))?.threadId:undefined;
        if(existing&&submitted.type==='thread.start'){
          const {initialText,...fields}=submitted;
          await this.executeClientCommand({...fields,type:'turn.start',threadId:existing,text:initialText||''},viaPublic);
        }else await this.executeClientCommand(submitted,viaPublic);
      },()=>{},consumeQueued,{model:submitted.model,effort:submitted.effort});
      this.hub.publish({type:'command.accepted',threadId:(await this.receipts.get(submitted.requestId||''))?.threadId||('threadId' in submitted?submitted.threadId:''),requestId:submitted.requestId});
      return;
    }
    await this.executeClientCommand(command,viaPublic);
  }

  private async executeClientCommand(command: ClientCommand,viaPublic=false): Promise<void> {
    if(viaPublic&&command.type!=='turn.interrupt'&&command.type!=='approval.resolve'){
      const agent='threadId' in command&&command.threadId?threadAgent(command.threadId):command.type==='thread.start'?modelAgent(command.model):'codex';
      if(!publicAgentAllowed(agent))throw new Error('此助手的公网访问已关闭');
    }
    const goalObjective=(command.type==='thread.start'||command.type==='turn.start')&&!(command.type==='turn.start'&&command.replaceTurnId)&&modelAgent(command.model)==='codex'&&!command.images?.length&&!command.files?.length
      ?/^\/goal\s+([\s\S]+)$/i.exec((command.type==='thread.start'?command.initialText:command.text)?.trim()||'')?.[1].trim():undefined;
    if(goalObjective&&goalObjective.length>200000)throw new Error('目标内容不能超过 200000 字符');
    // Resolve only inside the submission receipt, so reconnect replay never
    // allocates a second directory for an already accepted new conversation.
    if(command.type==='thread.start'&&!command.projectPath&&this.defaultWorkspace){
      command={...command,projectPath:await this.defaultWorkspace(goalObjective||command.initialText)};
    }
    if(('threadId' in command&&threadAgent(command.threadId)!=='codex')||(command.type==='thread.start'&&modelAgent(command.model)!=='codex')){await this.agents.handle(command);return;}

    if (command.type === "debug.echo") {
      this.hub.publish({ type: "message.delta", threadId: command.threadId ?? "debug", text: command.text });
      return;
    }

    if (command.type === "thread.start") {
      const access=command.permission?await permissionOverrides(command.permission):undefined;
      const route=await consoleModelOverrides(this.codex,command.model);
      const result = (await this.codex.request("thread/start", {
        ...route,
        ...(command.fast!==undefined?{serviceTier:command.fast?'fast':'default'}:{}),
        cwd: command.projectPath || undefined,
        model: command.model || undefined,
        ...(access ? {approvalPolicy:access.approvalPolicy,approvalsReviewer:access.approvalsReviewer,sandbox:access.sandbox} : {}),
      })) as ThreadStartResult;
      const threadId = result.thread?.id ?? "unknown";

      await this.receipts.noteThread(command.requestId,threadId);
      this.activeThreads.add(threadId);
      this.relayThreads.set(threadId,Boolean(route.modelProvider));
      const thread = await this.store.upsertThread({
        id: threadId,
        source: "localCodex",
        projectPath: command.projectPath,
        title: goalObjective||command.initialText?.trim() ? titleFromPrompt(goalObjective||command.initialText!) : "新对话",
        status: "idle",
      });
      this.hub.publish({ type: "thread.started", threadId, thread, requestId: command.requestId });
      if(goalObjective){
        await this.startGoalCommand(threadId,goalObjective,command);
        if(viaPublic&&this.activeTurns.has(threadId))this.publicActiveTurns.add(threadId);
        return;
      }
      if (command.initialText?.trim() || command.images?.length || command.files?.length) {
        await this.startTurn(threadId, command.initialText || "", {model:command.model,projectPath:command.projectPath,images:command.images,files:command.files,effort:command.effort,mode:command.mode,fast:command.fast,requestId:command.requestId,permission:command.permission});
        if(viaPublic&&this.activeTurns.has(threadId))this.publicActiveTurns.add(threadId);
      }
      return;
    }

    if (command.type === "thread.resume") {
      await this.resumeThread(command.threadId, {
        projectPath: command.projectPath,
        model: command.model,
      });
      return;
    }

    if (command.type === "turn.start") {
      this.cancelCapacityRetry(command.threadId);
      await this.ensureThread(command.threadId, {
        projectPath: command.projectPath,
        model: command.model,
      });
      if(goalObjective)await this.startGoalCommand(command.threadId,goalObjective,command);
      else await this.startTurn(command.threadId, command.text, { replaceTurnId:command.replaceTurnId,keepAttachmentPaths:command.keepAttachmentPaths,continueGoal:command.continueGoal,images:command.images,files:command.files,effort:command.effort,mode:command.mode,fast:command.fast,requestId:command.requestId,permission:command.permission,
        projectPath: command.projectPath,
        model: command.model,
      });
      if(viaPublic&&this.activeTurns.has(command.threadId))this.publicActiveTurns.add(command.threadId);
      else this.publicActiveTurns.delete(command.threadId);
      return;
    }

    if (command.type === "turn.interrupt") {
      await this.interrupt(command.threadId,undefined,command.requestId);
      return;
    }

    if (command.type === "approval.resolve") {
      await this.resolveApproval(command.approvalId, command.decision);
    }
  }

  async forkThread(threadId:string,options:{ephemeral:boolean;lastTurnId?:string;beforeTurnId?:string}){
    assertControllableThread(threadId);
    if(threadAgent(threadId)!=='codex')throw Error('此助手暂不支持上下文分支');
    if(options.lastTurnId&&options.beforeTurnId)throw Error('只能选择一个分支位置');
    const source=this.store.threads.find(thread=>thread.id===threadId);
    const result=readRecord(await this.codex.request('thread/fork',{threadId,...options,excludeTurns:true,...(!options.ephemeral?{deferGoalContinuation:true}:{})}));
    const native=readRecord(result?.thread),id=readString(native?.id);
    if(!id)throw Error('Codex 未返回分支会话');
    if(options.ephemeral){
      if(native?.ephemeral!==true)throw Error('Codex 未创建临时分支');
      // Ephemeral forks have no durable goal; goal APIs reject these threads.
    }
    this.activeThreads.add(id);
    this.relayThreads.set(id,this.relayThreads.get(threadId)??Boolean(desktopThreadSettings(threadId)?.model?.includes('::')));
    const thread=await this.store.upsertThread({id,source:'localCodex',ephemeral:options.ephemeral,forkedFromId:threadId,
      projectPath:readString(native?.cwd)||source?.projectPath,title:options.ephemeral?'侧聊':`${source?.title||'会话'} · 分支`,status:'idle'});
    this.hub.publish({type:'thread.started',threadId:id,thread});
    return {thread,model:result?.model,effort:result?.reasoningEffort};
  }
  async closeSideThread(threadId:string){
    if(!this.store.isEphemeral(threadId))throw Error('此操作仅用于临时侧聊');
    await this.cancelCapacityWork(threadId);
    const active=this.activeTurns.get(threadId);
    if(active)await this.codex.request('turn/interrupt',{threadId,turnId:active});
    await this.codex.request('thread/unsubscribe',{threadId});
    this.activeThreads.delete(threadId);this.activeTurns.delete(threadId);this.relayThreads.delete(threadId);
    this.store.dropEphemeral(threadId);
  }

  requiresNewThreadForModel(threadId:string,model:string):boolean {
    const savedModel=desktopThreadSettings(threadId)?.model;
    const wasRelay=this.relayThreads.get(threadId)??(savedModel?savedModel.includes('::'):undefined);
    return wasRelay!==undefined&&wasRelay!==model.includes('::');
  }

  async resumeThread(threadId: string, options: { projectPath?: string; model?: string } = {}): Promise<void> {
    assertControllableThread(threadId);
    if(threadId.startsWith('zcode-')&&!this.agents.owns(threadId)){
      const native=(await zcodeNativeSessions.list()).find(session=>session.thread.id===threadId);
      if(native){this.hub.publish({type:'thread.started',threadId,thread:native.thread});return;}
    }
    if(threadAgent(threadId)!=='codex'){await this.agents.resume(threadId);return;}
    const savedModel=desktopThreadSettings(threadId)?.model;
    if(options.model&&this.requiresNewThreadForModel(threadId,options.model))throw new Error('请新建会话选择另一类模型；现有会话保留原来的官方或中转接口');
    if (this.activeThreads.has(threadId)) {
      const thread = this.store.threads.find((item) => item.id === threadId);
      this.hub.publish({ type: "thread.started", threadId, thread });
      return;
    }

    const route=await consoleModelOverrides(this.codex,options.model||savedModel);
    const resumed=readRecord(await this.codex.request("thread/resume", {
      ...route,
      threadId,
      cwd: options.projectPath || undefined,
      model: options.model || (route.modelProvider?savedModel:undefined),
      excludeTurns:true,
      initialTurnsPage:{limit:1,sortDirection:'desc',itemsView:'notLoaded'},
    }));
    const resumedThread=readRecord(resumed?.thread);
    const page=readRecord(resumed?.initialTurnsPage);
    const turns=Array.isArray(page?.data)?page.data:Array.isArray(resumedThread?.turns)?resumedThread.turns:[];
    const backendStatus=readString(readRecord(resumedThread?.status)?.type);
    const active=(!backendStatus||backendStatus==='active')?turns.map(readRecord).reverse().find(turn=>turn?.status==='inProgress'):undefined;
    const activeId=active&&readString(active.id);
    if(activeId)this.activeTurns.set(threadId,activeId);
    const isActive=activeId||readRecord(resumedThread?.status)?.type==='active';
    this.activeThreads.add(threadId);
    this.relayThreads.set(threadId,Boolean(route.modelProvider));
    const thread = await this.store.upsertThread({
      id: threadId,
      projectPath: options.projectPath,
      status: isActive?"running":"idle",
    });
    this.hub.publish({ type: "thread.started", threadId, thread });
  }

  private async ensureThread(threadId: string, options: { projectPath?: string; model?: string } = {}): Promise<void> {
    if (!this.activeThreads.has(threadId)) {
      await this.resumeThread(threadId, options);
    }
  }

  private async startGoalCommand(threadId:string,objective:string,options:Extract<ClientCommand,{type:'thread.start'|'turn.start'}>):Promise<void>{
    const existing=this.goals().get(threadId);
    if(existing?.objective===objective&&existing.status==='active')return;
    if(existing?.objective!==objective||existing.status!=='paused')
      await this.codex.request('thread/goal/set',{threadId,objective,status:'paused'});
    // The existing continuation path persists the chosen model, effort and
    // permissions before activating the goal scheduler.
    await this.startTurn(threadId,'',{...options,continueGoal:true});
  }

  private async startTurn(threadId: string, text: string, options: { replaceTurnId?:string; keepAttachmentPaths?:string[];continueGoal?:boolean;projectPath?: string; model?: string; effort?:string; mode?:"plan"|"default"; fast?:boolean; requestId?:string; permission?:"ask"|"auto"|"full"|"custom"; images?:ImageAttachment[]; files?:FileAttachment[] } = {}): Promise<void> {
    if(options.model&&this.relayThreads.has(threadId)&&this.relayThreads.get(threadId)!==options.model.includes('::'))throw new Error('请新建会话选择另一类模型；现有会话保留原来的官方或中转接口');
    const previous=this.store.threads.find((thread) => thread.id === threadId);
    if(options.continueGoal&&this.activeTurns.has(threadId)&&!this.startingTurns.has(threadId)){
      // A lost terminal notification can leave the gateway tracking a dead turn.
      // Reuse the status reconciliation before deciding whether continuation is safe.
      await this.currentThreadStatus(threadId,this.store.recentEventsForThread(threadId),true);
    }
    if (this.activeTurns.has(threadId)&&!options.continueGoal||this.startingTurns.has(threadId)) throw new Error("当前任务仍在运行，请等待完成或先停止。");
    this.startingTurns.add(threadId);
    this.completedDuringStart.set(threadId,new Set());
    let submitted=false;
    let replacementApplied=false;
    try {
    if(options.continueGoal){
      await this.pausingGoals.get(threadId);
      const goal=this.goals().get(threadId);
      if(goal?.status==='budget_limited')throw new Error('目标预算已用完，请在桌面调整预算后再继续');
      if(!goal||!['active','paused','blocked','usage_limited'].includes(goal.status))throw new Error('当前目标不能继续，请刷新目标状态');
      // Goal activation is also valid during a running turn. It resumes the
      // scheduler after that turn; no turn/start or user message is submitted.
      const result=readRecord(await this.codex.request('thread/read',{threadId,includeTurns:false}));
      if(goal.status==='active'&&readString(readRecord(readRecord(result?.thread)?.status)?.type)==='active')return;
    }
    const inputImages=await codexImageInputs(options.images);
    const resolvedFiles=await resolveFiles(options.files);
    const userText = text.trim();
    if(!options.continueGoal&&!userText && !inputImages.length&&!resolvedFiles.length&&!(options.replaceTurnId&&options.keepAttachmentPaths?.length)) throw new Error("请输入消息或添加附件");
      await this.store.upsertThread({
        id: threadId,
        title: !options.continueGoal&&shouldRetitleThread(previous?.title, userText) ? titleFromPrompt(userText) : undefined,
        status: "running",
      });
    let effort:string|undefined;
    if(options.model) {
      const model=(await readModelCatalog(this.codex)).models.find(m=>m.model===options.model);
      const saved=options.effort || (await readUserSettings()).reasoningEffort;
      if(options.effort && !model?.supportedReasoningEfforts.some(e=>e.reasoningEffort===options.effort)) throw new Error("当前模型不支持所选思考等级，请重新选择");
      effort=model?.supportedReasoningEfforts.some(e=>e.reasoningEffort===saved)?saved:model?.defaultReasoningEffort;
    }
    const access=options.permission?await permissionOverrides(options.permission):undefined;
    const params = {
      threadId,
      input: [...(text||resolvedFiles.length||options.keepAttachmentPaths?.length?[{ type: "text", text:codexFilePrompt(text,resolvedFiles), text_elements: [] }]:[]),...inputImages],
      cwd: options.projectPath || undefined,
      model: options.model || undefined,
      effort,
      ...(options.mode ? {collaborationMode:{mode:options.mode,settings:{model:options.model || (await readUserSettings()).model,reasoning_effort:effort??null,developer_instructions:null}}} : {}),
      ...(options.fast!==undefined ? {serviceTier:options.fast?"fast":"default"} : {}),
      ...(access ? {approvalPolicy:access.approvalPolicy,approvalsReviewer:access.approvalsReviewer,sandboxPolicy:access.sandboxPolicy} : {}),
    };
    if(options.replaceTurnId){
      if(!options.requestId)throw new Error('编辑消息缺少请求编号，请更新手机端');
      const saved=(await this.receipts.get(options.requestId))?.replacement;
      const latest=readRecord(await this.codex.request('thread/turns/list',{threadId,limit:2,sortDirection:'desc',itemsView:'full'}));
      const turn=readRecord(Array.isArray(latest?.data)?latest.data[0]:undefined);
      const expected=saved?.headTurnId??options.replaceTurnId;
      if((readString(turn?.id)||'')!==expected||turn?.status==='inProgress')throw new Error('这条消息已不是最后一条，请刷新会话后再编辑');
      let filePrefix=saved?.filePrefix||'';
      if(saved){replacementApplied=true;if(saved.imageInputs)params.input.push(...saved.imageInputs as typeof params.input);}
      else {
        const users=Array.isArray(turn?.items)?turn.items.map(readRecord).filter(item=>item?.type==='userMessage'):[];
        if(users.length!==1)throw new Error('这一轮包含多条消息，无法只覆盖最后一条');
        // Preserve desktop image inputs when they have no gateway upload ID.
        const retained=options.keepAttachmentPaths===undefined?null:new Set(options.keepAttachmentPaths.map(value=>value.replaceAll('\\','/').toLowerCase()));
        const imageInputs=Array.isArray(users[0]?.content)?users[0].content.filter((item:any)=>['image','localImage'].includes(item?.type)&&(retained?retained.has(String(item.path||item.url||'').replaceAll('\\','/').toLowerCase()):!inputImages.length)):[];
        params.input.push(...imageInputs);
        const originalText=stripSessionInstructionPrefix(Array.isArray(users[0]?.content)?users[0].content.map((item:any)=>item?.text||'').join('\n'):'');
        filePrefix=!resolvedFiles.length?/^# Files mentioned by the user:[\s\S]*?## My request:\s*/.exec(originalText)?.[0]||'':'';
        if(retained){
          const originalFiles=(splitDesktopAttachments(originalText).attachments||[]).filter(file=>retained.has(file.path.replaceAll('\\','/').toLowerCase()));
          filePrefix=codexFilePrompt('',[...originalFiles.map(file=>({id:'',name:file.name,absolutePath:file.path,mime:'application/octet-stream',size:0})),...resolvedFiles]);
        }
        submitted=true;
        await this.codex.request('thread/revert',{threadId,beforeTurnId:options.replaceTurnId});
        const headTurnId=readString(readRecord(Array.isArray(latest?.data)?latest.data[1]:undefined)?.id)||'';
        await this.receipts.noteReplacement(options.requestId,{removedTurnId:options.replaceTurnId,headTurnId,imageInputs,filePrefix});
        replacementApplied=true;
        await invalidateCodexHistory(threadId);
        await this.store.removeTurnEvents(threadId,options.replaceTurnId);
        this.hub.publish({type:'thread.history.changed',threadId,turnId:options.replaceTurnId});
      }
      if(filePrefix){const input=params.input.find(item=>item.type==='text');if(input&&'text' in input)input.text=filePrefix+text;}
    }
    if(options.continueGoal){
      // Persist settings before activating the scheduler. A turn-only override
      // races the first automatic continuation and is lost on later goal turns.
      const {input,...settings}=params;
      await this.codex.request('thread/settings/update',settings);
      submitted=true;
      await this.codex.request('thread/goal/set',{threadId,status:'active'});
      return;
    }
    let response:unknown;
    submitted=true;
    try {response=await this.codex.request('turn/start',params);}
    catch(error){
      // This explicit rejection means no turn was accepted. A lost connection
      // or timeout is ambiguous and must not replay the user's message.
      if(!/thread not found/i.test(error instanceof Error?error.message:String(error)))throw error;
      this.activeThreads.delete(threadId);
      await this.resumeThread(threadId,{projectPath:options.projectPath,model:options.model});
      if(this.activeTurns.has(threadId))throw new Error('当前任务仍在运行，请等待完成或先停止。');
      response=await this.codex.request('turn/start',params);
    }
    const result=readRecord(response);
    const turnId = readNestedString(result ?? {}, ["turn", "id"]);
    // Notifications can finish a quick turn before its RPC response arrives.
    // Do not restore a completed turn and block the follow-up queue forever.
    if (turnId&&!this.completedDuringStart.get(threadId)?.has(turnId)&&!this.activeTurns.has(threadId)) this.activeTurns.set(threadId, turnId);
    this.hub.publish({ type: "user.message", threadId, turnId, requestId:options.requestId, text: userText, status:this.store.threads.find(thread=>thread.id===threadId)?.status, images:options.images, files:options.files });
    } catch (error) {
      if(options.replaceTurnId&&(!submitted||replacementApplied&&!/timeout|timed out|EPIPE|ECONNRESET|ETIMEDOUT|closed|disconnect|超时|断开|退出|已关闭/i.test(String(error)))){
        await this.store.upsertThread({id:threadId,status:previous?.status??'idle',title:previous?.title});
        throw new SubmissionNotStartedError(error);
      }
      if(options.continueGoal){
        if(!submitted||!/timeout|timed out|EPIPE|ECONNRESET|ETIMEDOUT|closed|disconnect|超时|断开|退出|已关闭/i.test(String(error)))
          await this.store.upsertThread({id:threadId,status:previous?.status??'idle',title:previous?.title});
        if(!submitted)throw new SubmissionNotStartedError(error);
        throw error;
      }
      if(isWriterOccupied(error)){
        await this.store.upsertThread({id:threadId,status:previous?.status??'idle',title:previous?.title});
        throw error;
      }
      await this.store.upsertThread({ id: threadId, status: "error" });
      this.hub.publish({ type: "turn.completed", threadId, status: "error" });
      throw error;
    } finally {
      this.startingTurns.delete(threadId);this.completedDuringStart.delete(threadId);
      if(submitted)await this.pauseInterruptedGoal(threadId,this.store.threads.find(thread=>thread.id===threadId)?.status||'idle')
        .catch(error=>this.hub.publish({type:'warning',threadId,title:'目标暂停状态未能同步',detail:String(error)}));
    }
  }

  async reconcileApprovalMirrors():Promise<void>{
    if(this.reconcilingApprovalMirrors)return this.reconcilingApprovalMirrors;
    const work=(async()=>{
      for(const pending of this.store.approvals.filter(row=>row.status==='pending'&&row.approvalType!=='question')){
        const handled=this.store.approvals.find(row=>(row.status==='accepted'||row.status==='declined')&&mirroredApproval(pending,row));
        if(!handled)continue;
        const decision=handled.status==='accepted'?'accept':'decline';
        // This updates only the duplicate record. The operation already has a
        // recorded response; never submit a second approval to Codex.
        await this.store.resolveApproval(pending.id,decision);
        this.approvalPermissions.delete(pending.id);
        this.hub.publish({type:'approval.resolved',threadId:pending.threadId,approvalId:pending.id,decision});
      }
    })();
    this.reconcilingApprovalMirrors=work;
    try{await work;}finally{if(this.reconcilingApprovalMirrors===work)this.reconcilingApprovalMirrors=undefined;}
  }

  async resolveApproval(approvalId: string, decision: "accept" | "decline"): Promise<void> {
    if(approvalId.startsWith('agent-')){await this.agents.resolveApproval(approvalId,decision);return;}
    await this.reconcileApprovalMirrors();
    if(this.resolvingApprovals.has(approvalId))throw new Error('审批正在处理，请稍后刷新');
    const approval = this.store.approvals.find(item => item.id === approvalId);
    if(approval?.status===(decision==='accept'?'accepted':'declined'))return;
    if (!approval || approval.status !== "pending") throw new Error("审批已处理或失效，请刷新状态");
    if(approval.approvalType === "question"&&!(approval.method===mcpElicitationMethod&&decision==='decline')) throw new Error("请填写问题的回答");
    this.resolvingApprovals.add(approvalId);
    try{
      const permissions = this.approvalPermissions.get(approvalId) ?? {};
      const result = approval.method===mcpElicitationMethod?elicitationDecision(approval.detail,decision):approval.method === "item/permissions/requestApproval"
        ? { permissions: decision === "accept" ? permissions : {}, scope: "turn" }
        : { decision };
      await this.codex.respond(approval.rpcId, result);
      await this.store.resolveApproval(approvalId, decision);
      this.approvalPermissions.delete(approvalId);
      this.hub.publish({ type: "approval.resolved", threadId: approval.threadId, approvalId, decision });
      await this.reconcileApprovalMirrors();
    }finally{this.resolvingApprovals.delete(approvalId);}
  }

  async approvePendingAutomatically():Promise<{accepted:number;failed:number}>{
    let accepted=0,failed=0;
    for(const approval of this.store.approvals.filter(item=>item.status==='pending'&&item.approvalType!=='question'&&
      (item.method!==mcpElicitationMethod||confirmationElicitation(elicitationParams(item.detail))))){
      try{await this.resolveApproval(approval.id,'accept');accepted++;}
      catch{failed++;}
    }
    return {accepted,failed};
  }

  async answerQuestions(id:string, answers:Record<string,{answers:string[]}>):Promise<void> {
    if(id.startsWith('agent-question-')){await this.agents.answerQuestions(id,answers);return;}
    const request=this.store.approvals.find(a=>a.id===id&&a.approvalType==='question');
    if(!request||request.status!=='pending')throw new Error('问题已回答或失效');
    const questions=JSON.parse(request.detail||'{}').questions||[];
    const result:Record<string,{answers:string[]}>={};
    for(const question of questions){
      const values=answers[question.id]?.answers;
      if(!Array.isArray(values)||values.length!==1||!values[0].trim())throw new Error('请回答所有问题');
      result[question.id]={answers:[values[0]]};
    }
    await this.codex.respond(request.rpcId,request.method===mcpElicitationMethod
      ?{action:'accept',content:elicitationAnswer(request.detail,answers)}:{answers:result});
    await this.store.resolveApproval(id,'accept');
    const questionReplies=questions.map((question:{id:string;question:string})=>({question:question.question,answer:result[question.id].answers[0]}));
    this.hub.publish({type:'user.message',threadId:request.threadId,text:questionReplies.map((reply:{answer:string})=>reply.answer).join('\n'),questionReplyId:id,questionReplies,status:this.store.threads.find(thread=>thread.id===request.threadId)?.status});
    this.hub.publish({type:'approval.resolved',threadId:request.threadId,approvalId:id,decision:'accept'});
  }

  compatibilityStats(): {
    handledNotifications: string[];
    handledServerRequests: string[];
    clientRequests: string[];
    unknownNotifications: MethodObservation[];
    unsupportedServerRequests: MethodObservation[];
    totalUnknownNotifications: number;
    totalUnsupportedServerRequests: number;
  } {
    const unknownNotifications = observations(this.unknownNotifications);
    const unsupportedServerRequests = observations(this.unsupportedServerRequests);
    return {
      handledNotifications: [...APP_SERVER_NOTIFICATION_METHODS],
      handledServerRequests: [...APP_SERVER_REQUEST_METHODS],
      clientRequests: [...APP_SERVER_CLIENT_REQUEST_METHODS],
      unknownNotifications,
      unsupportedServerRequests,
      totalUnknownNotifications: unknownNotifications.reduce((total, item) => total + item.count, 0),
      totalUnsupportedServerRequests: unsupportedServerRequests.reduce((total, item) => total + item.count, 0),
    };
  }

  private async handleServerRequest(message: unknown): Promise<void> {
    this.commandOutput.flush();
    const request = readRecord(message);
    if (!request) {
      return;
    }
    const method = readString(request.method) ?? "";
    const rpcId = request.id;
    if (rpcId === undefined || (typeof rpcId !== "string" && typeof rpcId !== "number")) {
      return;
    }
    const params = readRecord(request.params) ?? {};
    if(method===mcpElicitationMethod){
      const prompt=elicitationPrompt(params),id=`${prompt.question?'question-':''}mcp-${String(rpcId)}`;
      console.info('MCP elicitation received',JSON.stringify({mode:['form','openai/form','openaiForm','url','openai/userVerification'].includes(String(params.mode))?params.mode:'unknown',confirmation:confirmationElicitation(params)}));
      if(this.store.approvals.some(row=>row.id===id&&row.status!=='expired'))return;
      const approval=await this.store.addApproval({id,rpcId,method,threadId:readString(params.threadId)||'unknown',turnId:readString(params.turnId),
        approvalType:prompt.question?'question':'permission',title:prompt.title,detail:prompt.detail});
      if(!prompt.question&&confirmationElicitation(params)&&await readRemoteAutoApproval()){
        try{await this.resolveApproval(id,'accept');}catch{}
        return;
      }
      this.hub.publish({type:'approval.requested',threadId:approval.threadId,turnId:approval.turnId,approvalId:id,
        approvalType:approval.approvalType,title:approval.title,detail:approval.detail});
      return;
    }
    if(method === "item/tool/requestUserInput") {
      const questions = Array.isArray(params.questions) ? params.questions : [];
      const approval = await this.store.addApproval({id:`question-${String(rpcId)}`,rpcId,method,threadId:readString(params.threadId)||"unknown",turnId:readString(params.turnId),approvalType:"question",title:"需要你的回答",detail:JSON.stringify({questions,isBlocking:params.isBlocking!==false})});
      this.hub.publish({type:"approval.requested",threadId:approval.threadId,approvalId:approval.id,approvalType:"question",title:approval.title,detail:approval.detail});
      return;
    }
    if (!isApprovalMethod(method)) {
      observe(this.unsupportedServerRequests, method || "(missing method)");
      this.codex.respondError(rpcId, -32601, `Unsupported server request: ${method}`);
      return;
    }

    const approvalType = approvalTypeFor(method);
    const threadId = readString(params.threadId) ?? readString(params.conversationId) ?? "unknown";
    const candidate:Omit<PendingApproval,'status'|'createdAt'>={
      id: `${String(rpcId)}-${readString(params.itemId) ?? readString(params.callId) ?? "approval"}`,
      rpcId,
      method,
      threadId,
      turnId: readString(params.turnId),
      itemId: readString(params.itemId) ?? readString(params.callId),
      approvalId: readString(params.approvalId),
      approvalType,
      title: approvalTitle(method, params),
      detail: approvalDetail(params),
    };
    const existing=this.store.approvals.find(row=>row.status!=='expired'&&(row.id===candidate.id||mirroredApproval(row,candidate)));
    if(existing){await this.reconcileApprovalMirrors();return;}
    const approval = await this.store.addApproval(candidate);

    this.approvalPermissions.set(approval.id, readRecord(params.permissions) ?? {});
    if(await readRemoteAutoApproval()){
      try{
        await this.resolveApproval(approval.id,'accept');
        return;
      }catch{
        // Keep failed automatic approvals in the normal pending list, without
        // posting the manual-approval event that generates a phone notification.
        return;
      }
    }
    this.hub.publish({
      type: "approval.requested",
      threadId,
      turnId: approval.turnId,
      itemId: approval.itemId,
      approvalId: approval.id,
      approvalType,
      title: approval.title,
      detail: approval.detail,
    });
  }

  private finishCompaction(threadId:string,status:'ok'|'error'|'cancelled',itemId?:string):void {
    const current=this.compactionOutputs.get(threadId);
    const matches=current&&(!itemId||!current.itemId||itemId===current.itemId);
    if(matches)this.compactionOutputs.delete(threadId);
    this.hub.publish({type:'context.compaction',threadId,itemId:itemId??current?.itemId,title:'压缩上下文',status,text:matches?current.parts.join('')||undefined:undefined});
  }

  private handleCodexNotification(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }
    const event = message as { method?: string; params?: Record<string, unknown> };
    if(event.method!=='item/commandExecution/outputDelta')this.commandOutput.flush();
    const params = event.params ?? {};
    const threadId = readNestedString(params, ["thread", "id"]) ?? readString(params.threadId) ?? "unknown";
    if((event.method==='turn/started'||event.method==='turn/completed')&&this.compactionOutputs.has(threadId))this.finishCompaction(threadId,'cancelled');

    if(event.method==='thread/settings/updated'){
      const settings=readRecord(params.threadSettings);
      if(threadId!=='unknown'&&settings&&Object.hasOwn(settings,'serviceTier')&&(settings.serviceTier===null||typeof settings.serviceTier==='string')){
        this.hub.publish({type:'thread.settings.updated',threadId,serviceTier:settings.serviceTier},false);
      }
      return;
    }

    if(event.method === 'serverRequest/resolved') {
      for(const approval of this.store.approvals.filter(a=>a.status==='pending'&&a.rpcId===params.requestId&&a.threadId===threadId)) {
        if(this.resolvingApprovals.has(approval.id))continue;
        void this.store.expireApproval(approval.id);
        this.hub.publish({type:'approval.resolved',threadId,approvalId:approval.id,decision:'resolved'});
      }
      return;
    }
    if (event.method === "thread/started") {
      const thread = readRecord(params.thread);
      const incomingThreadRecord = this.threadRecordFromCodexThread(thread, "idle");
      const existingThread = incomingThreadRecord ? this.store.threads.find((item) => item.id === incomingThreadRecord.id) : undefined;
      const threadRecord = incomingThreadRecord ? {
        ...incomingThreadRecord,
        title: existingThread?.title || incomingThreadRecord.title,
      } : null;
      if (threadRecord) {
        const metadata={...threadRecord,...(thread?.ephemeral===true?{ephemeral:true,forkedFromId:readString(thread.forkedFromId)}:{})};
        void this.store.upsertThread(metadata);
        this.hub.publish({ type: "thread.started", threadId: threadRecord.id, thread: { ...metadata, createdAt: nowIso(), updatedAt: nowIso() } });
      }
      return;
    }

    if (event.method === "thread/status/changed") {
      const backendStatus=readString(params.status)??readNestedString(params,['status','type']);
      if(this.capacityRetries.has(threadId)&&backendStatus!=='active')return;
      let status = mapCodexThreadStatus(backendStatus);
      if(backendStatus==='notLoaded'){
        this.activeThreads.delete(threadId);
        const turnId=this.activeTurns.get(threadId);
        this.activeTurns.delete(threadId);this.publicActiveTurns.delete(threadId);
        if(turnId){status='interrupted';this.hub.publish({type:'turn.completed',threadId,turnId,status});}
      }
      void this.store.upsertThread({ id: threadId, status });
      this.hub.publish({ type: "thread.started", threadId, thread: { id: threadId, title: "", status, createdAt: nowIso(), updatedAt: nowIso() } });
      void this.pauseInterruptedGoal(threadId,status).catch(error=>this.hub.publish({type:'warning',threadId,title:'目标暂停状态未能同步',detail:String(error)}));
      return;
    }

    if (event.method === "thread/name/updated") {
      const title = readString(params.threadName);
      if (title && threadId !== "unknown") {
        const status = this.store.threads.find((thread) => thread.id === threadId)?.status ?? "idle";
        void this.store.upsertThread({ id: threadId, title });
        this.hub.publish({ type: "thread.started", threadId, thread: { id: threadId, title, status, createdAt: nowIso(), updatedAt: nowIso() } });
      }
      return;
    }

    if(event.method==='thread/tokenUsage/updated')return; // UsageReader consumes this snapshot.
    if (event.method === "turn/started") {
      this.explicitlyStopped.delete(threadId);
      const turnId = readNestedString(params, ["turn", "id"]) ?? readString(params.turnId);
      const retry=this.capacityRetries.get(threadId);
      if(retry){
        if(retry.launching||retry.awaitingStart){retry.awaitingStart=false;retry.startedTurnId=turnId;}
        else if(retry.startedTurnId!==turnId)this.cancelCapacityRetry(threadId);
      }
      this.capacityErrors.delete(threadId);
      const goal=this.goals().get(threadId);
      if(goal?.status==='active')this.turnGoals.set(threadId,{...goal});else this.turnGoals.delete(threadId);
      if (turnId) this.activeTurns.set(threadId, turnId);
      if (threadId !== "unknown") {
        this.hub.publish({type:'turn.started',threadId,turnId,
          ...(turnId?{eventId:`turn-started:${threadId}:${turnId}`}:{})});
        void this.store.upsertThread({ id: threadId, status: "running" });
        this.hub.publish({ type: "thread.started", threadId, thread: { id: threadId, title: "", status: "running", createdAt: nowIso(), updatedAt: nowIso() } });
      }
      return;
    }

    if (event.method === "item/agentMessage/delta") {
      const text = readString(params.delta) ?? readString(params.text) ?? "";
      if (text) {
        const compact=this.compactionOutputs.get(threadId);
        if(compact){compact.parts.push(text);return;}
        this.hub.publish({ type: "message.delta", threadId, text, itemId: readString(params.itemId), turnId: readString(params.turnId) });
      }
      return;
    }

    if (event.method === "item/reasoning/summaryTextDelta") {
      const text=readString(params.delta);
      if(text)this.hub.publish({type:'reasoning.summary',threadId,turnId:readString(params.turnId),itemId:readString(params.itemId),text});
      return;
    }
    if (event.method === 'turn/plan/updated') {
      const plan=readArray(params.plan).map((entry:any)=>`${entry.status==='completed'?'✓':entry.status==='inProgress'?'进行中':'待开始'} ${entry.step}`).join('\n');
      this.hub.publish({type:'plan.updated',threadId,turnId:readString(params.turnId),title:'任务计划',text:[readString(params.explanation),plan].filter(Boolean).join('\n')});
      return;
    }
    if (event.method === "item/plan/delta") {
      const text = readString(params.delta) ?? "";
      if (text) {
        this.hub.publish({ type: "tool.output", threadId, itemId: readString(params.itemId), text });
      }
      return;
    }

    if (event.method === "turn/completed") {
      const recorded=this.capacityErrors.get(threadId);
      const turnId=readNestedString(params,["turn","id"])??readString(params.turnId)??recorded?.turnId??this.activeTurns.get(threadId);
      if(turnId)this.completedDuringStart.get(threadId)?.add(turnId);
      const activeTurnId=this.activeTurns.get(threadId);
      if(turnId&&activeTurnId&&turnId!==activeTurnId)return;
      this.activeTurns.delete(threadId);
      this.publicActiveTurns.delete(threadId);
      const status = readString(params.status) ?? readNestedString(params, ["turn", "status"]) ?? "completed";
      const mappedStatus = mapCodexThreadStatus(status);
      const terminalError=readRecord(readRecord(params.turn)?.error)??readRecord(params.error);
      const error=terminalError??(recorded&&(!recorded.turnId||recorded.turnId===turnId)?recorded.error:undefined);
      // Codex can abort a turn with both status=interrupted and a TurnError.
      // A plain user interruption must not revive an earlier transient error.
      if((mappedStatus==='error'||mappedStatus==='interrupted'&&isCapacityError(terminalError))&&this.queueCapacityRetry(threadId,turnId,error))return;
      this.cancelCapacityRetry(threadId);
      void this.store.upsertThread({ id: threadId, status: mappedStatus });
      this.hub.publish({ type: "turn.completed", threadId, turnId, status: mappedStatus });
      void this.pauseInterruptedGoal(threadId,mappedStatus).catch(error=>this.hub.publish({type:'warning',threadId,title:'目标暂停状态未能同步',detail:String(error)}));
      if (error) {
        this.hub.publish({type:'error',threadId,turnId,...codexErrorPresentation(error)});
      }
      return;
    }

    if (event.method === "turn/diff/updated") {
      this.hub.publish({
        type: "diff.updated",
        threadId,
        turnId: readString(params.turnId),
        diff: readString(params.diff) ?? "",
      });
      return;
    }

    if (event.method === "item/commandExecution/outputDelta") {
      const text = readString(params.delta) ?? "";
      this.commandOutput.append(threadId,readString(params.itemId),text);
      return;
    }

    if (event.method === "item/fileChange/outputDelta") {
      const text = readString(params.delta) ?? "";
      if (text) {
        this.hub.publish({ type: "tool.output", threadId, itemId: readString(params.itemId), text });
      }
      return;
    }

    if (event.method === "item/fileChange/patchUpdated") {
      const changes = readArray(params.changes);
      this.hub.publish({
        type: "file.changed",
        threadId,
        turnId: readString(params.turnId),
        itemId: readString(params.itemId),
        files: changes.map((change) => readString((change as Record<string, unknown>).path) ?? readString((change as Record<string, unknown>).file) ?? "unknown"),
        summary: `${changes.length} 个文件变更`,
        diff: changes.map((change) => readString((change as Record<string, unknown>).diff) ?? "").filter(Boolean).join("\n"),
      });
      return;
    }

    if (event.method === "warning" || event.method === "guardianWarning" || event.method === "configWarning") {
      this.hub.publish({
        type: "warning",
        threadId: threadId === "unknown" ? undefined : threadId,
        title: readString(params.title) ?? event.method,
        detail: readString(params.message) ?? readString(params.detail) ?? JSON.stringify(params),
      });
      return;
    }

    if (event.method === "error") {
      const capacity=isCapacityError(params.error??params.message);
      const turnId=readString(params.turnId)??this.activeTurns.get(threadId),active=this.activeTurns.get(threadId);
      const relevant=!active||!turnId||active===turnId;
      if(capacity&&threadId!=='unknown'&&relevant){
        this.capacityErrors.set(threadId,{turnId,error:params.error??params.message});
        if(params.willRetry!==true&&this.queueCapacityRetry(threadId,turnId,params.error??params.message)){
          if(this.activeTurns.get(threadId)===turnId){this.activeTurns.delete(threadId);this.publicActiveTurns.delete(threadId);}
          return;
        }
      }
      const willRetry=params.willRetry===true;
      const presentation=codexErrorPresentation(params.error??{message:readString(params.message)??JSON.stringify(params)},willRetry);
      if (threadId !== "unknown"&&!willRetry) {
        void this.store.upsertThread({ id: threadId, status: "error" });
      }
      this.hub.publish({type:'error',threadId:threadId==='unknown'?undefined:threadId,turnId,...presentation});
      return;
    }

    if (event.method === "remoteControl/status/changed") {
      return;
    }

    if(event.method==='item/autoApprovalReview/started'||event.method==='item/autoApprovalReview/completed'||event.method==='autoApprovalReview/strictReviewRequired'){
      // These report the upstream reviewer's lifecycle, not a request for the
      // user to answer. Real actionable approvals arrive as server requests.
      const review=readRecord(params.review),status=readString(review?.status);
      if(event.method==='item/autoApprovalReview/completed'&&status&&status!=='approved'){
        this.hub.publish({type:'tool.completed',threadId,itemId:`approval-review:${readString(params.reviewId)??readString(params.targetItemId)??'unknown'}`,
          status:status==='denied'?'error':'cancelled',detail:readString(review?.rationale)??(status==='denied'?'自动审批未通过':status==='timedOut'?'自动审批超时':'自动审批已中止')});
      }
      return;
    }

    if (event.method === "item/started") {
      const item = readRecord(params.item);
      const question=desktopAsyncQuestionEvent(threadId,item);
      if(question){this.hub.publish(question);return;}
      const itemType = readString(item?.type) ?? "tool";
      if (itemType === "contextCompaction") {
        const itemId=readString(item?.id),current=this.compactionOutputs.get(threadId);
        if(current?.itemId===itemId&&current)return;
        if(current)this.finishCompaction(threadId,'cancelled');
        this.compactionOutputs.set(threadId,{itemId,parts:[]});
        this.hub.publish({type:"context.compaction",threadId,itemId:readString(item?.id),title:"压缩上下文",status:"running"});
        return;
      }
      if (["userMessage", "agentMessage", "reasoning"].includes(itemType)) return;
      this.hub.publish({
        type: "tool.started",
        threadId,
        itemId: readString(item?.id),
        title: toolTitle(item),
        detail: itemType === "imageView" ? historyToolPresentation("imageView",JSON.stringify(item)).detail : itemType,
      });
      return;
    }

    if (event.method === "item/completed") {
      const item = readRecord(params.item);
      const question=desktopAsyncQuestionEvent(threadId,item);
      // Some bridges expose arguments only on completion; tool completion is
      // acceptance of an asynchronous prompt, not the user's answer.
      if(question){this.hub.publish(question);return;}
      const itemType = readString(item?.type);
      if (itemType === "contextCompaction") {
        this.finishCompaction(threadId,itemStatus(item),readString(item?.id));
        return;
      }
      if (itemType && ["userMessage", "agentMessage", "reasoning"].includes(itemType)) return;
      if (itemType === "commandExecution") {
        const output = readString(item?.aggregatedOutput);
        if (output) {
          this.hub.publish({ type: "terminal.output", threadId, stream: "stdout", text: output });
        }
      }
      if (itemType === "fileChange") {
        const changes = readArray(item?.changes);
        this.hub.publish({
          type: "file.changed",
          threadId,
          itemId: readString(item?.id),
          files: changes.map((change) => readString((change as Record<string, unknown>).path) ?? "unknown"),
          summary: readString(item?.status) ?? `${changes.length} 个文件变更`,
          diff: changes.map((change) => readString((change as Record<string, unknown>).diff) ?? "").filter(Boolean).join("\n"),
        });
      }
      this.hub.publish({
        type: "tool.completed",
        threadId,
        itemId: readString(item?.id),
        status: itemStatus(item),
        detail: itemType === "imageView" ? historyToolPresentation("imageView",JSON.stringify(item)).detail : toolTitle(item),
      });
      return;
    }

    observe(this.unknownNotifications, event.method || "(missing method)");
  }

  private threadRecordFromCodexThread(thread: Record<string, unknown> | undefined, fallbackStatus: "idle" | "running" | "completed" | "error" | "interrupted"): { id: string; projectPath?: string; title: string; status: "idle" | "running" | "completed" | "error" | "interrupted" } | null {
    const id = readString(thread?.id);
    if (!id) {
      return null;
    }
    return {
      id,
      projectPath: readString(thread?.cwd),
      title: readString(thread?.name) ?? readString(thread?.preview) ?? "Codex 会话",
      status: mapCodexThreadStatus(readString(thread?.status) ?? readString(readRecord(thread?.status)?.type), fallbackStatus),
    };
  }
}

function isApprovalMethod(method: string): boolean {
  return (APP_SERVER_REQUEST_METHODS as readonly string[]).includes(method);
}

function approvalTypeFor(method: string): "command" | "file" | "permission" {
  if (method.includes("file") || method.includes("Patch")) {
    return "file";
  }
  if (method.includes("permissions")) {
    return "permission";
  }
  return "command";
}

function approvalTitle(method: string, params: Record<string, unknown>): string {
  const command = readString(params.command);
  if (command) {
    return command;
  }
  const commandArray = readArray(params.command);
  if (commandArray.length > 0) {
    return commandArray.map(String).join(" ");
  }
  if (method.includes("file") || method.includes("Patch")) {
    return "允许文件变更";
  }
  if (method.includes("permissions")) {
    return "允许权限变更";
  }
  return readString(params.reason) ?? "需要审批";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapCodexThreadStatus(status: string | undefined, fallback: "idle" | "running" | "completed" | "error" | "interrupted" = "idle"): "idle" | "running" | "completed" | "error" | "interrupted" {
  const normalized = status?.toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "inprogress" || normalized === "running" || normalized === "active") {
    return "running";
  }
  if (normalized === "failed" || normalized === "error" || normalized === "systemerror") {
    return "error";
  }
  if (normalized === "interrupted" || normalized === "cancelled" || normalized === "canceled") {
    return "interrupted";
  }
  if (normalized === "completed") {
    return "completed";
  }
  if (normalized === "idle") {
    return "idle";
  }
  return fallback;
}

function readNestedString(value: Record<string, unknown>, path: string[]): string | undefined {
  let cursor: unknown = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return readString(cursor);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toolTitle(item: Record<string, unknown> | undefined): string {
  if (!item) {
    return "tool";
  }
  const type = readString(item.type) ?? "tool";
  const toolName=[readString(item.tool),readString(item.name),type].filter(Boolean).join(' ').toLowerCase();
  if(toolName.includes('view_image')||toolName.includes('imageview'))return '查看图片';
  if(toolName.includes('apply_patch')||toolName.includes('filechange')||toolName.includes('edit_file')||toolName.includes('write_file'))return '编辑文件';
  if (type === "commandExecution") {
    return readString(item.command) ?? "命令执行";
  }
  if (type === "fileChange") {
    return "文件变更";
  }
  if (type === "mcpToolCall") {
    return `${readString(item.server) ?? "MCP"} · ${readString(item.tool) ?? "tool"}`;
  }
  if (type === "dynamicToolCall") {
    return `${readString(item.namespace) ?? "tool"} · ${readString(item.tool) ?? "call"}`;
  }
  if (type === "webSearch") {
    return `搜索：${readString(item.query) ?? ""}`.trim();
  }
  return type;
}

function itemStatus(item: Record<string, unknown> | undefined): "ok" | "error" | "cancelled" {
  const status = readString(item?.status)?.toLowerCase();
  if (status?.includes("error") || status?.includes("fail")) {
    return "error";
  }
  if (status?.includes("cancel")) {
    return "cancelled";
  }
  const exitCode = item?.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0) {
    return "error";
  }
  return "ok";
}

function approvalDetail(params: Record<string, unknown>): string {
  const parts = [
    readString(params.reason),
    readString(params.cwd),
    readString(params.grantRoot),
    params.permissions ? JSON.stringify(params.permissions, null, 2) : undefined,
  ].filter(Boolean);
  return parts.join("\n") || JSON.stringify(params);
}

function titleFromPrompt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "新对话";
  }
  return compact.length > 40 ? `${compact.slice(0, 39)}…` : compact;
}

function shouldRetitleThread(title: string | undefined, prompt: string): boolean {
  if (isInternalPrompt(prompt)) {
    return false;
  }
  return !title || title === "新对话" || title.startsWith("对话 · ");
}

function isInternalPrompt(prompt: string): boolean {
  return prompt === "CRASH_APP_SERVER" || prompt.startsWith("__");
}

function observe(target: Map<string, MethodObservation>, method: string): void {
  const current = target.get(method);
  const now = new Date().toISOString();
  if (current) {
    target.set(method, { ...current, count: current.count + 1, lastSeenAt: now });
    return;
  }
  target.set(method, { method, count: 1, lastSeenAt: now });
}

function observations(target: Map<string, MethodObservation>): MethodObservation[] {
  return [...target.values()].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

