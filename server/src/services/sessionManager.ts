import {imageInputs,type ImageAttachment} from './imageUploads.js';
import {resolveFiles,filePrompt,type FileAttachment} from './fileUploads.js';
import type { CodexAppServerClient } from "../codex/appServerClient.js";
import type { EventHub } from "./eventHub.js";
import type { StateStore } from "./stateStore.js";
import {readModelCatalog} from './modelCatalog.js';
import {readUserSettings,readCustomPermissions} from './codexSettings.js';
import {isWriterOccupied} from './userFacingError.js';
import {AgentSessions} from './agentSessions.js';
import {modelAgent,threadAgent} from './agentProtocol.js';
import {readRemoteAutoApproval} from './remoteApprovalSettings.js';

type ThreadStartResult = {
  thread?: {
    id?: string;
  };
};

export const APP_SERVER_CLIENT_REQUEST_METHODS = [
  "initialize",
  "thread/start",
  "thread/resume",
  "turn/start",
  "turn/interrupt",
] as const;

export const APP_SERVER_NOTIFICATION_METHODS = [
  "thread/started",
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
  "item/*Approval*",
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
  "execCommandApproval",
  "applyPatchApproval",
] as const;

type MethodObservation = {
  method: string;
  count: number;
  lastSeenAt: string;
};

type ClientCommand =
  | { type: "thread.start"; requestId?: string; projectPath?: string; model?: string; effort?:string; permission?:"ask"|"auto"|"full"|"custom"; initialText?: string; images?: ImageAttachment[]; files?:FileAttachment[] }
  | { type: "thread.resume"; requestId?: string; threadId: string; projectPath?: string; model?: string }
  | { type: "turn.start"; requestId?: string; threadId: string; projectPath?: string; model?: string; effort?:string; permission?:"ask"|"auto"|"full"|"custom"; text: string; images?: ImageAttachment[]; files?:FileAttachment[] }
  | { type: "turn.interrupt"; requestId?: string; threadId: string }
  | { type: "approval.resolve"; requestId?: string; approvalId: string; decision: "accept" | "decline" }
  | { type: "debug.echo"; requestId?: string; threadId?: string; text: string; images?: ImageAttachment[] };

async function permissionOverrides(permission:"ask"|"auto"|"full"|"custom") {
  if(permission === "custom") return readCustomPermissions();
  return permission === "full"
    ? {approvalPolicy:"never",approvalsReviewer:"user",sandbox:"danger-full-access",sandboxPolicy:{type:"dangerFullAccess"}}
    : {approvalPolicy:"on-request",approvalsReviewer:permission === "auto" ? "auto_review" : "user",sandbox:"workspace-write",sandboxPolicy:{type:"workspaceWrite"}};
}

export class SessionManager {
  readonly agents:AgentSessions;
  private readonly publicThreads = new Set<string>();
  private readonly publicActiveTurns = new Set<string>();
  private readonly activeThreads = new Set<string>();
  private readonly activeTurns = new Map<string, string>();
  private readonly startingTurns = new Set<string>();
  private readonly approvalPermissions = new Map<string, Record<string, unknown>>();
  private readonly resolvingApprovals = new Set<string>();
  private readonly unknownNotifications = new Map<string, MethodObservation>();
  private readonly unsupportedServerRequests = new Map<string, MethodObservation>();

  markPublicThread(threadId:string):void { this.publicThreads.add(threadId); }

  constructor(
    private readonly codex: CodexAppServerClient,
    private readonly hub: EventHub,
    private readonly store: StateStore,
  ) {
    this.agents=new AgentSessions(store,hub);
    this.codex.on("notification", (message) => this.handleCodexNotification(message));
    this.codex.on("serverRequest", (message) => void this.handleServerRequest(message));
    this.codex.on("stderr", (text) => {
      this.hub.publish({ type: "terminal.output", threadId: "app-server", stream: "stderr", text: String(text) });
    });
    this.codex.on("exit", (_code:unknown,context?:{shared?:boolean}) => {
      this.activeThreads.clear();
      this.activeTurns.clear();
      this.approvalPermissions.clear();
      const pending = this.store.approvals.filter(approval => approval.status === "pending");
      void this.store.expirePendingApprovals();
      for (const approval of pending) this.hub.publish({ type: "approval.resolved", threadId: approval.threadId, approvalId: approval.id, decision: "decline" });
      for (const thread of this.store.threads.filter((item) => item.status === "running"&&!context?.shared&&threadAgent(item.id)==='codex')) {
        void this.store.upsertThread({ id: thread.id, status: "error" });
        this.hub.publish({ type: "turn.completed", threadId: thread.id, status: "error" });
      }
    });
  }

