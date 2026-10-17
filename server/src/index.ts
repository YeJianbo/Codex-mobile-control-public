import {AssistantModelCatalog} from './services/assistantModelCatalog.js';
import {readCodexActivityEventsByIds,readCodexHistoryImageSource,readCodexOutputSourceEventById} from './services/codexSessions.js';
import {registerThreadFast} from './services/threadFast.js';
import {ChannelStore} from './channels/store.js';
import {ChannelService} from './channels/service.js';
import {registerChannelRoutes} from './channels/routes.js';
import {qqDriver} from './channels/qq.js';
import {weixinDriver} from './channels/weixin.js';
import {CloudSnapshots,isCloudSnapshot,assertControllableThread} from './services/cloudSnapshots.js';
import {listAutomations,listAutomationTargets,saveAutomation} from './services/automations.js';
import {CloudThreads,isCloudThread} from './services/cloudThreads.js';
import {cloudSourceAvatar,enrichMessageSources} from './services/messageSource.js';
import {confirmedToolChanges} from './services/fileChanges.js';
import type {ClientCommand} from './services/sessionManager.js';
import {sidebarPage,sidebarPageQuery} from './services/sidebarPage.js';
import {SidebarDeltaCache} from './services/sidebarDelta.js';
import {SidebarStatusCache} from './services/sidebarStatus.js';
import {subagentSidebarPage,subagentThreadScope} from './services/subagentThreads.js';
import {archiveOrCloseSubagent} from './services/subagentClose.js';
import {desktopThreadIsSubagent,desktopArchivedThreads,desktopThreadSections} from './services/desktopSidebar.js';
import {GoalCompletionTracker,readCodexGoalSnapshot} from './services/codexGoals.js';
import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, X509Certificate } from "node:crypto";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { WebSocketServer } from "ws";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { loadServerConfig, saveServerConfig, rotateServerToken, serverConfigPath } from "./services/configStore.js";
import { addProject, addProjectRoot, listProjectRootsWithStatus, listProjects, removeProjectRoot, canonicalProjectPath } from "./services/projects.js";
import { readApprovalPolicySummary, readUserSettings, readUserSettingsRaw, writeUserSettings, writeUserSettingsRaw } from "./services/codexSettings.js";
import { EventHub } from "./services/eventHub.js";
import { CodexAppServerClient } from "./codex/appServerClient.js";
import { bearerToken, isAuthorizedWithDevices } from "./routes/auth.js";
import { SessionManager } from "./services/sessionManager.js";
import { StateStore, stateStorePath } from "./services/stateStore.js";
import { acceptFileDiff, acceptFileDiffHunk, acceptFileDiffs, listDirectory, listProjectDiffFiles, readFileDiff, readFileDiffHunks, readProjectDiff, readTextFile, resolveRawFile, revertFileDiff, revertFileDiffHunk, revertFileDiffs, writeTextFile } from "./services/workspaceFiles.js";
import { LocalTerminal } from "./services/localTerminal.js";
import { httpsListenOptions, readHttpsConfig, updateHttpsConfig } from "./services/httpsConfig.js";
import { protocolMetadata } from "./protocol.js";
import { checkCodexUpgrade } from "./services/codexUpgrade.js";
import { formatDesktopQuestionReply, listThreadsWithCodexHistory, pendingDesktopQuestions, readCodexThreadEvents, readRecentSearchEvents, selectConversationWindow, selectConversationPage, readCodexConversationEvents, selectConversationTurns, deferMobileActivityDetails, readCodexActivityEventById, mobileDeferredActivityTypes } from "./services/codexSessions.js";
import {readCodexThreadCompletion} from './services/codexSessions.js';
import {withThreadReadState,watchDesktopReadState} from './services/threadReadState.js';
import {activityOutputImageText,resolveMarkdownOutputImage,resolvePublicOutputImage,resolveThreadOutputFile,storedOutputMessage} from './services/threadOutputFiles.js';
import {readCodexOutputEventById} from './services/codexSessions.js';
import type { GatewayEvent, ThreadRecord } from "./types.js";
import {readClashOpenAI,selectClashOpenAI,testClashOpenAI} from './services/clashOpenAI.js';
import { registerPreviewProxy, handlePreviewUpgrade } from "./services/previewProxy.js";
import {readModelCatalog,assertAvailableModel} from './services/modelCatalog.js';
import {modelAgent,threadAgent,publicAgentAllowed,configurePublicAgentAccess,agentNames} from './services/agentProtocol.js';
import {pairAddresses} from './services/pairAddresses.js';
import {registerImageUploads} from './services/imageUploads.js';
import {UploadStorage} from './services/uploadStorage.js';
import {registerFileUploads, type FileAttachment} from './services/fileUploads.js';
import {desktopSidebar,desktopThreadSettings,desktopPinnedThreads,PINNED_SECTION_ID} from './services/desktopSidebar.js';
import {appHome} from './services/paths.js';
import {createCodexProjectlessWorkspace} from './services/codexWorkspace.js';
import {FollowupQueue} from './services/followupQueue.js';
import {isWriterOccupied,userFacingError} from './services/userFacingError.js';
import {UsageReader} from './services/usage.js';
import {watchDeepSeekSessions,deepseekNativeSessions} from './services/deepseekNativeSessions.js';
import {readCodexGoals} from './services/codexGoals.js';
import {readRemoteAutoApproval,writeRemoteAutoApproval} from './services/remoteApprovalSettings.js';
import {verifyDeviceProof} from './services/deviceProof.js';
import {readPublicAccessSettings,updatePublicAccessPassword,updatePublicAccessSettings} from './services/publicAccessSettings.js';
import {mergeMobileThreadEvents,mergeDeepSeekThreadEvents,latestMobileThreadLifecycle,recoverMobileUploadFiles,recoverMobileUploadImages} from './services/mobileHistory.js';
import {registerLocalConsole} from './services/localConsole.js';
import {registerConsoleManagement} from './services/consoleManagement.js';
import {registerMobileMaintenance} from './services/mobileMaintenance.js';
import {registerMobileStatistics} from './services/mobileStatistics.js';
import {registerMobileSessionsChannels} from './services/mobileSessionsChannels.js';
import {registerMobileAssistant} from './services/mobileAssistant.js';
import {MessageSubmissions} from './services/messageSubmissions.js';
import {MobileActivityHistory} from './services/mobileActivityHistory.js';
import {deferLiveActivityDetails} from './services/mobileActivityDetails.js';
import {historyCompression,registerHistoryCompression} from './services/historyCompression.js';
import {AgentHealthMonitor} from './services/agentHealthMonitor.js';

const addProjectSchema = z.object({ path: z.string().min(1), create:z.boolean().optional() });
const projectRootQuerySchema = z.object({ path: z.string().min(1) });
const settingsSchema = z.object({
  model: z.string().optional(),
  modelProvider: z.string().optional(),
  providerBaseUrl: z.string().optional(),
  approvalPolicy: z.string().optional(),
  sandboxMode: z.string().optional(),
  reasoningEffort: z.string().optional(),
  networkAccess: z.boolean().optional(),
  disableResponseStorage: z.boolean().optional(),
});
const rawSettingsSchema = z.object({
  content: z.string().max(256 * 1024),
});
const fileQuerySchema = z.object({
  path: z.string().optional(),
});
const writeFileSchema = z.object({
  content: z.string(),
});
const proxyQuerySchema = z.object({
  url: z.string().url(),
});
const pairDeviceSchema = z.object({
  code: z.string().min(4),
  name: z.string().optional(),
  certificate: z.string().min(100).max(12000).optional(),
});
const resolveApprovalSchema = z.object({
  decision: z.enum(["accept", "decline"]),
});
const resumeThreadSchema = z.object({
  projectPath: z.string().optional(),
  model: z.string().optional(),
});
const updateThreadSchema = z.object({
  title: z.string().trim().min(1).max(160),
});
const runCommandSchema = z.object({
  command: z.string().min(1).max(2000),
});
const terminalSessionSchema = z.object({
  cols: z.number().int().min(20).max(240).optional(),
  rows: z.number().int().min(5).max(80).optional(),
});
const terminalInputSchema = z.object({
  text: z.string().min(1).max(20000),
  appendNewline: z.boolean().optional(),
});
const terminalResizeSchema = z.object({
  cols: z.number().int().min(20).max(240),
  rows: z.number().int().min(5).max(80),
});
const terminalHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
const terminalCommandsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeOutput: z.enum(["true", "false"]).optional(),
  previewChars: z.coerce.number().int().min(0).max(100000).optional(),
});
const terminalOutputQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100000).optional(),
  stream: z.enum(["stdout", "stderr", "combined"]).optional(),
});
const diffBatchSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200),
});
const diffHunkSchema = z.object({
  source: z.enum(["worktree", "staged"]),
  index: z.number().int().min(0),
});
const requestFields = { requestId: z.string().optional() };
const projectFields = { projectPath: z.string().optional(), model: z.string().optional(), effort:z.string().optional(), mode:z.enum(["plan","default"]).optional(),fast:z.boolean().optional(), permission:z.enum(["ask","auto","full","custom"]).optional() };
const fileSchema=z.object({id:z.string().uuid(),name:z.string().max(160),mime:z.string().max(120),size:z.number().int().nonnegative()});
const imageFields={images:z.array(z.object({id:z.string(),name:z.string().max(160)})).optional(),files:z.array(fileSchema).max(8).optional()};
const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.start"), ...requestFields, ...projectFields, ...imageFields, initialText: z.string().optional() }),
  z.object({ type: z.literal("thread.resume"), ...requestFields, ...projectFields, threadId: z.string().min(1) }),
  z.object({ type: z.literal("turn.start"), ...requestFields, ...projectFields, ...imageFields, threadId: z.string().min(1), text: z.string().trim(),replaceTurnId:z.string().min(1).max(160).optional() }),
  z.object({ type: z.literal("turn.interrupt"), ...requestFields, threadId: z.string().min(1) }),
  z.object({ type: z.literal("approval.resolve"), ...requestFields, approvalId: z.string().min(1), decision: z.enum(["accept", "decline"]) }),
  z.object({ type: z.literal("debug.echo"), ...requestFields, threadId: z.string().optional(), text: z.string() }),
]);

const config = await loadServerConfig();
configurePublicAgentAccess(config.publicAgents);
const publicProxySecret=await fs.readFile(path.join(appHome(),'public-access.json'),'utf8').then(raw=>(JSON.parse(raw) as {proxySecret?:string}).proxySecret).catch(()=>undefined);
const store = new StateStore();
await store.load();
await store.closeDanglingTerminalCommands();
await store.expirePendingApprovals();
const httpsOptions = await httpsListenOptions(config);
const app = Fastify({ logger: { serializers: { req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url.replace(/([?&]token=)[^&]*/g, "$1[redacted]") }) } }, ...(httpsOptions ? { https: httpsOptions } : {}) } as any) as unknown as FastifyInstance;
await registerHistoryCompression(app);
const hub = new EventHub(store,desktopThreadIsSubagent,connection=>app.log.info({connection},'Gateway event connection'));
const closeDesktopReadWatcher=watchDesktopReadState(()=>hub.publish({type:'thread.read-state.changed'},false));
app.addHook('onClose',async()=>closeDesktopReadWatcher());
const goalCompletions=new GoalCompletionTracker(readCodexGoalSnapshot());
setInterval(()=>{
  for(const {threadId,goal} of goalCompletions.accept(readCodexGoalSnapshot())){
    hub.publish({type:'goal.completed',threadId,title:'目标已结束',text:goal.objective,status:'complete',
      timeUsedSeconds:goal.timeUsedSeconds,eventId:`goal-completed:${threadId}:${goal.goalId||goal.createdAtMs||goal.updatedAtMs||Date.now()}`});
  }
},5000).unref();
const codex = new CodexAppServerClient();
const sessions = new SessionManager(codex, hub, store,undefined,async prompt=>{
  const workspace=await createCodexProjectlessWorkspace(prompt);
  await addProject(config,workspace);
  hub.publish({type:'projects.changed'});
  return workspace;
});
sessions.setCapacityAutoRetry(config.capacityAutoRetry===true);
app.addHook('onClose',async()=>sessions.closeCapacityRetries());
const submissions=new MessageSubmissions();
const activityHistory=new MobileActivityHistory();
for(const thread of store.threads.filter(t=>threadAgent(t.id)!=='codex'&&t.status==='running')){
  await store.upsertThread({id:thread.id,status:'interrupted'});
  hub.publish({type:'turn.completed',threadId:thread.id,status:'interrupted'});
}
async function validateAgentModel(model?:string,id?:string){
  if(id&&model&&threadAgent(id)!==modelAgent(model))throw Error('请在新会话中切换助手，当前会话继续使用原助手');
  if((id?threadAgent(id):modelAgent(model))!=='codex')await sessions.agents.validate(model,id);
  else await assertAvailableModel(codex,model);
}
const currentThreadStatus=async(id:string,events:GatewayEvent[])=>{
  const status=await sessions.currentThreadStatus(id,events);
  await sessions.pauseInterruptedGoal(id,status);
  return status;
};
const followups=new FollowupQueue(store,sessions,async id=>{
  return currentThreadStatus(id,await readCodexThreadEvents(id));
},async entry=>{
  await validateAgentModel(entry.model,entry.threadId);
  const projectPath=await assertProjectAccess(undefined,entry.threadId);
  await sessions.handleClientCommand({type:'turn.start',threadId:entry.threadId,text:entry.text,images:entry.images,files:entry.files,model:entry.model,effort:entry.effort,mode:entry.mode,fast:entry.fast,permission:entry.permission,requestId:entry.id,projectPath},entry.sourcePublic===true,true);
});
app.addHook('onClose',async()=>followups.close());
app.addHook('onClose',async()=>sessions.agents.close());
const localTerminal = new LocalTerminal(config, hub);
const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const consoleHtmlPath = path.join(serverRoot, "public", "console.html");
const assets: Record<string, [string, string]> = {
  'file-links.js':['public/file-links.js','text/javascript'],
  'compat.js':['node_modules/core-js-bundle/minified.js','text/javascript'],
  'math.js':['public/math.js','text/javascript'],
  'katex.js':['node_modules/katex/dist/katex.mjs','text/javascript'],
  'katex.css':['node_modules/katex/dist/katex.min.css','text/css'],
  'pdf.js':['node_modules/pdfjs-dist/legacy/build/pdf.mjs','text/javascript'],
  'pdf.worker.js':['node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','text/javascript'],
  "custom-controls.js": ["public/custom-controls.js", "text/javascript"],
  "preview-runtime.js": ["public/preview-runtime.js", "text/javascript"],
  "console.css": ["public/console.css", "text/css"],
  "harness-hermes.svg": ["public/harness-hermes.svg", "image/svg+xml"],
  "harness-opencode.svg": ["public/harness-opencode.svg", "image/svg+xml"],
  "harness-deepseek.svg": ["public/harness-deepseek.svg", "image/svg+xml"],
  "console.js": ["public/console.js", "text/javascript"],
  "channels-ui.js": ["public/channels-ui.js", "text/javascript"],
  "console-core.js": ["public/console-core.js", "text/javascript"],
  "compaction-events.js": ["public/compaction-events.js", "text/javascript"],
  "thread-family.js": ["public/thread-family.js", "text/javascript"],
  "thread-cache.js": ["public/thread-cache.js", "text/javascript"],
  "patch-view.js": ["public/patch-view.js", "text/javascript"],
  "highlight.js": ["public/highlight.js", "text/javascript"],
  "xterm.js": ["node_modules/@xterm/xterm/lib/xterm.js", "text/javascript"],
  "xterm.css": ["node_modules/@xterm/xterm/css/xterm.css", "text/css"],
  "xterm-fit.js": ["node_modules/@xterm/addon-fit/lib/addon-fit.js", "text/javascript"],
  "marked.js": ["node_modules/marked/lib/marked.esm.js", "text/javascript"],
  "purify.js": ["node_modules/dompurify/dist/purify.es.mjs", "text/javascript"],
};

codex.on("exit", (code) => {
  hub.publish({ type: "codex.status", status: "stopped", detail: `app-server exited: ${code ?? "unknown"}` });
});
codex.on("processError", (error) => {
  hub.publish({ type: "codex.status", status: "error", detail: error instanceof Error ? error.message : String(error) });
});
codex.on("autorestart", (event) => {
  const detail = readEventDetail(event, "app-server 将自动重启");
  hub.publish({ type: "codex.status", status: "stopped", detail });
});
codex.on("autorestarted", (event) => {
  const detail = readEventDetail(event, "app-server 已自动重启");
  hub.publish({ type: "codex.status", status: "running", detail });
});

await app.register(cors, { origin: false });

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: "bad_request", issues: error.issues });
  }
  if (error instanceof Error && error.message) {
    return reply.code(400).send({ error: error.message });
  }
  return reply.code(500).send({ error: "internal_server_error" });
});

app.get("/health", async () => ({
  ok: true,
  ...protocolMetadata(),
}));

app.get("/", async (_request, reply) => reply.redirect("/console"));
app.get("/console/assets/:asset", async (request, reply) => {
  const entry = assets[(request.params as { asset: string }).asset];
  if (!entry) return reply.code(404).send({ error: "not_found" });
  return reply.header("Cache-Control", "no-cache").type(entry[1]).send(await fs.readFile(path.join(serverRoot, entry[0])));
});
app.get('/console/assets/fonts/:font',async(request,reply)=>{
  const name=(request.params as {font:string}).font;
  if(!/^KaTeX_[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(name))return reply.code(404).send();
  return reply.type(name.endsWith('woff2')?'font/woff2':name.endsWith('woff')?'font/woff':'font/ttf').send(await fs.readFile(path.join(serverRoot,'node_modules/katex/dist/fonts',name)));
});

app.get("/console", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(await fs.readFile(consoleHtmlPath, "utf8"));
});

app.get("/console/", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(await fs.readFile(consoleHtmlPath, "utf8"));
});

app.get('/downloads/android.apk',async(_request,reply)=>{
  const apk=path.join(serverRoot,'public','downloads','android.apk');
  const stat=await fs.stat(apk);
  if(!stat.isFile())return reply.code(404).send({error:'not_found'});
  return reply.type('application/vnd.android.package-archive')
    .header('Content-Disposition','attachment; filename="Codex-Control.apk"')
    .header('Content-Length',String(stat.size))
    .header('Cache-Control','no-store')
    .send((await import('node:fs')).createReadStream(apk));
});