  ownsThread(threadId:string):boolean { return this.agents.owns(threadId)||this.activeTurns.has(threadId) || this.startingTurns.has(threadId); }
  canSteer(threadId:string):boolean { return this.activeTurns.has(threadId); }
  canSteerPublic(threadId:string):boolean { return this.publicActiveTurns.has(threadId)&&this.activeTurns.has(threadId); }
  async steer(threadId:string,text:string,images:ImageAttachment[]=[],files:FileAttachment[]=[],desktopTurnId?:string):Promise<void> {
    const expectedTurnId=this.activeTurns.get(threadId)||desktopTurnId;
    if(!expectedTurnId)throw new Error('当前没有可引导的运行轮次，消息已保留在队列中');
    const resolved=await resolveFiles(files);const prompt=text+filePrompt(resolved);
    const input=[...(prompt.trim()?[{type:'text',text:prompt,text_elements:[]}]:[]),...await imageInputs(images)];
    await this.codex.request('turn/steer',{threadId,expectedTurnId,input});
    this.hub.publish({type:'user.message',threadId,text,images,files});
  }

  async handleClientCommand(command: ClientCommand,viaPublic=false): Promise<void> {
    if(('threadId' in command&&threadAgent(command.threadId)!=='codex')||(command.type==='thread.start'&&modelAgent(command.model)!=='codex')){await this.agents.handle(command);return;}
    if(viaPublic&&'threadId' in command&&command.threadId)this.markPublicThread(command.threadId);
    if (command.type === "debug.echo") {
      this.hub.publish({ type: "message.delta", threadId: command.threadId ?? "debug", text: command.text });
      return;
    }

    if (command.type === "thread.start") {
      const access=command.permission?await permissionOverrides(command.permission):undefined;
      const result = (await this.codex.request("thread/start", {
        cwd: command.projectPath || undefined,
        model: command.model || undefined,
        ...(access ? {approvalPolicy:access.approvalPolicy,approvalsReviewer:access.approvalsReviewer,sandbox:access.sandbox} : {}),
      })) as ThreadStartResult;
      const threadId = result.thread?.id ?? "unknown";
      if(viaPublic)this.markPublicThread(threadId);
      this.activeThreads.add(threadId);
      const thread = await this.store.upsertThread({
        id: threadId,
        projectPath: command.projectPath,
        title: command.initialText?.trim() ? titleFromPrompt(command.initialText) : "新对话",
        status: "idle",
      });
      this.hub.publish({ type: "thread.started", threadId, thread, requestId: command.requestId });
      if (command.initialText?.trim() || command.images?.length || command.files?.length) {
        await this.startTurn(threadId, command.initialText || "", {model:command.model,projectPath:command.projectPath,images:command.images,files:command.files,effort:command.effort,permission:command.permission});
        if(viaPublic)this.publicActiveTurns.add(threadId);
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
      await this.ensureThread(command.threadId, {
        projectPath: command.projectPath,
        model: command.model,
      });
      await this.startTurn(command.threadId, command.text, { images:command.images,files:command.files,effort:command.effort,permission:command.permission,
        projectPath: command.projectPath,
        model: command.model,
      });
      if(viaPublic)this.publicActiveTurns.add(command.threadId);
      else this.publicActiveTurns.delete(command.threadId);
      return;
    }

    if (command.type === "turn.interrupt") {
      const turnId = this.activeTurns.get(command.threadId);
      if (!turnId) throw new Error("当前会话没有正在运行的任务");
      await this.codex.request("turn/interrupt", {
        threadId: command.threadId,
        turnId,
      });
      this.activeTurns.delete(command.threadId);
      this.publicActiveTurns.delete(command.threadId);
      await this.store.upsertThread({ id: command.threadId, status: "interrupted" });
      this.hub.publish({ type: "turn.completed", threadId: command.threadId, status: "interrupted" });
      return;
    }

    if (command.type === "approval.resolve") {
      await this.resolveApproval(command.approvalId, command.decision);
    }
  }

  async resumeThread(threadId: string, options: { projectPath?: string; model?: string } = {}): Promise<void> {
    if(threadAgent(threadId)!=='codex'){await this.agents.resume(threadId);return;}
    if (this.activeThreads.has(threadId)) {
      const thread = this.store.threads.find((item) => item.id === threadId);
      this.hub.publish({ type: "thread.started", threadId, thread });
      return;
    }

    const resumed=readRecord(await this.codex.request("thread/resume", {
      threadId,
      cwd: options.projectPath || undefined,
      model: options.model || undefined,
    }));
    const resumedThread=readRecord(resumed?.thread);
    const turns=Array.isArray(resumedThread?.turns)?resumedThread.turns:[];
    const active=turns.map(readRecord).reverse().find(turn=>turn?.status==='inProgress');
    const activeId=active&&readString(active.id);
    if(activeId)this.activeTurns.set(threadId,activeId);
    const isActive=activeId||readRecord(resumedThread?.status)?.type==='active';
    this.activeThreads.add(threadId);
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

  private async startTurn(threadId: string, text: string, options: { projectPath?: string; model?: string; effort?:string; permission?:"ask"|"auto"|"full"|"custom"; images?:ImageAttachment[]; files?:FileAttachment[] } = {}): Promise<void> {
    const previous=this.store.threads.find((thread) => thread.id === threadId);
    if (this.activeTurns.has(threadId)||this.startingTurns.has(threadId)) throw new Error("当前任务仍在运行，请等待完成或先停止。");
    const inputImages=await imageInputs(options.images);
    const resolvedFiles=await resolveFiles(options.files);
    const userText = text.trim();
    if(!userText && !inputImages.length&&!resolvedFiles.length) throw new Error("请输入消息或添加附件");
    this.startingTurns.add(threadId);
    try {
      await this.store.upsertThread({
        id: threadId,
        title: shouldRetitleThread(previous?.title, userText) ? titleFromPrompt(userText) : undefined,
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
    const result = readRecord(await this.codex.request("turn/start", {
      threadId,
      input: [...(text||resolvedFiles.length?[{ type: "text", text:text+filePrompt(resolvedFiles), text_elements: [] }]:[]),...inputImages],
      cwd: options.projectPath || undefined,
      model: options.model || undefined,
      effort,
      ...(access ? {approvalPolicy:access.approvalPolicy,approvalsReviewer:access.approvalsReviewer,sandboxPolicy:access.sandboxPolicy} : {}),
    }));
    const turnId = readNestedString(result ?? {}, ["turn", "id"]);
    if (turnId) this.activeTurns.set(threadId, turnId);
    this.hub.publish({ type: "user.message", threadId, text: userText, images:options.images, files:options.files });
    } catch (error) {
      if(isWriterOccupied(error)){
        await this.store.upsertThread({id:threadId,status:previous?.status??'idle',title:previous?.title});
        throw error;
      }
      await this.store.upsertThread({ id: threadId, status: "error" });
      this.hub.publish({ type: "turn.completed", threadId, status: "error" });
      throw error;
    } finally {this.startingTurns.delete(threadId);}
  }

  async resolveApproval(approvalId: string, decision: "accept" | "decline"): Promise<void> {
    if(approvalId.startsWith('agent-')){await this.agents.resolveApproval(approvalId,decision);return;}
    if(this.resolvingApprovals.has(approvalId))throw new Error('审批正在处理，请稍后刷新');
    const approval = this.store.approvals.find(item => item.id === approvalId);
    if (!approval || approval.status !== "pending") throw new Error("审批已处理或失效，请刷新状态");
    if(approval.approvalType === "question") throw new Error("请填写问题的回答");
    this.resolvingApprovals.add(approvalId);
    try{
      const permissions = this.approvalPermissions.get(approvalId) ?? {};
      const result = approval.method === "item/permissions/requestApproval"
        ? { permissions: decision === "accept" ? permissions : {}, scope: "turn" }
        : { decision };
      await this.codex.respond(approval.rpcId, result);
      await this.store.resolveApproval(approvalId, decision);
      this.approvalPermissions.delete(approvalId);
      this.hub.publish({ type: "approval.resolved", threadId: approval.threadId, approvalId, decision });
    }finally{this.resolvingApprovals.delete(approvalId);}
  }

  async approvePendingAutomatically():Promise<{accepted:number;failed:number}>{
    let accepted=0,failed=0;
    for(const approval of this.store.approvals.filter(item=>item.status==='pending'&&item.approvalType!=='question')){
      try{await this.resolveApproval(approval.id,'accept');accepted++;}
      catch{failed++;}
    }
    return {accepted,failed};
  }

  async answerQuestions(id:string, answers:Record<string,{answers:string[]}>):Promise<void> {
    const request=this.store.approvals.find(a=>a.id===id&&a.approvalType==='question');
    if(!request||request.status!=='pending')throw new Error('问题已回答或失效');
    const questions=JSON.parse(request.detail||'{}').questions||[];
    const result:Record<string,{answers:string[]}>={};
    for(const question of questions){
      const values=answers[question.id]?.answers;
      if(!Array.isArray(values)||values.length!==1||!values[0].trim())throw new Error('请回答所有问题');
      result[question.id]={answers:[values[0]]};
    }
    await this.codex.respond(request.rpcId,{answers:result});
    await this.store.resolveApproval(id,'accept');
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
    const approval = await this.store.addApproval({
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
    });

    this.approvalPermissions.set(approval.id, readRecord(params.permissions) ?? {});
    if(!this.publicThreads.has(threadId)&&await readRemoteAutoApproval()){
      try{
        await this.resolveApproval(approval.id,'accept');
        return;
      }catch{/* Keep the request visible when automatic handling cannot complete. */}
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

  private handleCodexNotification(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }
    const event = message as { method?: string; params?: Record<string, unknown> };
    const params = event.params ?? {};
    const threadId = readNestedString(params, ["thread", "id"]) ?? readString(params.threadId) ?? "unknown";

    if(event.method === 'serverRequest/resolved') {
      for(const approval of this.store.approvals.filter(a=>a.status==='pending'&&a.rpcId===params.requestId&&a.threadId===threadId)) {
        void this.store.expireApproval(approval.id);
        this.hub.publish({type:'approval.resolved',threadId,approvalId:approval.id,decision:'decline'});
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
        void this.store.upsertThread(threadRecord);
        this.activeThreads.add(threadRecord.id);
        this.hub.publish({ type: "thread.started", threadId: threadRecord.id, thread: { ...threadRecord, createdAt: nowIso(), updatedAt: nowIso() } });
      }
      return;
    }

    if (event.method === "thread/status/changed") {
      const status = mapCodexThreadStatus(readString(params.status) ?? readNestedString(params, ["status", "type"]));
      void this.store.upsertThread({ id: threadId, status });
      this.hub.publish({ type: "thread.started", threadId, thread: { id: threadId, title: "", status, createdAt: nowIso(), updatedAt: nowIso() } });
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

    if (event.method === "turn/started") {
      const turnId = readNestedString(params, ["turn", "id"]) ?? readString(params.turnId);
      if (turnId) this.activeTurns.set(threadId, turnId);
      if (threadId !== "unknown") {
        void this.store.upsertThread({ id: threadId, status: "running" });
        this.hub.publish({ type: "thread.started", threadId, thread: { id: threadId, title: "", status: "running", createdAt: nowIso(), updatedAt: nowIso() } });
      }
      return;
    }

    if (event.method === "item/agentMessage/delta") {
      const text = readString(params.delta) ?? readString(params.text) ?? "";
      if (text) {
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
      this.activeTurns.delete(threadId);
      this.publicActiveTurns.delete(threadId);
      const status = readString(params.status) ?? readNestedString(params, ["turn", "status"]) ?? "completed";
      const mappedStatus = mapCodexThreadStatus(status);
      void this.store.upsertThread({ id: threadId, status: mappedStatus });
      this.hub.publish({ type: "turn.completed", threadId, status: mappedStatus });
      const errorMessage = readNestedString(params, ["turn", "error", "message"]);
      if (errorMessage) {
        this.hub.publish({ type: "error", threadId, message: errorMessage });
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
      if (text) {
        this.hub.publish({
          type: "terminal.output",
          threadId,
          stream: "stdout",
          text,
        });
        this.hub.publish({
          type: "tool.output",
          threadId,
          itemId: readString(params.itemId),
          text,
        });
      }
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
      const message = readNestedString(params, ["error", "message"]) ?? readString(params.message) ?? JSON.stringify(params);
      if (threadId !== "unknown") {
        void this.store.upsertThread({ id: threadId, status: "error" });
      }
      this.hub.publish({ type: "error", threadId: threadId === "unknown" ? undefined : threadId, message });
      return;
    }

    if (event.method === "remoteControl/status/changed") {
      return;
    }

    if (event.method?.includes("Approval") || event.method?.includes("approval")) {
      this.hub.publish({
        type: "approval.requested",
        threadId,
        turnId: readString(params.turnId),
        itemId: readString(params.itemId),
        approvalId: readString(params.approvalId),
        approvalType: event.method.includes("file") || event.method.includes("File") ? "file" : "command",
        title: readString(params.command) ?? readString(params.reason) ?? "需要审批",
        detail: approvalDetail(params),
      });
      return;
    }

    if (event.method === "item/started") {
      const item = readRecord(params.item);
      const itemType = readString(item?.type) ?? "tool";
      if (itemType === "contextCompaction") {
        this.hub.publish({type:"context.compaction",threadId,itemId:readString(item?.id),title:"压缩上下文",status:"running"});
        return;
      }
      if (["userMessage", "agentMessage", "reasoning"].includes(itemType)) return;
      this.hub.publish({
        type: "tool.started",
        threadId,
        itemId: readString(item?.id),
        title: toolTitle(item),
        detail: itemType,
      });
      return;
    }

    if (event.method === "item/completed") {
      const item = readRecord(params.item);
      const itemType = readString(item?.type);
      if (itemType === "contextCompaction") {
        this.hub.publish({type:"context.compaction",threadId,itemId:readString(item?.id),title:"压缩上下文",status:itemStatus(item)});
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
        });
      }
      this.hub.publish({
        type: "tool.completed",
        threadId,
        itemId: readString(item?.id),
        status: itemStatus(item),
        detail: toolTitle(item),
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