app.addHook("preHandler", async (request, reply) => {
  const pathname = new URL(request.url, `http://${request.headers.host ?? "localhost"}`).pathname;
  if(['/manage','/manage/','/manage/app.js','/manage/app.css','/manage/management.css'].includes(pathname))return;
  if (pathname === "/" || pathname === "/health" || pathname === "/console" || pathname === "/console/" || pathname === "/downloads/android.apk" || pathname.startsWith("/console/assets/") || pathname.startsWith("/preview/site/") || pathname.startsWith("/preview/file/") || pathname === "/api/pair/claim") {
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const queryToken = url.searchParams.get("token");
  if (!isAuthorizedWithDevices(request, config.token, store, queryToken)) {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }
  const token=bearerToken(request)??queryToken??'';
  const proxyHeader=request.headers['x-public-proxy-secret'];
  const viaPublic=typeof proxyHeader==='string'&&publicProxySecret!=null&&proxyHeader===publicProxySecret;
  if(proxyHeader&&!viaPublic){await reply.code(401).send({error:'unauthorized'});return;}
  const certificate=token===config.token?undefined:store.certificateForToken(token);
  if((viaPublic&&!certificate)||(certificate&&!verifyDeviceProof(certificate,request.method,request.url,request.headers))){
    await reply.code(401).send({error:'device_certificate_required'});
  }
});

app.get("/api/projects", async () => ({
  projects: await listProjects(config),
}));
const sidebarDeltas=new SidebarDeltaCache();
const sidebarStatuses=new SidebarStatusCache();
app.get('/api/sidebar/pins',async()=>({pinned:await desktopPinnedThreads()}));
app.get('/api/sidebar',async(request)=>{
  const query=sidebarPageQuery.parse(request.query);
  const [desktop,allowed]=await Promise.all([desktopSidebar(),listProjects(config)]);
  const normalize=(value:string)=>path.resolve(value).toLowerCase();
  const projects=desktop.projects.map(project=>({...project,...allowed.find(p=>normalize(p.path)===normalize(project.path)),name:project.name}));
  for(const project of allowed)if(!projects.some(p=>normalize(p.path)===normalize(project.path)))projects.push(project);
  if(query.limit!==undefined){
    const recency=new Map<string,number>();
    for(const thread of desktop.threads)if(thread.cwd){const key=normalize(thread.cwd);recency.set(key,Math.max(recency.get(key)||0,Number(thread.recency_at_ms||thread.updated_at_ms||0)));}
    projects.sort((a,b)=>(recency.get(normalize(b.path))||0)-(recency.get(normalize(a.path))||0));
  }
  const selectedPath=desktop.threads.find(t=>t.id===query.threadId)?.cwd||store.threads.find(t=>t.id===query.threadId)?.projectPath;
  const retained=new Set(query.keep?.split(',').filter(Boolean)||[]);
  const page=sidebarPage(projects,query.limit,p=>p.id===query.include||retained.has(p.id)||Boolean(selectedPath&&normalize(p.path)===normalize(selectedPath)));
  const result={projects:page.rows,allowedProjects:allowed.filter(p=>p.id===query.include||page.rows.some(row=>normalize(row.path)===normalize(p.path))),pinned:desktop.pinned,hasMore:page.hasMore};
  return query.delta?sidebarDeltas.reply('projects:'+JSON.stringify({...query,since:undefined}),result,['projects','allowedProjects'],query.since):result;
});

registerPreviewProxy(app, config);
const uploadStorage=new UploadStorage(store,async()=>{
  if(submissions.hasProcessing()||sessions.receipts.hasProcessing())return '消息正在提交，完成后再清理';
  const threads=await listThreadsWithCodexHistory(store.threads,false,store.threads.filter(thread=>sessions.ownsThread(thread.id)).map(thread=>thread.id));
  for(const thread of threads.filter(thread=>!thread.readOnly&&(thread.status==='running'||sessions.ownsThread(thread.id))))
    if(await currentThreadStatus(thread.id,await readCodexThreadEvents(thread.id))==='running')return '电脑有任务正在运行，结束后再清理附件';
  return submissions.hasProcessing()||sessions.receipts.hasProcessing()?'消息正在提交，完成后再清理':'';
});
const closeDeepSeekWatcher=await watchDeepSeekSessions(store,hub,id=>sessions.agents.owns(id));
app.addHook('onClose',async()=>closeDeepSeekWatcher());
uploadStorage.register(app);
registerImageUploads(app,uploadStorage);
registerFileUploads(app,uploadStorage);
registerLocalConsole(app);
registerConsoleManagement(app);
registerMobileMaintenance(app);
registerMobileStatistics(app);
registerMobileAssistant(app);
registerThreadFast(app,codex,async id=>{
  assertControllableThread(id);
  if(threadAgent(id)!=='codex')throw Error('当前助手不支持 Fast');
  await assertProjectAccess(undefined,id);
});

app.get("/api/config/project-roots", async () => ({
  roots: await listProjectRootsWithStatus(config),
}));

app.post("/api/config/project-roots", async (request) => {
  const body = addProjectSchema.parse(request.body);
  const root = await addProjectRoot(config, body.path);
  hub.publish({ type: "projects.changed" });
  return {
    root,
    roots: await listProjectRootsWithStatus(config),
  };
});

app.delete("/api/config/project-roots", async (request) => {
  const query = projectRootQuerySchema.parse(request.query);
  const root = await removeProjectRoot(config, query.path);
  hub.publish({ type: "projects.changed" });
  return {
    root,
    roots: await listProjectRootsWithStatus(config),
  };
});

app.get("/api/config/https", async () => ({
  https: await readHttpsConfig(config),
}));

app.put("/api/config/https", async (request) => {
  const body = z.object({
    enabled: z.boolean().optional(),
    generateSelfSigned: z.boolean().optional(),
    certPath: z.string().optional(),
    keyPath: z.string().optional(),
  }).parse(request.body ?? {});
  return { https: await updateHttpsConfig(config, body) };
});

app.get("/api/devices", async () => ({
  devices: store.devices,
}));

app.get('/api/network/openai',()=>readClashOpenAI());
app.put('/api/network/openai/node',request=>{
 const body=z.object({group:z.string().min(1).max(300),node:z.string().min(1).max(300)}).parse(request.body);
 return selectClashOpenAI(body.group,body.node);
});
app.post('/api/network/openai/test',request=>{
 const body=z.object({group:z.string().min(1).max(300),node:z.string().min(1).max(300)}).parse(request.body);
 return testClashOpenAI(body.group,body.node);
});

async function createPairingResponse(request: {query: unknown}) {
  const pairing = await store.createPairing();
  const addresses=pairAddresses(config.host,config.port,Boolean(config.https?.enabled));
  const requested=(request.query as {baseUrl?:string})?.baseUrl;
  const baseUrl = addresses.find(a=>a.url===requested)?.url || publicBaseUrl();
  const certificateSha256=config.https?.enabled?new X509Certificate(await fs.readFile(config.https.certPath!)).fingerprint256.replaceAll(':',''):'';
  const remote=await fs.readFile(path.join(appHome(),'public-access.json'),'utf8').then(value=>(JSON.parse(value) as {publicUrl?:string}).publicUrl).catch(()=>undefined);
  const publicUrl=remote&&/^https:\/\/[^/?#]+\/?$/.test(remote)?remote.replace(/\/$/,''):'';
  const setupUrl = `codex-control://pair?baseUrl=${encodeURIComponent(baseUrl)}&code=${encodeURIComponent(pairing.code)}${certificateSha256?`&certSha256=${certificateSha256}`:''}${publicUrl?`&publicUrl=${encodeURIComponent(publicUrl)}`:''}`;
  return {
    code: pairing.code,
    addresses,
    baseUrl,
    expiresAt: pairing.expiresAt,
    setupUrl,
    certificateSha256,
    publicUrl,
    qrSvg: await QRCode.toString(setupUrl, {
      type: "svg",
      margin: 4,
      width: 220,
      errorCorrectionLevel: "M",
    }),
  };
}

app.get("/api/pair/start", createPairingResponse);
app.post("/api/pair/start", createPairingResponse);

app.post("/api/pair/claim", async (request) => {
  const body = pairDeviceSchema.parse(request.body);
  if(body.certificate&&!verifyDeviceProof(body.certificate,request.method,request.url,request.headers))throw new Error('手机证书签名无效');
  if(request.headers['x-public-proxy-secret']&&!body.certificate)throw new Error('公网配对需要手机证书');
  const result = await store.consumePairing({
    code: body.code,
    name: body.name,
    userAgent: request.headers["user-agent"],
  });
  if(body.certificate)store.bindDeviceCertificate(result.device.id,body.certificate);
  return result;
});

app.delete("/api/devices/:deviceId", async (request) => {
  const params = request.params as { deviceId: string };
  return { device: await store.revokeDevice(params.deviceId) };
});

app.post("/api/auth/token/rotate", async (request, reply) => {
  const token = bearerToken(request);
  if (!token) {
    return reply.code(400).send({ error: "rotation_requires_authorization_header" });
  }
  if (token === config.token) {
    return {
      kind: "admin",
      token: await rotateServerToken(config),
    };
  }
  const rotated = await store.rotateDeviceToken(token, {
    userAgent: request.headers["user-agent"],
  });
  if (!rotated) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  return {
    kind: "device",
    token: rotated.token,
    device: rotated.device,
  };
});

const cloudSnapshots=new CloudSnapshots();
const cloudThreads=new CloudThreads();
app.addHook('onClose',async()=>cloudThreads.close());
app.addHook('preHandler',async(request,reply)=>{
  const match=/^\/api\/threads\/([^/?]+)/.exec(request.url);
  if(match&&request.method!=='GET'&&isCloudThread(decodeURIComponent(match[1])))return reply.code(403).send({error:'云端会话仅供查看，请在桌面操作。',code:'read_only_cloud'});
  if(match&&request.method!=='GET'&&isCloudSnapshot(decodeURIComponent(match[1])))return reply.code(403).send({error:'云端快照仅供查看，不能操作云端任务。',code:'read_only_snapshot'});
});
app.get('/api/cloud-snapshots',async()=>({threads:await cloudSnapshots.list()}));
app.get('/api/cloud/avatar/:threadId',async(request,reply)=>{
  try{const {threadId}=request.params as {threadId:string};const image=await cloudSourceAvatar(threadId);return reply.type(image.type).header('Cache-Control','private, max-age=300').send(image.body);}
  catch{return reply.code(404).send({error:'头像暂不可用'});}
});
app.post('/api/cloud-snapshots/import',async request=>({imported:await cloudSnapshots.import(request.body),threads:await cloudSnapshots.list()}));
app.get('/api/local-tasks',async()=>({requests:await sessions.receipts.list()}));
app.get('/api/local-tasks/:requestId',async(request,reply)=>{
  const {requestId}=request.params as {requestId:string};
  const receipt=await sessions.receipts.get(requestId);
  return receipt?{request:receipt}:reply.code(404).send({error:'未找到此请求的提交记录。'});
});
const assistantTransports:Record<string,'app-server'|'acp'|'unavailable'>={codex:'app-server',grok:'acp',deepseek:'acp',hermes:'acp',opencode:'acp',claude:'acp',antigravity:'acp'};
function assertAssistantLocal(request:{headers:Record<string,unknown>}){
  if(publicProxySecret!=null&&request.headers['x-public-proxy-secret']===publicProxySecret)throw Error('个人助理执行接口仅支持本地连接');
}
function assertAssistantTransport(agent:string){
  if(!assistantTransports[agent]||assistantTransports[agent]==='unavailable')throw Error('该助手尚未配置 ACP 适配器，个人助理不会回退到 CLI 文本协议');
}
const assistantCatalog=new AssistantModelCatalog({
  codex:async refresh=>(await readModelCatalog(codex,refresh)).models,
  external:async refresh=>({models:await sessions.agents.models(refresh),backends:await sessions.agents.backends()}),
  claude:refresh=>sessions.agents.officialModels('claude',refresh),
  antigravity:refresh=>sessions.agents.officialModels('antigravity',refresh),
});
const assistantModelCatalog=(refresh=false)=>assistantCatalog.read(refresh);
app.get('/api/assistant-models',async request=>{assertAssistantLocal(request);return assistantModelCatalog((request.query as any).refresh==='1');});
app.get('/api/assistant-tasks/:requestId',async(request,reply)=>{
  assertAssistantLocal(request);
  const {requestId}=z.object({requestId:z.string().min(1).max(160)}).parse(request.params);
  const receipt=await sessions.receipts.get(requestId);
  return receipt?{request:receipt}:reply.code(404).send({error:'未找到此请求的提交记录。'});
});
app.post('/api/assistant-tasks',async(request,reply)=>{
  assertAssistantLocal(request);
  const command=z.object({requestId:z.string().min(1).max(160),threadId:z.string().min(1).optional(),projectPath:z.string().optional(),text:z.string().min(1).max(200000),model:z.string().optional(),effort:z.string().optional()}).strict().parse(request.body);
  const identity={...command,type:command.threadId?'turn.start':'thread.start'} as ClientCommand;
  assertControllableThread(command.threadId||'');
  if(command.threadId)await managedThread(command.threadId);
  if(!command.model){
    const settings=command.threadId?(threadAgent(command.threadId)==='codex'?desktopThreadSettings(command.threadId):sessions.agents.settings(command.threadId)):null;
    command.model=settings?.model||(await assistantModelCatalog()).defaultModel||undefined;
  }
  if(!command.model)throw Error('当前目录没有可用的 Sol 模型，请先选择模型');
  const agent=modelAgent(command.model);
  assertAssistantTransport(agent);
  if(command.threadId&&threadAgent(command.threadId)!==agent)throw Error('已有任务不能切换助手，请创建新任务');
  const official=agent==='claude'||agent==='antigravity'?await sessions.agents.officialModels(agent):null;
  if(official&&!official.available)throw Error(official.reason);
  if(!official)await validateAgentModel(command.model,command.threadId);
  const entry=(official?official.models:agent==='codex'?(await readModelCatalog(codex)).models:await sessions.agents.models()).find(model=>model.model===command.model);
  if(!entry)throw Error('此模型不在该助手当前可用目录中');
  if(command.effort&&!entry?.supportedReasoningEfforts.some(level=>level.reasoningEffort===command.effort))throw Error('此模型不支持所选思考等级');
  command.effort||=entry?.defaultReasoningEffort;
  command.projectPath=await assertProjectAccess(command.projectPath,command.threadId);
  const permission=agent==='codex'?undefined:'ask' as const;
  const agentTransport=agent==='codex'?undefined:'acp' as const;
  if(command.threadId)await sessions.handleClientCommand({type:'turn.start',...command,threadId:command.threadId,permission,agentTransport},false,false,identity);
  else{const {threadId,text,...fields}=command;await sessions.handleClientCommand({type:'thread.start',...fields,initialText:text,permission,agentTransport},false,false,identity);}
  return reply.code(202).send({request:await sessions.receipts.get(command.requestId)});
});
app.post('/api/assistant-threads/:threadId/interrupt',async request=>{
  assertAssistantLocal(request);
  const {threadId}=z.object({threadId:z.string().min(1).max(256)}).parse(request.params);
  const {requestId}=z.object({requestId:z.string().min(1).max(160).optional()}).strict().parse(request.body??{});
  await managedThread(threadId);
  const agent=threadAgent(threadId);assertAssistantTransport(agent);
  await assertProjectAccess(undefined,threadId);
  if(agent==='codex')await interruptCodexThread(threadId,requestId);
  else await sessions.handleClientCommand({type:'turn.interrupt',threadId,requestId});
  return {ok:true,threadId,requestId};
});
async function submitLocalTask(raw:unknown,viaPublic:boolean){
  const command=z.object({requestId:z.string().min(1).max(160),threadId:z.string().optional(),projectPath:z.string().optional(),text:z.string().min(1).max(200000),model:z.string().optional(),effort:z.string().optional(),mode:z.enum(['default','plan']).optional(),fast:z.boolean().optional()}).strict().parse(raw);
  assertControllableThread(command.threadId||'');
  const identity={...(raw as object),type:command.threadId?'turn.start':'thread.start'} as ClientCommand;
  const settings=command.threadId?desktopThreadSettings(command.threadId):undefined;
  command.model ||= settings?.model||'gpt-6-sol';
  if(modelAgent(command.model)!=='codex')throw new Error('本地任务接口仅支持 Codex。');
  await validateAgentModel(command.model,command.threadId);
  command.projectPath=await assertProjectAccess(command.projectPath,command.threadId);
  command.effort ||= (settings?.model===command.model?settings.effort:undefined)||(command.model.includes('astra')?'medium':'high');
  if(!command.threadId&&!command.projectPath)throw new Error('启动本地任务需要选择已有项目目录。');
  if(command.threadId)await sessions.handleClientCommand({type:'turn.start',...command,threadId:command.threadId},viaPublic,false,identity);
  else {const {threadId,text,...fields}=command;await sessions.handleClientCommand({type:'thread.start',...fields,initialText:text},viaPublic,false,identity);}
  return sessions.receipts.get(command.requestId);
}
async function interruptCodexThread(threadId:string,requestId?:string){
  if(sessions.isCapacityRetryPending(threadId)){await sessions.interrupt(threadId,undefined,requestId);return;}
  const history=sessions.canSteer(threadId)?[]:await readCodexThreadEvents(threadId);
  if(!sessions.canSteer(threadId))await currentThreadStatus(threadId,history);
  const lifecycle=sessions.canSteer(threadId)?undefined:latestMobileThreadLifecycle(history,store.eventsForThread(threadId));
  if(lifecycle?.type==='turn.completed')return {type:'turn.completed' as const,threadId,requestId,status:lifecycle.status};
  await sessions.interrupt(threadId,lifecycle?.type==='turn.started'?lifecycle.turnId:undefined,requestId);
}
app.post('/api/local-tasks',async(request,reply)=>{
  const viaPublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  return reply.code(202).send({request:await submitLocalTask(request.body,viaPublic)});
});
app.post('/api/threads/:threadId/interrupt',async(request,reply)=>{
  const viaPublic=publicProxySecret!=null&&request.headers['x-public-proxy-secret']===publicProxySecret;
  if(viaPublic)return reply.code(403).send({error:'此停止入口仅支持本地连接'});
  const {threadId}=z.object({threadId:z.string().uuid()}).parse(request.params);
  const {requestId}=z.object({requestId:z.string().min(1).max(160).optional()}).strict().parse(request.body??{});
  if(threadAgent(threadId)!=='codex')return reply.code(400).send({error:'此停止入口仅支持本地 Codex 会话'});
  await managedThread(threadId);
  await assertProjectAccess(undefined,threadId);
  await interruptCodexThread(threadId,requestId);
  return {ok:true,threadId,requestId};
});
const channels=new ChannelService(new ChannelStore(),{
  validateProject:async projectPath=>{await assertProjectAccess(projectPath);},
  validateThread:async threadId=>{
    assertControllableThread(threadId);
    if(threadAgent(threadId)!=='codex')throw Error('消息通道目前仅支持绑定 Codex 会话');
    await assertProjectAccess(undefined,threadId);
  },
  submit:command=>submitLocalTask(command,false),
  receipt:requestId=>sessions.receipts.get(requestId),
  status:async threadId=>currentThreadStatus(threadId,await readCodexThreadEvents(threadId)),
  result:async threadId=>{const events=await readCodexThreadEvents(threadId);const latest=events.filter(event=>event.type==='message.delta').at(-1);return latest?.type==='message.delta'?latest.text:'';},
  interrupt:async(threadId,requestId)=>{await interruptCodexThread(threadId,requestId);},
});
channels.register(qqDriver(channels));
channels.register(weixinDriver(channels));
registerChannelRoutes(app,channels,config.token);
registerMobileSessionsChannels(app,{channels});
app.addHook('onReady',async()=>{channels.restore();});
const unsubscribeChannels=hub.subscribe(event=>channels.publish(event));
app.addHook('onClose',async()=>{unsubscribeChannels();await channels.close();});

app.get("/api/threads", async (request) => {
  const query=sidebarPageQuery.parse(request.query);
  const included=new Set(query.include?.split(",")||[]);
  // Native DeepSeek logs cannot contribute to another agent's filtered page,
  // except when that page explicitly retains a selected DeepSeek conversation.
  const includeDeepSeek=!query.agent||query.agent==='deepseek'||[...included].some(id=>id.startsWith('deepseek-'));
  const [cloud,local]=await Promise.all([cloudThreads.cachedList(),listThreadsWithCodexHistory(store.threads,false,store.threads.filter(t=>sessions.ownsThread(t.id)).map(t=>t.id),includeDeepSeek)]);
  const listed=[...await cloudSnapshots.list(),...cloud,...local].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const scoped=subagentThreadScope(listed.filter(thread=>!store.isThreadHidden(thread.id)),thread=>(!query.agent||threadAgent(thread.id)===query.agent||included.has(thread.id))&&(!query.project||path.resolve(thread.projectPath||'.').toLowerCase()===path.resolve(query.project).toLowerCase()));
  const initialPage=subagentSidebarPage(scoped,query.limit,thread=>(thread.pinnedIndex??-1)>=0||included.has(thread.id));
  const candidates=query.filter&&query.filter!=='all'?scoped:initialPage.rows;
  for(const thread of candidates.filter(thread=>(['running','interrupted','error'].includes(thread.status)||sessions.ownsThread(thread.id))&&!thread.readOnly)){
    thread.status=sidebarStatuses.read(thread,async()=>currentThreadStatus(thread.id,await readCodexThreadEvents(thread.id,undefined,'background')));
  }
  const annotated=await withThreadReadState(candidates,store);
  const matching=query.filter==='running'?subagentThreadScope(annotated,thread=>thread.status==='running')
    :query.filter==='unread'?subagentThreadScope(annotated,thread=>!!thread.unread&&thread.status!=='running'):annotated;
  const page=query.filter&&query.filter!=='all'?subagentSidebarPage(matching,query.limit,thread=>(thread.pinnedIndex??-1)>=0||included.has(thread.id)):{rows:matching,hasMore:initialPage.hasMore};
  // Include the current conversation's fresh metadata without making it consume
  // a filtered page. Clients hide nonmatching families in the sidebar itself.
  const rows=query.filter&&query.filter!=='all'?[...new Map([...page.rows,...subagentThreadScope(annotated,thread=>included.has(thread.id))].map(thread=>[thread.id,thread])).values()]:page.rows;
  const goals=readCodexGoals();
  const result={hasMore:page.hasMore,cloudError:cloudThreads.error,threads:rows
    .map(thread=>({...thread,...(goals.has(thread.id)?{goal:goals.get(thread.id)}:{})}))};
  return query.delta?sidebarDeltas.reply('threads:'+JSON.stringify({...query,since:undefined}),result,['threads'],query.since):result;
});

app.post('/api/threads/:threadId/read',async request=>{
  const {threadId}=z.object({threadId:z.string().min(1).max(200)}).parse(request.params);
  const {completedAt}=z.object({completedAt:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).parse(request.body);
  const latest=Math.max(store.threadCompletion(threadId),await readCodexThreadCompletion(threadId).catch(()=>0));
  const manual=store.manualUnread(threadId);
  if((!latest||completedAt>latest)&&(manual===undefined||completedAt> manual))return {readThrough:store.threadReadThrough(threadId)};
  const readThrough=store.markThreadRead(threadId,completedAt);
  hub.publish({type:'thread.read',threadId,readThrough});
  return {readThrough};
});

function threadSearchSnippet(text: string, needle: string): string {
  const lowered = text.toLowerCase();
  const index = lowered.indexOf(needle);
  const compact = (value: string) => value.replace(/\s+/g, " ").trim();
  if (index < 0) return compact(text).slice(0, 120);
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + needle.length + 80);
  return (start > 0 ? "…" : "") + compact(text.slice(start, end)) + (end < text.length ? "…" : "");
}

app.get("/api/threads/search", async (request,reply) => {
  const query = z.object({
    q: z.string().trim().min(1).max(120),
    agent: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(30).optional(),
  }).parse(request.query);
  const controller=new AbortController();
  const closed=()=>{if(!reply.raw.writableEnded)controller.abort();};
  reply.raw.once('close',closed);
  if(reply.raw.destroyed||request.raw.aborted)controller.abort();
  try{
  const needle = query.q.toLowerCase();
  const limit = query.limit ?? 12;
  const candidates = [...await cloudSnapshots.list(),...await cloudThreads.cachedList(),...await listThreadsWithCodexHistory(store.threads,false,[],!query.agent||query.agent==='deepseek')]
    .filter((thread) => !thread.subagent && !store.isThreadHidden(thread.id) && (!query.agent || threadAgent(thread.id) === query.agent))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  controller.signal.throwIfAborted();
  const matches: { threadId: string; title: string; snippet: string; updatedAt: string }[] = [];
  const seen = new Set<string>();
  for(const thread of candidates.filter(t=>isCloudThread(t.id)&&t.title.toLowerCase().includes(needle)).slice(0,limit)){matches.push({threadId:thread.id,title:thread.title,snippet:thread.title,updatedAt:thread.updatedAt});seen.add(thread.id);}
  for (const event of store.searchMessageEvents(needle, 200)) {
    if (matches.length >= limit) break;
    if (event.type !== "user.message" && event.type !== "message.delta") continue;
    if (!event.text.toLowerCase().includes(needle)) continue;
    if (!event.threadId || seen.has(event.threadId)) continue;
    const thread = candidates.find((candidate) => candidate.id === event.threadId);
    if (!thread) continue;
    seen.add(thread.id);
    matches.push({ threadId: thread.id, title: thread.title, snippet: threadSearchSnippet(event.text, needle), updatedAt: thread.updatedAt });
  }
  if (matches.length < limit) {
    const rest = candidates.filter((thread) => !isCloudThread(thread.id)&&!seen.has(thread.id) && threadAgent(thread.id) === "codex").slice(0, 24);
    for (let offset = 0; offset < rest.length && matches.length < limit; offset += 6) {
      controller.signal.throwIfAborted();
      const found = await Promise.all(rest.slice(offset, offset + 6).map(async (thread) => {
        try {
          const history = isCloudSnapshot(thread.id)?(await cloudSnapshots.read(thread.id)).events:await readRecentSearchEvents(thread.id,controller.signal);
          controller.signal.throwIfAborted();
          let hit: { threadId: string; text: string } | null = null;
          for (let index = history.length - 1; index >= 0; index--) {
            const event = history[index];
            if (event.type === "user.message" || event.type === "message.delta") {
              if (event.text.toLowerCase().includes(needle)) {
                hit = { threadId: event.threadId, text: event.text };
                break;
              }
            }
          }
          return hit ? { thread, text: hit.text } : null;
        } catch(error) {
          if(controller.signal.aborted)throw error;
          return null;
        }
      }));
      for (const result of found) {
        if (!result || matches.length >= limit) continue;
        seen.add(result.thread.id);
        matches.push({ threadId: result.thread.id, title: result.thread.title, snippet: threadSearchSnippet(result.text, needle), updatedAt: result.thread.updatedAt });
      }
    }
  }
  matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { matches: matches.slice(0, limit) };
  }catch(error){if(controller.signal.aborted){reply.hijack();return;}throw error;}
  finally{reply.raw.off('close',closed);}
});

app.get('/api/threads/:threadId/queue',async request=>{
  const {threadId}=request.params as {threadId:string};
  if(isCloudSnapshot(threadId))return {canSteer:false,messages:[],drafts:[]};
  const viaPublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  const history=await readCodexThreadEvents(threadId);
  const status=await currentThreadStatus(threadId,history);
  const lifecycle=latestMobileThreadLifecycle(history,store.eventsForThread(threadId));
  const canSteer=threadAgent(threadId)==='codex'&&status==='running'&&(sessions.canSteer(threadId)||(lifecycle?.type==='turn.started'&&!!lifecycle.turnId));
  return {canSteer,messages:followups.list(threadId).map(message=>({...message,canSteer:canSteer&&(!viaPublic||message.sourcePublic===true)})),drafts:followups.drafts(threadId).filter(message=>!viaPublic||message.sourcePublic===true)};
});
app.post('/api/threads/:threadId/queue',async request=>{
  const {threadId}=request.params as {threadId:string};
  const sourcePublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  if(sourcePublic&&!publicAgentAllowed(threadAgent(threadId)))throw new Error('此助手的公网访问已关闭');
  const body=z.object({id:z.string().min(1).max(160),text:z.string().max(200000),model:z.string().optional(),effort:z.string().optional(),mode:z.enum(["plan","default"]).optional(),fast:z.boolean().optional(),permission:z.enum(['ask','auto','full','custom']).optional(),images:z.array(z.object({id:z.string(),name:z.string()})).default([]),files:z.array(fileSchema).max(8).default([])}).parse(request.body);
  if(!body.text.trim()&&!body.images.length&&!body.files.length)throw new Error('请输入消息或添加附件');
  if(!(await listThreadsWithCodexHistory(store.threads)).some(t=>t.id===threadId))throw new Error('找不到此任务');
  return {message:followups.add({...body,threadId,sourcePublic,permission:body.permission})};
});
function assertPublicQueueEntry(request:{headers:Record<string,unknown>},threadId:string,id:string,allowMissing=false){
  if(request.headers['x-public-proxy-secret']!==publicProxySecret||publicProxySecret==null)return;
  if(!publicAgentAllowed(threadAgent(threadId)))throw new Error('此助手的公网访问已关闭');
  const entry=followups.entry(id,threadId);
  if(!entry&&allowMissing)return;
  if(!entry?.sourcePublic)throw new Error('公网只能处理本机排队的消息');
}
app.post('/api/threads/:threadId/queue/:id/restore',async request=>{
  const {threadId,id}=request.params as {threadId:string;id:string};
  assertPublicQueueEntry(request,threadId,id);
  return {message:followups.takeForEditing(id,threadId)};
});
app.post('/api/threads/:threadId/queue/:id/restore/complete',async request=>{
  const {threadId,id}=request.params as {threadId:string;id:string};
  assertPublicQueueEntry(request,threadId,id,true);
  followups.finishEditing(id,threadId);return {ok:true};
});
app.post('/api/threads/:threadId/queue/:id/move',async request=>{
  const {threadId,id}=request.params as {threadId:string;id:string};
  assertPublicQueueEntry(request,threadId,id);
  const {direction}=z.object({direction:z.enum(['up','down'])}).parse(request.body);
  followups.move(id,threadId,direction);return {ok:true};
});
app.patch('/api/threads/:threadId/queue/:id',async request=>{
  const {threadId,id}=request.params as {threadId:string;id:string};
  assertPublicQueueEntry(request,threadId,id);
  const body=z.object({text:z.string().min(1).max(200000)}).parse(request.body);
  return {message:followups.edit(id,threadId,body.text)};
});
app.delete('/api/threads/:threadId/queue/:id',async request=>{const {threadId,id}=request.params as {threadId:string;id:string};assertPublicQueueEntry(request,threadId,id);followups.cancel(id,threadId);return {ok:true};});
app.post('/api/threads/:threadId/queue/:id/:action',async request=>{
  const {threadId,id,action}=request.params as {threadId:string;id:string;action:string};
  const viaPublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  if(viaPublic&&!publicAgentAllowed(threadAgent(threadId)))throw new Error('此助手的公网访问已关闭');
  if(viaPublic&&!followups.list(threadId).some(entry=>entry.id===id&&entry.sourcePublic))throw new Error('公网只能处理本机排队的消息');
  if(action==='steer'){
    const history=await readCodexThreadEvents(threadId);
    if(await currentThreadStatus(threadId,history)!=='running')throw new Error('当前没有正在运行的任务，消息已保留，请重试发送');
    const lifecycle=latestMobileThreadLifecycle(history,store.eventsForThread(threadId));
    const desktopTurnId=lifecycle?.type==='turn.started'?lifecycle.turnId:undefined;
    await followups.steer(id,threadId,desktopTurnId);
  }
  else if(action==='retry')followups.retry(id,threadId);
  else throw new Error('未知队列操作');
  return {ok:true};
});

app.get("/api/threads/:threadId/events",{compress:historyCompression}, async (request,reply) => {
  const params = request.params as { threadId: string };
  const {count,turns,activityDetails}=z.object({count:z.coerce.number().int().min(20).max(20000).optional(),turns:z.coerce.number().int().min(1).max(2000).optional(),activityDetails:z.enum(['deferred']).optional()}).parse(request.query);
  if(isCloudSnapshot(params.threadId))return cloudSnapshots.read(params.threadId,count,turns);
  if(isCloudThread(params.threadId))return cloudThreads.read(params.threadId,turns??Math.max(10,Math.ceil((count??200)/20)));
  const controller=new AbortController();
  const closed=()=>{if(!reply.raw.writableEnded)controller.abort();};
  reply.raw.once('close',closed);
  if(reply.raw.destroyed||request.raw.aborted)controller.abort();
  try{
  const historicalEvents = turns===undefined?await readCodexThreadEvents(params.threadId,count,'interactive',controller.signal):await readCodexConversationEvents(params.threadId,turns,controller.signal);
  // History is already available locally. A backend status RPC can wait 60s;
  // reconcile it in the existing cache without holding the transcript response.
  const snapshotStatus=await sessions.currentThreadStatus(params.threadId,historicalEvents,false);
  const storedThread=store.threads.find(thread=>thread.id===params.threadId);
  const storedEvents = store.eventsForThread(params.threadId);
  const lifecycle=latestMobileThreadLifecycle(historicalEvents,storedEvents);
  const status=sidebarStatuses.read({id:params.threadId,status:snapshotStatus as ThreadRecord['status'],updatedAt:[storedThread?.updatedAt,lifecycle?.createdAt].filter(Boolean).sort().at(-1)||''},()=>currentThreadStatus(params.threadId,historicalEvents));
  const expiredApprovals=new Set(store.approvals.filter(a=>a.threadId===params.threadId&&a.status==='expired').map(a=>a.id));
  const nativeDeepSeek=params.threadId.startsWith('deepseek-')?await deepseekNativeSessions.read(params.threadId):null;
  const merged=confirmedToolChanges((nativeDeepSeek?mergeDeepSeekThreadEvents(historicalEvents,storedEvents,sessions.agents.owns(params.threadId)):mergeMobileThreadEvents(historicalEvents, storedEvents)).filter(isVisibleMobileThreadEvent).map(event=>event.type==='approval.resolved'&&event.decision==='decline'&&expiredApprovals.has(event.approvalId)?{...event,decision:'resolved' as const}:event));
  const external=/^(antigravity|claude|grok|deepseek|hermes|opencode)-/.test(params.threadId);
  const selected=turns!==undefined?selectConversationTurns(merged,turns):count===undefined&&!external?selectConversationWindow(merged):selectConversationPage(merged,count??200);
  const restoredAttachments=await recoverMobileUploadImages(await recoverMobileUploadFiles(selected.map(event=>event.type==='user.message'&&event.eventId?.startsWith('history:')?{
    ...event,attachments:event.attachments?.map((file,index)=>({
      ...file,url:/\.(png|jpe?g|webp|gif)$/i.test(file.path)
        ?`/api/threads/${encodeURIComponent(params.threadId)}/history-image?eventId=${encodeURIComponent(event.eventId!)}&index=${index}`
        :undefined,
    })),
  }:event)));
  return {
    status,
    settings:nativeDeepSeek&&!sessions.agents.owns(params.threadId)?{model:nativeDeepSeek.model,effort:nativeDeepSeek.effort||''}:external?sessions.agents.settings(params.threadId):desktopThreadSettings(params.threadId),
    hasMore:merged.length>selected.length,
    events: await enrichMessageSources(turns!==undefined?activityHistory.compact(restoredAttachments):activityDetails==='deferred'?restoredAttachments.map(deferLiveActivityDetails):restoredAttachments),
  };
  }catch(error){if(controller.signal.aborted){reply.hijack();return;}throw error;}
  finally{reply.raw.off('close',closed);}
});

app.get('/api/threads/:threadId/activity',{compress:historyCompression},async(request,reply)=>{
  const {threadId}=request.params as {threadId:string};
  const {eventIds,groupId}=z.object({eventIds:z.string().max(32000).optional(),groupId:z.string().max(4000).optional()}).parse(request.query);
  if(groupId){
    const events=activityHistory.group(threadId,groupId);
    return events?{events}:reply.code(404).send({error:'这组操作记录已更新，请重新加载后重试'});
  }
  if(!eventIds)return reply.code(400).send({error:'请选择需要读取的操作'});
  const ids=z.array(z.string().min(1).max(2000)).min(1).max(100).parse(JSON.parse(eventIds));
  const controller=new AbortController();
  const closed=()=>{if(!reply.raw.writableEnded)controller.abort();};
  reply.raw.once('close',closed);
  if(reply.raw.destroyed||request.raw.aborted)controller.abort();
  try{
    const stored=new Map(store.eventsForIds(threadId,ids).filter(event=>mobileDeferredActivityTypes.has(event.type)).map(event=>[event.eventId,event]));
    const missing=[...new Set(ids.filter(id=>!stored.has(id)))];
    const historical=await readCodexActivityEventsByIds(threadId,missing,controller.signal);
    const resolved=new Map(missing.map((id,index)=>[id,historical[index]]));
    const events=ids.map(id=>stored.get(id)??resolved.get(id)??null);
    if(events.some(event=>!event))return reply.code(404).send({error:'这条命令记录暂不可用，请重新加载后重试'});
    return {events};
  }finally{reply.raw.off('close',closed);}
});
app.get('/api/threads/:threadId/submission',async request=>{
  const {threadId}=request.params as {threadId:string};
  const {requestId}=z.object({requestId:z.string().min(1).max(200)}).parse(request.query);
  const submission=await submissions.persistentStatus(requestId,store.events,sessions.receipts,threadId==='_new'?undefined:threadId);
  return {submission,...(submission.state==='accepted'&&submission.threadId?{status:await currentThreadStatus(submission.threadId,await readCodexThreadEvents(submission.threadId))}:{})};
});

app.get('/api/threads/:threadId/output-file/:name',async(request,reply)=>{
  const viaPublic=publicProxySecret!=null&&request.headers['x-public-proxy-secret']===publicProxySecret;
  const {threadId,name}=request.params as {threadId:string;name:string};
  if(viaPublic&&!/\.(png|jpe?g|webp|gif)$/i.test(name))return reply.code(403).send({error:'公网会话输出只支持已授权项目中的图片'});
  if(threadId.startsWith('cloud-snapshot:')||isCloudThread(threadId))return reply.code(403).send({error:'云端会话不提供电脑文件访问'});
  const query=z.object({eventId:z.string().min(1),path:z.string().min(1).max(4096),source:z.string().min(1).max(4096).optional()}).parse(request.query);
  if(viaPublic&&query.source)return reply.code(403).send({error:'关联图片请通过已授权项目或内网读取'});
  const controller=new AbortController();
  const closed=()=>{if(!reply.raw.writableEnded)controller.abort();};
  reply.raw.once('close',closed);
  if(reply.raw.destroyed||request.raw.aborted)controller.abort();
  try{
  const stored=store.eventsForThread(threadId,2000);
  const event=storedOutputMessage(stored,query.eventId)||stored.find(item=>item.eventId===query.eventId)
    ||await readCodexOutputSourceEventById(threadId,query.eventId,controller.signal);
  const activityText=event?.type==='message.delta'?null:activityOutputImageText(
    event);
  const text=event?.type==='message.delta'?event.text:activityText;
  if(text==null)return reply.code(404).send({error:'找不到这条回复或图片操作记录'});
  if(activityText&&(!/\.(png|jpe?g|webp|gif)$/i.test(name)||query.source))return reply.code(403).send({error:'操作预览仅支持该记录中的图片'});
  const cwd=store.threads.find(thread=>thread.id===threadId)?.projectPath
    ||(await desktopSidebar()).threads.find(thread=>thread.id===threadId)?.cwd||'';
  if(viaPublic){
    try{
      const file=await resolvePublicOutputImage(text,query.path,cwd,(await listProjects(config)).map(project=>project.path));
      return reply.type(file.mime).header('X-Content-Type-Options','nosniff').header('Cache-Control','private, no-store').send(await fs.readFile(file.absolutePath,{signal:controller.signal}));
    }catch(error){return reply.code(403).send({error:error instanceof Error?error.message:'图片不可读取'});}
  }
  const file=query.source?await resolveMarkdownOutputImage(text,query.source,query.path,cwd):await resolveThreadOutputFile(text,query.path,cwd);
  return reply.type(contentTypeFor(file.fileName)).header('Cache-Control','private, no-store').send(await fs.readFile(file.absolutePath,{signal:controller.signal}));
  }finally{reply.raw.off('close',closed);}
});

app.get('/api/threads/:threadId/history-image',async(request,reply)=>{
  const {threadId}=request.params as {threadId:string};
  const {eventId,index}=z.object({eventId:z.string().min(1),index:z.coerce.number().int().min(0).max(20)}).parse(request.query);
  const controller=new AbortController();
  const closed=()=>{if(!reply.raw.writableEnded)controller.abort();};
  reply.raw.once('close',closed);
  if(reply.raw.destroyed||request.raw.aborted)controller.abort();
  try{
  const source=await readCodexHistoryImageSource(threadId,eventId,index,(await listProjects(config)).map(project=>project.path),controller.signal);
  if(!source)return reply.code(404).send({error:'not_found'});
  if(source.embedded)return reply.type(source.embedded.mime).header('Content-Length',String(source.embedded.bytes.length))
    .header('Cache-Control','private, max-age=300').send(source.embedded.bytes);
  const file=source.file!;
  return reply.type(contentTypeFor(file.absolutePath)).header('Content-Length',String(file.size))
    .header('Cache-Control','private, max-age=300')
    .send((await import('node:fs')).createReadStream(file.absolutePath));
  }finally{reply.raw.off('close',closed);}
});

app.post('/api/threads/:threadId/compact',async request=>{
  const {threadId}=request.params as {threadId:string};
  if(threadAgent(threadId)!=='codex')throw new Error('此助手暂不支持手动压缩');
  await assertProjectAccess(undefined,threadId);
  await sessions.resumeThread(threadId);
  await codex.request('thread/compact/start',{threadId});
  return {ok:true};
});

app.post("/api/threads/:threadId/resume", async (request) => {
  const params = request.params as { threadId: string };
  if(request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null&&!publicAgentAllowed(threadAgent(params.threadId)))throw new Error('此助手的公网访问已关闭');
  const body = resumeThreadSchema.parse(request.body ?? {});
  await validateAgentModel(body.model,params.threadId);
  body.projectPath = await assertProjectAccess(body.projectPath, params.threadId);
  await sessions.resumeThread(params.threadId, body);
  return { ok: true };
});

app.patch("/api/threads/:threadId", async (request) => {
  const params = request.params as { threadId: string };
  const body = updateThreadSchema.parse(request.body ?? {});
  if(threadAgent(params.threadId)==='codex')await codex.request('thread/name/set',{threadId:params.threadId,name:body.title});
  if (!store.threads.some(thread => thread.id === params.threadId)) {
    const historical = (await listThreadsWithCodexHistory([])).find(thread => thread.id === params.threadId);
    if (!historical || store.isThreadHidden(params.threadId)) throw new Error("会话不存在");
    await store.upsertThread(historical);
  }
  return { thread: await store.updateThread(params.threadId, body) };
});

app.post('/api/threads/:threadId/pin',async request=>{
  const {threadId}=request.params as {threadId:string};
  const {pinned}=z.object({pinned:z.boolean()}).parse(request.body);
  if(threadAgent(threadId)!=='codex'){
    await managedThread(threadId);store.setThreadPinned(threadId,pinned);
    hub.publish({type:'thread.read-state.changed'},false);
    return {ok:true,pinned};
  }
  await codex.request('thread/section/move',{threadId,sectionId:pinned?PINNED_SECTION_ID:null});
  return {ok:true,pinned};
});

app.patch('/api/threads/:threadId/goal',async request=>{
  const {threadId}=request.params as {threadId:string};
  if(threadAgent(threadId)!=='codex')throw new Error('此助手暂不支持目标控制');
  const body=z.object({objective:z.string().trim().min(1).max(200000).optional(),status:z.enum(['active','paused','complete']).optional()}).refine(value=>value.objective!==undefined||value.status!==undefined).parse(request.body);
  await sessions.cancelCapacityWork(threadId);
  const result=await codex.request('thread/goal/set',{threadId,...body}) as {goal:unknown};
  return {goal:result.goal};
});

const automationEdit=z.object({name:z.string().trim().min(1).max(200).optional(),prompt:z.string().trim().min(1).max(200000).optional(),
  status:z.enum(['ACTIVE','PAUSED']).optional(),threadId:z.string().min(1).max(160).optional(),
  schedule:z.object({frequency:z.enum(['MINUTELY','HOURLY','DAILY','WEEKLY']),interval:z.number().int().min(1).max(10080)}).strict().optional()}).strict();
app.get('/api/automations',async()=>({automations:await listAutomations()}));
app.get('/api/automations/targets',async request=>{
  const query=z.object({q:z.string().trim().max(200).default(''),limit:z.coerce.number().int().min(1).max(500).default(60)}).parse(request.query);
  return listAutomationTargets(query.q,query.limit);
});
app.post('/api/automations',async request=>{
  const body=automationEdit.parse(request.body);if(body.threadId){assertControllableThread(body.threadId);if(threadAgent(body.threadId)!=='codex')throw Error('请选择 Codex 会话');}
  return {automation:await saveAutomation(undefined,body)};
});
app.patch('/api/automations/:id',async request=>{
  const body=automationEdit.parse(request.body);if(body.threadId){assertControllableThread(body.threadId);if(threadAgent(body.threadId)!=='codex')throw Error('请选择 Codex 会话');}
  return {automation:await saveAutomation((request.params as {id:string}).id,body)};
});

app.post('/api/threads/:threadId/goal/continue',async(request,reply)=>{
  const {threadId}=request.params as {threadId:string};
  assertControllableThread(threadId);
  if(threadAgent(threadId)!=='codex')throw new Error('此助手暂不支持目标控制');
  const body=z.object({...projectFields,requestId:z.string().min(1).max(160)}).strict().parse(request.body);
  await validateAgentModel(body.model,threadId);
  body.projectPath=await assertProjectAccess(body.projectPath,threadId);
  const viaPublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  await sessions.handleClientCommand({type:'turn.start',threadId,...body,text:'',continueGoal:true},viaPublic);
  return reply.code(202).send({request:await sessions.receipts.get(body.requestId),goal:readCodexGoals().get(threadId)});
});

async function managedThread(threadId:string):Promise<ThreadRecord>{
  assertControllableThread(threadId);
  const threads=store.threads;
  const thread=(await listThreadsWithCodexHistory(threads,false,threads.filter(row=>sessions.ownsThread(row.id)).map(row=>row.id))).find(row=>row.id===threadId);
  if(!thread||thread.readOnly||thread.source==='cloudCodex')throw new Error('本地会话不存在或不支持此操作');
  return thread;
}
app.get('/api/thread-sections',async()=>({sections:desktopThreadSections()}));
app.post('/api/threads/:threadId/move',async request=>{
  const {threadId}=z.object({threadId:z.string().min(1)}).parse(request.params);
  await managedThread(threadId);
  if(threadAgent(threadId)!=='codex')throw new Error('此助手暂不支持移动项目或分区');
  const body=z.union([z.object({projectPath:z.string().min(1)}).strict(),z.object({sectionId:z.string().min(1).nullable()}).strict()]).parse(request.body);
  if('projectPath' in body){
    const cwd=await assertProjectAccess(body.projectPath);
    await codex.request('thread/settings/update',{threadId,cwd});
    await store.upsertThread({id:threadId,projectPath:cwd});
  }else{
    if(body.sectionId!==null&&!desktopThreadSections().some(section=>section.id===body.sectionId))throw new Error('分区不存在，请刷新后重试');
    await codex.request('thread/section/move',{threadId,sectionId:body.sectionId});
  }
  return {ok:true};
});
app.post('/api/threads/:threadId/unread',async request=>{
  const {threadId}=z.object({threadId:z.string().min(1)}).parse(request.params);
  const thread=await managedThread(threadId);
  const completedAt=await readCodexThreadCompletion(threadId).catch(()=>0)||Date.parse(thread.updatedAt)||Date.now();
  store.markThreadUnread(threadId,completedAt);
  hub.publish({type:'thread.read-state.changed'},false);
  return {ok:true,unread:true,completedAt};
});
app.get('/api/threads/archived',async request=>{
  const {agent}=z.object({agent:z.string().optional()}).parse(request.query);
  const threads=[...new Map([...store.archivedThreads(),...desktopArchivedThreads()].map(thread=>[thread.id,thread])).values()];
  return {threads:threads.filter(thread=>!agent||threadAgent(thread.id)===agent).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};
});
app.post('/api/threads/:threadId/unarchive',async request=>{
  const {threadId}=z.object({threadId:z.string().min(1)}).parse(request.params);
  assertControllableThread(threadId);
  const thread=desktopArchivedThreads().find(row=>row.id===threadId)??store.archivedThreads().find(row=>row.id===threadId);
  if(!thread)throw new Error('归档会话不存在');
  if(threadAgent(threadId)==='codex'&&thread.closureKind!=='gatewayClosed')await codex.request('thread/unarchive',{threadId});
  store.restoreThread(threadId);
  return {ok:true,threadId,archived:false};
});
async function subagentClosePreview(threadId:string){
  const thread=await managedThread(threadId);
  if(threadAgent(threadId)!=='codex'||!thread.subagent?.parentThreadId)throw Error('只能关闭有明确父会话的本地子代理');
  const result=await codex.request('thread/read',{threadId,includeTurns:false}) as {thread?:{status?:string|{type?:string}}};
  const status=typeof result.thread?.status==='string'?result.thread.status:result.thread?.status?.type||'unknown';
  const running=status==='active'||sessions.ownsThread(threadId)||readCodexGoals().get(threadId)?.status==='active';
  return {thread,threadId,status,running,canArchive:!running&&['idle','notLoaded'].includes(status),subagent:thread.subagent};
}
const closingSubagents=new Set<string>();
app.get('/api/threads/:threadId/close-preview',async request=>{
  const {threadId}=z.object({threadId:z.string().uuid()}).parse(request.params);
  const {thread,...preview}=await subagentClosePreview(threadId);return preview;
});
app.post('/api/threads/:threadId/close',async(request,reply)=>{
  const {threadId}=z.object({threadId:z.string().uuid()}).parse(request.params);
  const {stopRunning,parentThreadId}=z.object({stopRunning:z.boolean(),parentThreadId:z.string().uuid()}).strict().parse(request.body);
  if(closingSubagents.has(threadId))return reply.code(409).send({error:'子代理正在关闭，请稍后刷新'});
  closingSubagents.add(threadId);
  try{
    const saved=store.archivedThreads().find(row=>row.id===threadId);
    if(saved?.subagent?.parentThreadId===parentThreadId)
      return {ok:true,threadId,closed:true,archived:saved.closureKind!=='gatewayClosed',...(saved.closureKind?{closureKind:saved.closureKind}:{})};
    let preview=await subagentClosePreview(threadId);
    if(preview.subagent.parentThreadId!==parentThreadId||parentThreadId===threadId)return reply.code(409).send({error:'子代理所属会话已改变，请刷新后重试'});
    if(preview.running){
      if(!stopRunning)return reply.code(409).send({error:'子代理仍在运行，请确认停止该子代理后再关闭'});
      await interruptCodexThread(threadId);
      for(let attempt=0;attempt<10;attempt++){
        preview=await subagentClosePreview(threadId);
        if(preview.canArchive)break;
        await new Promise(resolve=>setTimeout(resolve,200));
      }
    }
    if(!preview.canArchive)return reply.code(409).send({error:'尚未确认子代理停止，未归档，请稍后刷新'});
    const result=await archiveOrCloseSubagent(preview.thread,{
      request:(method,params)=>codex.request(method,params),
      list:()=>listThreadsWithCodexHistory(store.threads),
      inspect:subagentClosePreview,
      saveClosed:threads=>store.closeSubagents(threads),
    });
    if(result.archived)store.archiveThread(threadId,preview.thread);
    return {ok:true,threadId,...result};
  }finally{closingSubagents.delete(threadId);}
});
app.post('/api/threads/:threadId/archive',async(request,reply)=>{
  const {threadId}=z.object({threadId:z.string().min(1).max(256)}).parse(request.params);
  assertControllableThread(threadId);
  if(store.archivedThreads().some(thread=>thread.id===threadId&&thread.closureKind!=='gatewayClosed'))return {ok:true,threadId,archived:true};
  const thread=await managedThread(threadId);
  let status:string|undefined=thread.status==='running'?'active':'idle';
  if(threadAgent(threadId)==='codex'){
    const result=await codex.request('thread/read',{threadId,includeTurns:false}) as {thread?:{status?:string|{type?:string}}};
    status=typeof result.thread?.status==='string'?result.thread.status:result.thread?.status?.type;
  }
  if(sessions.ownsThread(threadId)||status==='active'||readCodexGoals().get(threadId)?.status==='active')
    return reply.code(409).send({error:thread.subagent?'子代理仍在运行，请先停止该子代理再关闭':'会话仍在运行，请先停止再归档'});
  if(status!=='idle'&&status!=='notLoaded')return reply.code(409).send({error:'暂时无法确认会话状态，请刷新后重试'});
  if(threadAgent(threadId)==='codex')await codex.request('thread/archive',{threadId});
  store.archiveThread(threadId,thread);
  return {ok:true,threadId,archived:true};
});

app.delete("/api/threads/:threadId", async (request) => {
  const params = request.params as { threadId: string };
  if(threadAgent(params.threadId)==='antigravity')await sessions.agents.forget(params.threadId);
  await store.deleteThread(params.threadId);
  return { ok: true };
});

app.get("/api/approvals", async request => {
  await sessions.reconcileApprovalMirrors();
  const threadId=z.object({threadId:z.string().optional()}).parse(request.query).threadId;
  if(threadId&&isCloudSnapshot(threadId))return {approvals:[]};
  const desktop=threadId?pendingDesktopQuestions(threadId,await readCodexThreadEvents(threadId),store.eventsForThread(threadId),store.approvals.filter(item=>item.status!=='pending'&&(!item.id.startsWith('desktop-question:')||item.method==='desktop/questionReply')).map(item=>item.id)):[];
  const pendingIds=new Set(desktop.map(item=>item.id));
  return {approvals:[...store.approvals.filter(item=>!pendingIds.has(item.id)),...desktop]};
});

app.post('/api/approvals/:approvalId/answer',async(request)=>{
  const {approvalId}=request.params as {approvalId:string};
  const approval=store.approvals.find(item=>item.id===approvalId);
  if(request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null&&approval&&threadAgent(approval.threadId)!=='codex')throw new Error('公网仅支持 Codex 审批');
  const body=z.object({threadId:z.string().optional(),answers:z.record(z.string(),z.object({answers:z.array(z.string().max(20000)).length(1)}))}).parse(request.body);
  if(approvalId.startsWith('desktop-question:')){
    const threadId=body.threadId;
    if(!threadId||threadAgent(threadId)!=='codex')throw new Error('无效的 Codex 会话');
    const events=await readCodexThreadEvents(threadId);
    const pending=pendingDesktopQuestions(threadId,events,store.eventsForThread(threadId),store.approvals.filter(item=>item.status!=='pending'&&(!item.id.startsWith('desktop-question:')||item.method==='desktop/questionReply')).map(item=>item.id)).find(item=>item.id===approvalId);
    if(!pending)throw new Error('问题已处理或不再可用，请刷新会话');
    const questions=JSON.parse(pending.detail||'{}').questions as {id:string;question:string}[];
    if(Object.keys(body.answers).length!==questions.length||questions.some(item=>!body.answers[item.id]?.answers[0]?.trim()))throw new Error('请回答所有问题');
    const text=formatDesktopQuestionReply(approvalId,pending.detail||'{}',body.answers);

    const lifecycle=events.filter(event=>event.type==='turn.started'||event.type==='turn.completed').at(-1);
    if(await currentThreadStatus(threadId,events)==='running'&&lifecycle?.type==='turn.started'&&lifecycle.turnId){
      await codex.request('turn/steer',{threadId,expectedTurnId:lifecycle.turnId,input:[{type:'text',text,text_elements:[]}]});
    }else{
      const cwd=await assertProjectAccess(undefined,threadId);
      await codex.request('turn/start',{threadId,cwd,input:[{type:'text',text,text_elements:[]}],approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'workspaceWrite'}});
    }
    await store.addApproval({...pending,method:'desktop/questionReply'});
    await store.resolveApproval(approvalId,'accept');
    hub.publish({type:'approval.resolved',threadId,approvalId,decision:'accept'});
    return {ok:true};
  }
  await sessions.answerQuestions(approvalId,body.answers);return {ok:true};
});

app.post("/api/approvals/:approvalId/resolve", async (request) => {
  const params = request.params as { approvalId: string };
  const approval=store.approvals.find(item=>item.id===params.approvalId);
  if(request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null&&approval&&threadAgent(approval.threadId)!=='codex')throw new Error('公网仅支持 Codex 审批');
  const body = resolveApprovalSchema.parse(request.body);
  await sessions.resolveApproval(params.approvalId, body.decision);
  return { ok: true };
});

app.post("/api/projects", async (request) => {
  const body = addProjectSchema.parse(request.body);
  const project = await addProject(config, body.path,body.create);
  hub.publish({ type: "project.changed", project });
  hub.publish({ type: "projects.changed" });
  return { project };
});

app.get("/api/projects/:projectId/files", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.parse(request.query);
  return { files: await listDirectory(config, params.projectId, query.path ?? "") };
});

app.get("/api/projects/:projectId/file", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await readTextFile(config, params.projectId, query.path);
});

app.put("/api/projects/:projectId/file", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  const body = writeFileSchema.parse(request.body);
  return await writeTextFile(config, params.projectId, query.path, body.content);
});

app.get("/api/projects/:projectId/diff", async (request) => {
  const params = request.params as { projectId: string };
  return await readProjectDiff(config, params.projectId);
});

app.get("/api/projects/:projectId/diff/files", async (request) => {
  const params = request.params as { projectId: string };
  return await listProjectDiffFiles(config, params.projectId);
});

app.get("/api/projects/:projectId/diff/file", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await readFileDiff(config, params.projectId, query.path);
});

app.get("/api/projects/:projectId/diff/file/hunks", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await readFileDiffHunks(config, params.projectId, query.path);
});

app.post("/api/projects/:projectId/diff/file/accept", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await acceptFileDiff(config, params.projectId, query.path);
});

app.post("/api/projects/:projectId/diff/file/revert", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await revertFileDiff(config, params.projectId, query.path);
});

app.post("/api/projects/:projectId/diff/file/hunk/accept", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  const body = diffHunkSchema.parse(request.body);
  return await acceptFileDiffHunk(config, params.projectId, query.path, body.source, body.index);
});

app.post("/api/projects/:projectId/diff/file/hunk/revert", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  const body = diffHunkSchema.parse(request.body);
  return await revertFileDiffHunk(config, params.projectId, query.path, body.source, body.index);
});

app.post("/api/projects/:projectId/diff/files/accept", async (request) => {
  const params = request.params as { projectId: string };
  const body = diffBatchSchema.parse(request.body);
  return await acceptFileDiffs(config, params.projectId, body.paths);
});

app.post("/api/projects/:projectId/diff/files/revert", async (request) => {
  const params = request.params as { projectId: string };
  const body = diffBatchSchema.parse(request.body);
  return await revertFileDiffs(config, params.projectId, body.paths);
});

app.post("/api/projects/:projectId/terminal/run", async (request) => {
  const params = request.params as { projectId: string };
  const body = runCommandSchema.parse(request.body);
  return await localTerminal.runCommand(params.projectId, body.command);
});

app.post("/api/projects/:projectId/terminal/session", async (request) => {
  const params = request.params as { projectId: string };
  const body = terminalSessionSchema.parse(request.body ?? {});
  return await localTerminal.startInteractiveSession(params.projectId, body);
});

app.get("/api/terminal/history", async (request) => {
  const query = terminalHistoryQuerySchema.parse(request.query);
  return { events: store.terminalEvents(query.limit) };
});

app.get("/api/terminal/commands", async (request) => {
  const query = terminalCommandsQuerySchema.parse(request.query);
  return {
    commands: store.terminalCommands(query.limit, {
      includeOutput: query.includeOutput === undefined ? true : query.includeOutput === "true",
      previewChars: query.previewChars,
    }),
  };
});

app.get("/api/terminal/commands/:commandId/output", async (request) => {
  const params = request.params as { commandId: string };
  const query = terminalOutputQuerySchema.parse(request.query);
  return {
    output: store.terminalCommandOutput(params.commandId, query),
  };
});

app.post("/api/terminal/:commandId/stop", async (request) => {
  const params = request.params as { commandId: string };
  return localTerminal.stopCommand(params.commandId);
});

app.post("/api/terminal/sessions/:sessionId/input", async (request) => {
  const params = request.params as { sessionId: string };
  const body = terminalInputSchema.parse(request.body);
  return localTerminal.writeInteractiveSession(params.sessionId, body.text, body.appendNewline !== false);
});

app.post("/api/terminal/sessions/:sessionId/resize", async (request) => {
  const params = request.params as { sessionId: string };
  const body = terminalResizeSchema.parse(request.body);
  return localTerminal.resizeInteractiveSession(params.sessionId, body);
});

app.post("/api/terminal/sessions/:sessionId/stop", async (request) => {
  const params = request.params as { sessionId: string };
  return localTerminal.stopInteractiveSession(params.sessionId);
});

app.get("/raw/projects/:projectId/file", async (request, reply) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  const file = await resolveRawFile(config, params.projectId, query.path);
  return reply.type(contentTypeFor(file.fileName)).send(await fs.readFile(file.absolutePath));
});

app.get("/preview/proxy", async (request, reply) => {
  const query = proxyQuerySchema.parse(request.query);
  const target = new URL(query.url);
  if (!["127.0.0.1", "localhost"].includes(target.hostname)) {
    return reply.code(400).send({ error: "只允许代理电脑本机 localhost 预览服务" });
  }
  const response = await fetch(target);
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  reply.code(response.status).type(contentType);
  return reply.send(Buffer.from(await response.arrayBuffer()));
});

app.get("/api/settings/user", async () => ({
  settings: await readUserSettings(),
}));
app.get('/api/settings/public-access',async()=>({publicAccess:await readPublicAccessSettings()}));
app.put('/api/settings/public-access/config',async(request,reply)=>{
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip)||request.headers['x-public-proxy-secret'])return reply.code(403).send({error:'请在本机控制台设置连接地址'});
  const body=z.object({password:z.string().min(6).max(128).optional(),publicUrl:z.string().max(2048).optional()}).strict().parse(request.body);
  return {publicAccess:await updatePublicAccessSettings(body)};
});
app.put('/api/settings/public-access/password',async request=>{
  const {password}=z.object({password:z.string().min(6).max(128)}).parse(request.body);
  if(password.trim()!==password)throw new Error('密码首尾不能有空格');
  return {publicAccess:await updatePublicAccessPassword(password)};
});
const usageReader=new UsageReader(codex,threadId=>hub.publish({type:'usage.updated',threadId}));
app.get('/api/usage',async request=>{
  const query=z.object({threadId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),agent:z.enum(['codex','claude','antigravity','grok','deepseek','hermes','opencode']).optional(),model:z.string().max(200).optional(),days:z.coerce.number().int().min(1).max(90).optional()}).parse(request.query);
  const agent=query.threadId?threadAgent(query.threadId):query.agent||'codex';
  return agent!=='codex'?sessions.agents.usage(query.threadId||'',agent,query.model):usageReader.read(query.threadId,query.days);
});
app.get('/api/models',async request=>{
  const refresh=(request.query as any).refresh==='1';
  if((request.query as any).agents!=='all')return readModelCatalog(codex,refresh);
  const [codexModels,otherModels]=await Promise.allSettled([readModelCatalog(codex,refresh),sessions.agents.models(refresh)]);
  const viaPublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  const backends=await sessions.agents.backends(viaPublic);
  const models=[...(codexModels.status==='fulfilled'?codexModels.value.models:[]),...(otherModels.status==='fulfilled'?otherModels.value:[])];
  return {models:models.map(model=>{const agent=modelAgent(model.model),backend=backends.find(b=>b.agent===agent);if(viaPublic&&!publicAgentAllowed(agent))return {...model,available:false,unavailableReason:'此助手的公网访问已关闭'};return backend?{...model,available:backend.available,unavailableReason:backend.reason}:model;}),backends,source:'local-agents'};
});
const agentHealthMonitor=new AgentHealthMonitor();
app.get('/api/agents/updates',async request=>agentHealthMonitor.checkUpdates((request.query as any).refresh==='1'));
app.get('/api/agents/health',async request=>{
  const refresh=(request.query as any).refresh==='1';
  const viaPublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  const checks=Promise.allSettled([codex.status(),sessions.agents.health(refresh,viaPublic)]);
  const health=await agentHealthMonitor.enrich(checks.then(([status,agents])=>{
    const runtime=status.status==='fulfilled'?status.value:null;
    return [{agent:'codex',name:'Codex',publicAllowed:publicAgentAllowed('codex'),available:runtime?.initialized===true,installed:runtime?.cliAvailable===true||runtime?.running===true,state:runtime?.initialized?'ready':runtime?.running?'connecting':'unavailable',version:runtime?.cliVersion||'',reason:runtime?.lastError||(status.status==='rejected'?'Codex 状态读取失败':''),pendingRequests:runtime?.pendingRequests||0,supportsRestart:true,checkedAt:new Date().toISOString()},...(agents.status==='fulfilled'?agents.value:[])];
  }));
  const [,agents]=await checks;
  return {checkedAt:new Date().toISOString(),...health,error:agents.status==='rejected'?'助手状态读取失败，请重新检查':''};
});

app.get("/api/settings/approval-summary", async () => ({
  summary: await readApprovalPolicySummary(),
}));

app.get('/api/settings/remote-approval',async()=>({desktopAutoApprove:await readRemoteAutoApproval(),...codex.desktopApprovalStatus()}));
const harnessAccess=()=>({agents:Object.entries(agentNames).map(([agent,name])=>({agent,name,enabled:publicAgentAllowed(agent as keyof typeof agentNames)}))});
let harnessAccessWrite=Promise.resolve();
app.get('/api/settings/harness-access',async()=>harnessAccess());
app.put('/api/settings/harness-access',async request=>{
  const agents=z.object({codex:z.boolean().optional(),claude:z.boolean().optional(),antigravity:z.boolean().optional(),grok:z.boolean().optional(),deepseek:z.boolean().optional(),hermes:z.boolean().optional(),opencode:z.boolean().optional()}).strict().parse(z.object({agents:z.unknown()}).strict().parse(request.body).agents);
  const operation=harnessAccessWrite.then(async()=>{
    const publicAgents={...config.publicAgents,...agents};
    await saveServerConfig({...config,publicAgents});
    config.publicAgents=publicAgents;configurePublicAgentAccess(publicAgents);
    return harnessAccess();
  });
  harnessAccessWrite=operation.then(()=>{},()=>{});
  return operation;
});
app.get('/api/settings/capacity-retry',async()=>({enabled:config.capacityAutoRetry===true,maxAttempts:null,...sessions.capacityRetryStatus()}));
app.put('/api/settings/capacity-retry',async request=>{
  const {enabled}=z.object({enabled:z.boolean()}).parse(request.body);
  await saveServerConfig({...config,capacityAutoRetry:enabled});
  config.capacityAutoRetry=enabled;sessions.setCapacityAutoRetry(enabled);
  return {enabled,maxAttempts:null};
});
app.put('/api/settings/remote-approval',async request=>{
  const {desktopAutoApprove}=z.object({desktopAutoApprove:z.boolean()}).parse(request.body);
  await writeRemoteAutoApproval(desktopAutoApprove);
  return {desktopAutoApprove,...(desktopAutoApprove?await sessions.approvePendingAutomatically():{accepted:0,failed:0}),...codex.desktopApprovalStatus()};
});

app.put("/api/settings/user", async (request) => {
  const body = settingsSchema.parse(request.body);
  await assertAvailableModel(codex,body.model);
  return { settings: await writeUserSettings(body) };
});

app.get("/api/settings/user/raw", async () => ({
  config: await readUserSettingsRaw(),
}));

app.put("/api/settings/user/raw", async (request) => {
  const body = rawSettingsSchema.parse(request.body);
  return { config: await writeUserSettingsRaw(body.content) };
});

app.get("/api/codex/status", async () => ({
  codex: await codex.status(),
}));

app.get("/api/codex/compatibility", async () => ({
  compatibility: await codexCompatibilityReport(),
}));

app.get("/api/codex/upgrade-check", async () => {
  const status = await codex.status();
  return { upgrade: await checkCodexUpgrade(status.cliVersion) };
});

app.post("/api/codex/start", async () => {
  await codex.startFromUser();
  const status = await codex.status();
  hub.publish({ type: "codex.status", status: "running", detail: status.cliVersion ?? undefined });
  return { ok: true, codex: status };
});

app.post("/api/codex/restart", async () => {
  await codex.restart();
  const status = await codex.status();
  hub.publish({ type: "codex.status", status: "running", detail: status.cliVersion ?? undefined });
  return { ok: true, codex: status };
});

const address = await app.listen({ host: config.host, port: config.port });
if(codex.desktopApprovalStatus().bridgeConfigured)void codex.start().catch(error=>app.log.error(error,'Shared backend startup failed'));
setTimeout(()=>void usageReader.sampleQuota().catch(()=>{}),30000).unref();
setInterval(()=>void usageReader.sampleQuota().catch(()=>{}),300000).unref();
const wss = new WebSocketServer({ noServer: true });
app.server.on("upgrade", (request, socket, head) => {
  if (handlePreviewUpgrade(request, socket, head)) return;
  if (new URL(request.url ?? "/", "http://gateway").pathname !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, client => wss.emit("connection", client, request));
});

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const token = url.searchParams.get("token");
  if (!token || (token !== config.token && !store.isValidDeviceToken(token))) {
    socket.close(1008, "unauthorized");
    return;
  }
  const proxyHeader=request.headers['x-public-proxy-secret'];
  const viaPublic=typeof proxyHeader==='string'&&publicProxySecret!=null&&proxyHeader===publicProxySecret;
  const certificate=token===config.token?undefined:store.certificateForToken(token);
  if((proxyHeader&&!viaPublic)||(viaPublic&&!certificate)||(certificate&&!verifyDeviceProof(certificate,'GET',request.url??'/ws',request.headers))){socket.close(1008,'device_certificate_required');return;}

  if (token !== config.token) {
    void store.touchDeviceToken(token, {
      name: url.searchParams.get("device") ?? undefined,
      userAgent: request.headers["user-agent"],
    });
  } else {
    void store.rememberDevice({
      name: url.searchParams.get("device") ?? undefined,
      userAgent: request.headers["user-agent"],
    });
  }

  const authorized = () => token === config.token || store.isValidDeviceToken(token);
  const streamThread=url.searchParams.get('streamThread');
  if(streamThread!==null&&streamThread.length>512){socket.close(1008,'invalid_stream_thread');return;}
  hub.add(socket, authorized,url.searchParams.get('activityDetails')==='deferred',streamThread??undefined,viaPublic?'public':'local');
  socket.on("message", (raw) => {
    if (!authorized()) { socket.close(1008, "unauthorized"); return; }
    let submissionId:string|undefined;
    void (async () => {
      const identity=JSON.parse(raw.toString()) as ClientCommand|{type:'connection.ping';requestId?:unknown}|{type:'thread.focus';threadId?:unknown;requestId?:unknown};
      if(identity.type==='connection.ping'){
        if(typeof identity.requestId!=='string'||!identity.requestId||identity.requestId.length>128)throw new Error('Invalid connection probe');
        socket.send(JSON.stringify({type:'connection.pong',requestId:identity.requestId}));
        return;
      }
      if(identity.type==='thread.focus'){
        if(typeof identity.threadId!=='string'||identity.threadId.length>512||typeof identity.requestId!=='string'||!identity.requestId||identity.requestId.length>128)throw new Error('Invalid thread subscription');
        hub.focusStream(socket,identity.threadId,identity.requestId);
        return;
      }
      const message = clientCommandSchema.parse(identity);
      if('threadId' in message)assertControllableThread(message.threadId||'');
      if(viaPublic&&(message.type==='debug.echo'||(message.type==='thread.start'&&!publicAgentAllowed(modelAgent(message.model)))||((message.type==='turn.start'||message.type==='thread.resume')&&!publicAgentAllowed(threadAgent(message.threadId)))))throw new Error('此助手的公网访问已关闭');
      if((message.type==='thread.start'||message.type==='turn.start')&&message.requestId&&(message.type==='thread.start'?modelAgent(message.model):threadAgent(message.threadId))!=='codex'){
        const threadId='threadId' in message?message.threadId:undefined;
        const receipt=submissions.status(message.requestId,store.events,threadId);
        const begin=submissions.begin(message.requestId,message,threadId);
        if(receipt.state==='accepted'||!begin){
          if(receipt.state==='accepted'&&begin)submissions.finish(message.requestId,{state:'accepted',threadId:receipt.threadId});
          const current=submissions.status(message.requestId,store.events,threadId);
          socket.send(JSON.stringify({type:current.state==='accepted'?'message.confirmed':current.state==='failed'?'error':'message.received',requestId:message.requestId,threadId:current.threadId,message:current.error}));
          return;
        }
        submissionId=message.requestId;
      }

      if (message.type === "thread.start" || message.type === "thread.resume" || message.type === "turn.start") {
        await validateAgentModel(message.model,'threadId' in message?message.threadId:undefined);
        if (message.type !== 'thread.start' || message.projectPath) {
          message.projectPath = await assertProjectAccess(message.projectPath, "threadId" in message ? message.threadId : undefined);
        }
      }
      if(message.type==='turn.interrupt'&&threadAgent(message.threadId)==='codex'){
        const completed=await interruptCodexThread(message.threadId,message.requestId);
        if(completed){
          socket.send(JSON.stringify(completed));
          return;
        }
      }else await sessions.handleClientCommand(message,viaPublic,false,identity);
      if(submissionId){const receipt=submissions.status(submissionId,store.events);submissions.finish(submissionId,{state:'accepted',threadId:receipt.threadId??('threadId' in message?message.threadId:undefined)});}
    })().catch(async(error) => {
      const message = (() => {
        try {
          return JSON.parse(raw.toString()) as { type?:string; replaceTurnId?:string;threadId?: string; requestId?: string; text?:string; images?:{id:string;name:string}[]; files?:FileAttachment[]; model?:string; effort?:string; mode?:"plan"|"default"; fast?:boolean; permission?:'ask'|'auto'|'full'|'custom' };
        } catch {
          return {};
        }
      })();
      if(message.type==='turn.start'&&!message.replaceTurnId&&message.threadId&&isWriterOccupied(error)){
        try {
          const queued=followups.add({id:message.requestId||randomUUID(),threadId:message.threadId,text:message.text||'',images:message.images||[],files:message.files||[],model:message.model,effort:message.effort,mode:message.mode,fast:message.fast,permission:message.permission,sourcePublic:viaPublic,resume:true,error:userFacingError(error)});
          if(message.requestId)await sessions.receipts.markQueued(message.requestId,message.threadId);
          if(submissionId)submissions.finish(submissionId,{state:'accepted',threadId:message.threadId});
          socket.send(JSON.stringify({type:'message.queued',threadId:message.threadId,requestId:message.requestId,queueId:queued.id,message:queued.error}));
          return;
        }catch(queueError){error=queueError;}
      }
      if(submissionId)submissions.finish(submissionId,{state:'failed',threadId:message.threadId,error:userFacingError(error)});
      socket.send(JSON.stringify({
        type: "error",
        threadId: message.threadId,
        requestId: message.requestId,
        message: userFacingError(error),
      }));
    });
  });
});

app.log.info(`Gateway listening at ${address}`);
app.log.info(`Config: ${serverConfigPath()}`);
app.log.info(`State: ${stateStorePath()}`);
app.log.info("Access token is stored in server.json");

async function assertProjectAccess(projectPath?: string, threadId?: string): Promise<string> {
  const requested = projectPath || store.threads.find(thread => thread.id === threadId)?.projectPath;
  const normalize = (value: string) => process.platform === "win32" ? canonicalProjectPath(value).toLowerCase() : canonicalProjectPath(value);
  if (requested && (await listProjects(config)).some(project => normalize(project.path) === normalize(requested))) return canonicalProjectPath(requested);
  // Only the directory recorded by the desktop for this exact task is auto-added.
  if (threadId) {
    const desktopThread = (await listThreadsWithCodexHistory([], true)).find(thread => thread.id === threadId);
    if (desktopThread?.projectPath && (!requested || normalize(desktopThread.projectPath) === normalize(requested))) {
      const directory = canonicalProjectPath(desktopThread.projectPath);
      const stat = await fs.stat(directory).catch(() => null);
      if (!stat?.isDirectory()) throw new Error('该任务的原目录已不存在或电脑当前无法访问');
      await addProject(config, directory);
      hub.publish({type:'projects.changed'});
      return directory;
    }
  }
  throw new Error("该目录不在已连接项目或此桌面任务的原目录中");
}

function contentTypeFor(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "text/plain; charset=utf-8";
}

function publicBaseUrl(): string {
  const preferred=pairAddresses(config.host,config.port,Boolean(config.https?.enabled))[0];
  if(preferred) return preferred.url;
  const scheme = config.https?.enabled ? "https" : "http";
  if (config.host !== "0.0.0.0") {
    return `${scheme}://${config.host}:${config.port}`;
  }
  const address = Object.values(os.networkInterfaces()).flat().find((item) => item && !item.internal && item.family === "IPv4" && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address));
  return `${scheme}://${address?.address ?? "127.0.0.1"}:${config.port}`;
}

function isVisibleMobileThreadEvent(event: GatewayEvent): boolean {
  if(event.type==='context.compaction')return true;
  const text = "text" in event ? event.text ?? "" : "";
  const detail = "detail" in event ? event.detail ?? "" : "";
  return !text.includes("codex_internal_context") && !detail.includes("codex_internal_context");
}

async function codexCompatibilityReport() {
  const status = await codex.status();
  const sessionStats = sessions.compatibilityStats();
  const transportStats = codex.compatibilityStats();
  const recommendations: string[] = [];

  let compatibilityStatus: "ok" | "warning" | "error" = "ok";
  if (!status.cliAvailable) {
    compatibilityStatus = "error";
    recommendations.push("电脑端未找到 codex CLI，请先安装或把 codex 加入 PATH。");
  }
  if (status.cliAvailable && !status.running) {
    compatibilityStatus = maxCompatibilityStatus(compatibilityStatus, "warning");
    recommendations.push("app-server 当前未运行；启动后才能确认 initialize 握手和实时事件。");
  }
  if (status.running && !status.initialized) {
    compatibilityStatus = maxCompatibilityStatus(compatibilityStatus, "warning");
    recommendations.push("app-server 正在运行但 initialize 尚未确认，建议重启 app-server。");
  }
  if (status.pendingRequests > 0) {
    compatibilityStatus = maxCompatibilityStatus(compatibilityStatus, "warning");
    recommendations.push("存在未完成的 app-server 请求；如果长时间不变，可在手机端重启 app-server。");
  }
  if (sessionStats.totalUnknownNotifications > 0 || sessionStats.totalUnsupportedServerRequests > 0) {
    compatibilityStatus = maxCompatibilityStatus(compatibilityStatus, "warning");
    recommendations.push("发现当前适配器未覆盖的 app-server 方法，请升级 Gateway 或补充事件映射。");
  }
  if (transportStats.malformedMessages > 0) {
    compatibilityStatus = maxCompatibilityStatus(compatibilityStatus, "warning");
    recommendations.push("app-server 输出过无法解析的 JSON 行，建议检查 CLI 版本或 stderr 日志。");
  }
  if (recommendations.length === 0) {
    recommendations.push("当前 Gateway 覆盖了已知 app-server 核心事件和审批请求。");
  }

  return {
    status: compatibilityStatus,
    checkedAt: new Date().toISOString(),
    cliVersion: status.cliVersion,
    cliAvailable: status.cliAvailable,
    appServerRunning: status.running,
    initialized: status.initialized,
    initializedAt: status.initializedAt,
    pendingRequests: status.pendingRequests,
    adapter: {
      clientRequests: sessionStats.clientRequests,
      notifications: sessionStats.handledNotifications,
      serverRequests: sessionStats.handledServerRequests,
      clientCapabilities: ["experimentalApi"],
    },
    observations: {
      unknownNotifications: sessionStats.unknownNotifications,
      unsupportedServerRequests: sessionStats.unsupportedServerRequests,
      malformedMessages: transportStats.malformedMessages,
      lastMalformedAt: transportStats.lastMalformedAt,
    },
    recommendations,
  };
}

function maxCompatibilityStatus(left: "ok" | "warning" | "error", right: "ok" | "warning" | "error"): "ok" | "warning" | "error" {
  const order = { ok: 0, warning: 1, error: 2 };
  return order[left] >= order[right] ? left : right;
}

function readEventDetail(event: unknown, fallback: string): string {
  if (!event || typeof event !== "object") {
    return fallback;
  }
  const record = event as Record<string, unknown>;
  const attempt = typeof record.attempt === "number" ? `第 ${record.attempt} 次` : "";
  const delayMs = typeof record.delayMs === "number" ? `${Math.round(record.delayMs / 1000)} 秒后` : "";
  return [attempt, delayMs, fallback].filter(Boolean).join(" · ");
}
