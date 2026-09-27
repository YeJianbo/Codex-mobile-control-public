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
import { loadServerConfig, rotateServerToken, serverConfigPath } from "./services/configStore.js";
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
import { listThreadsWithCodexHistory, pendingDesktopQuestions, readCodexThreadEvents, selectConversationWindow } from "./services/codexSessions.js";
import type { GatewayEvent } from "./types.js";
import { registerPreviewProxy, handlePreviewUpgrade } from "./services/previewProxy.js";
import {readModelCatalog,assertAvailableModel} from './services/modelCatalog.js';
import {modelAgent,threadAgent} from './services/agentProtocol.js';
import {pairAddresses} from './services/pairAddresses.js';
import {registerImageUploads} from './services/imageUploads.js';
import {registerFileUploads, type FileAttachment} from './services/fileUploads.js';
import {desktopSidebar} from './services/desktopSidebar.js';
import {appHome} from './services/paths.js';
import {FollowupQueue} from './services/followupQueue.js';
import {isWriterOccupied,userFacingError} from './services/userFacingError.js';
import {resolveHistoryImage} from './services/historyImages.js';
import {UsageReader} from './services/usage.js';
import {readCodexGoals} from './services/codexGoals.js';
import {readRemoteAutoApproval,writeRemoteAutoApproval} from './services/remoteApprovalSettings.js';
import {verifyDeviceProof} from './services/deviceProof.js';
import {readPublicAccessSettings,updatePublicAccessPassword} from './services/publicAccessSettings.js';

const addProjectSchema = z.object({ path: z.string().min(1) });
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
const projectFields = { projectPath: z.string().optional(), model: z.string().optional(), effort:z.string().optional(), permission:z.enum(["ask","auto","full","custom"]).optional() };
const fileSchema=z.object({id:z.string().uuid(),name:z.string().max(160),mime:z.string().max(120),size:z.number().int().nonnegative()});
const imageFields={images:z.array(z.object({id:z.string(),name:z.string().max(160)})).max(8).optional(),files:z.array(fileSchema).max(8).optional()};
const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.start"), ...requestFields, ...projectFields, ...imageFields, initialText: z.string().optional() }),
  z.object({ type: z.literal("thread.resume"), ...requestFields, ...projectFields, threadId: z.string().min(1) }),
  z.object({ type: z.literal("turn.start"), ...requestFields, ...projectFields, ...imageFields, threadId: z.string().min(1), text: z.string().trim() }),
  z.object({ type: z.literal("turn.interrupt"), ...requestFields, threadId: z.string().min(1) }),
  z.object({ type: z.literal("approval.resolve"), ...requestFields, approvalId: z.string().min(1), decision: z.enum(["accept", "decline"]) }),
  z.object({ type: z.literal("debug.echo"), ...requestFields, threadId: z.string().optional(), text: z.string() }),
]);

const config = await loadServerConfig();
const publicProxySecret=await fs.readFile(path.join(appHome(),'public-access.json'),'utf8').then(raw=>(JSON.parse(raw) as {proxySecret?:string}).proxySecret).catch(()=>undefined);
const store = new StateStore();
await store.load();
await store.closeDanglingTerminalCommands();
await store.expirePendingApprovals();
const httpsOptions = await httpsListenOptions(config);
const app = Fastify({ logger: { serializers: { req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url.replace(/([?&]token=)[^&]*/g, "$1[redacted]") }) } }, ...(httpsOptions ? { https: httpsOptions } : {}) } as any) as unknown as FastifyInstance;
const hub = new EventHub(store);
const codex = new CodexAppServerClient();
const sessions = new SessionManager(codex, hub, store);
for(const thread of store.threads.filter(t=>threadAgent(t.id)!=='codex'&&t.status==='running')){
  await store.upsertThread({id:thread.id,status:'interrupted'});
  hub.publish({type:'turn.completed',threadId:thread.id,status:'interrupted'});
}
async function validateAgentModel(model?:string,id?:string){
  if(id&&model&&threadAgent(id)!==modelAgent(model))throw Error('请在新会话中切换助手，当前会话继续使用原助手');
  if((id?threadAgent(id):modelAgent(model))!=='codex')await sessions.agents.validate(model,id);
  else await assertAvailableModel(codex,model);
}
function currentThreadStatus(id:string,events:GatewayEvent[]):string {
  const thread=store.threads.find(t=>t.id===id);
  if(sessions.ownsThread(id))return thread?.status||'running';
  const lifecycle=events.filter(e=>e.type==='turn.started'||e.type==='turn.completed').at(-1);
  if(lifecycle)return lifecycle.type==='turn.started'?'running':lifecycle.status;
  return thread?.status||'idle';
}
const followups=new FollowupQueue(store,sessions,async id=>{
  return currentThreadStatus(id,await readCodexThreadEvents(id));
},async entry=>{
  await validateAgentModel(entry.model,entry.threadId);
  const projectPath=await assertProjectAccess(undefined,entry.threadId);
  await sessions.handleClientCommand({type:'turn.start',threadId:entry.threadId,text:entry.text,images:entry.images,files:entry.files,model:entry.model,effort:entry.effort,permission:entry.sourcePublic?'ask':entry.permission,requestId:entry.id,projectPath},entry.sourcePublic===true);
});
app.addHook('onClose',async()=>followups.close());
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
  "console.js": ["public/console.js", "text/javascript"],
  "console-core.js": ["public/console-core.js", "text/javascript"],
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
app.get('/api/sidebar',async()=>{
  const desktop=await desktopSidebar(),allowed=await listProjects(config);
  const normalize=(value:string)=>path.resolve(value).toLowerCase();
  const projects=desktop.projects.map(project=>({...project,...allowed.find(p=>normalize(p.path)===normalize(project.path)),name:project.name}));
  for(const project of allowed)if(!projects.some(p=>normalize(p.path)===normalize(project.path)))projects.push(project);
  return {projects,pinned:desktop.pinned};
});

registerPreviewProxy(app, config);
registerImageUploads(app);
registerFileUploads(app);

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

app.get("/api/threads", async () => {
  const goals=readCodexGoals();
  const listed=await listThreadsWithCodexHistory(store.threads,false,store.threads.filter(t=>sessions.ownsThread(t.id)).map(t=>t.id));
  await Promise.all(listed.filter(thread=>thread.status==='running'&&!sessions.ownsThread(thread.id)).map(async thread=>{
    thread.status=currentThreadStatus(thread.id,await readCodexThreadEvents(thread.id)) as typeof thread.status;
  }));
  return {threads:listed
    .filter(thread=>!store.isThreadHidden(thread.id))
    .map(thread=>({...thread,...(goals.has(thread.id)?{goal:goals.get(thread.id)}:{})}))};
});

app.get('/api/threads/:threadId/queue',async request=>{
  const {threadId}=request.params as {threadId:string};
  const viaPublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  const lifecycle=(await readCodexThreadEvents(threadId)).filter(event=>event.type==='turn.started'||event.type==='turn.completed').at(-1);
  const canSteer=viaPublic?sessions.canSteerPublic(threadId):(sessions.canSteer(threadId)||(lifecycle?.type==='turn.started'&&!!lifecycle.turnId));
  return {messages:followups.list(threadId).map(message=>({...message,canSteer}))};
});
app.post('/api/threads/:threadId/queue',async request=>{
  const {threadId}=request.params as {threadId:string};
  const sourcePublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  if(sourcePublic&&threadAgent(threadId)!=='codex')throw new Error('公网仅支持 Codex 会话');
  const body=z.object({id:z.string().min(1).max(160),text:z.string().max(200000),model:z.string().optional(),effort:z.string().optional(),permission:z.enum(['ask','auto','full','custom']).optional(),images:z.array(z.object({id:z.string(),name:z.string()})).max(8).default([]),files:z.array(fileSchema).max(8).default([])}).parse(request.body);
  if(!body.text.trim()&&!body.images.length&&!body.files.length)throw new Error('请输入消息或添加附件');
  if(!(await listThreadsWithCodexHistory(store.threads)).some(t=>t.id===threadId))throw new Error('找不到此任务');
  return {message:followups.add({...body,threadId,sourcePublic,permission:sourcePublic?'ask':body.permission})};
});
app.patch('/api/threads/:threadId/queue/:id',async request=>{
  const {threadId,id}=request.params as {threadId:string;id:string};
  const body=z.object({text:z.string().min(1).max(200000)}).parse(request.body);
  return {message:followups.edit(id,threadId,body.text)};
});
app.delete('/api/threads/:threadId/queue/:id',async request=>{const {threadId,id}=request.params as {threadId:string;id:string};followups.cancel(id,threadId);return {ok:true};});
app.post('/api/threads/:threadId/queue/:id/:action',async request=>{
  const {threadId,id,action}=request.params as {threadId:string;id:string;action:string};
  const viaPublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
  if(viaPublic&&threadAgent(threadId)!=='codex')throw new Error('公网仅支持 Codex 会话');
  if(viaPublic&&(!followups.list(threadId).some(entry=>entry.id===id&&entry.sourcePublic)||(action==='steer'&&!sessions.canSteerPublic(threadId))))throw new Error('公网只能引导本机安全模式中的任务或重试本机排队的消息');
  if(action==='steer'){
    const lifecycle=(await readCodexThreadEvents(threadId)).filter(event=>event.type==='turn.started'||event.type==='turn.completed').at(-1);
    const desktopTurnId=lifecycle?.type==='turn.started'?lifecycle.turnId:undefined;
    await followups.steer(id,threadId,desktopTurnId);
  }
  else if(action==='retry')followups.retry(id,threadId);
  else throw new Error('未知队列操作');
  return {ok:true};
});

app.get("/api/threads/:threadId/events", async (request) => {
  const params = request.params as { threadId: string };
  const count=z.object({count:z.coerce.number().int().min(20).max(20000).optional()}).parse(request.query).count;
  const historicalEvents = await readCodexThreadEvents(params.threadId,count);
  const storedEvents = store.eventsForThread(params.threadId);
  const merged=mergeMobileThreadEvents(historicalEvents, storedEvents).filter(isVisibleMobileThreadEvent);
  const selected=count===undefined?selectConversationWindow(merged):merged.slice(-count);
  return {
    status:currentThreadStatus(params.threadId,historicalEvents),
    hasMore:count!==undefined&&merged.length>count,
    events: selected
      .map(event=>event.type==='user.message'&&event.eventId?.startsWith('history:')?{
        ...event,attachments:event.attachments?.map((file,index)=>({
          ...file,url:/\.(png|jpe?g|webp|gif)$/i.test(file.path)
            ?`/api/threads/${encodeURIComponent(params.threadId)}/history-image?eventId=${encodeURIComponent(event.eventId!)}&index=${index}`
            :undefined,
        })),
      }:event),
  };
});

app.get('/api/threads/:threadId/history-image',async(request,reply)=>{
  const {threadId}=request.params as {threadId:string};
  const {eventId,index}=z.object({eventId:z.string().min(1),index:z.coerce.number().int().min(0).max(20)}).parse(request.query);
  const event=(await readCodexThreadEvents(threadId)).find(item=>item.type==='user.message'&&item.eventId===eventId);
  const attachment=event?.type==='user.message'?event.attachments?.[index]:undefined;
  if(!attachment)return reply.code(404).send({error:'not_found'});
  const file=await resolveHistoryImage(attachment.path,(await listProjects(config)).map(project=>project.path));
  if(!file)return reply.code(404).send({error:'not_found'});
  return reply.type(contentTypeFor(file.absolutePath)).header('Content-Length',String(file.size))
    .header('Cache-Control','private, max-age=300')
    .send((await import('node:fs')).createReadStream(file.absolutePath));
});

app.post("/api/threads/:threadId/resume", async (request) => {
  const params = request.params as { threadId: string };
  if(request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null&&threadAgent(params.threadId)!=='codex')throw new Error('公网仅支持 Codex 会话');
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
  if(threadAgent(threadId)!=='codex')throw new Error('此助手暂不支持与桌面同步置顶');
  const {pinned}=z.object({pinned:z.boolean()}).parse(request.body);
  await codex.request('thread/section/move',{threadId,sectionId:pinned?'01984de2-8f74-7c91-a3b2-5c5e937cf318':null});
  return {ok:true,pinned};
});

app.patch('/api/threads/:threadId/goal',async request=>{
  const {threadId}=request.params as {threadId:string};
  if(threadAgent(threadId)!=='codex')throw new Error('此助手暂不支持目标控制');
  const body=z.object({objective:z.string().trim().min(1).max(200000).optional(),status:z.enum(['active','paused']).optional()}).refine(value=>value.objective!==undefined||value.status!==undefined).parse(request.body);
  const result=await codex.request('thread/goal/set',{threadId,...body}) as {goal:unknown};
  return {goal:result.goal};
});

app.delete("/api/threads/:threadId", async (request) => {
  const params = request.params as { threadId: string };
  await store.deleteThread(params.threadId);
  return { ok: true };
});

app.get("/api/approvals", async request => {
  const threadId=z.object({threadId:z.string().optional()}).parse(request.query).threadId;
  const desktop=threadId?pendingDesktopQuestions(threadId,await readCodexThreadEvents(threadId),store.eventsForThread(threadId),store.approvals.filter(item=>item.status!=='pending').map(item=>item.id)):[];
  return {approvals:[...store.approvals,...desktop]};
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
    const pending=pendingDesktopQuestions(threadId,events,store.eventsForThread(threadId),store.approvals.filter(item=>item.status!=='pending').map(item=>item.id)).find(item=>item.id===approvalId);
    if(!pending)throw new Error('问题已处理或不再可用，请刷新会话');
    const questions=JSON.parse(pending.detail||'{}').questions as {id:string;question:string}[];
    if(Object.keys(body.answers).length!==questions.length||questions.some(item=>!body.answers[item.id]?.answers[0]?.trim()))throw new Error('请回答所有问题');
    const text=questions.length===1?body.answers[questions[0].id].answers[0].trim():questions.map(item=>`${item.question}\n${body.answers[item.id].answers[0].trim()}`).join('\n\n');
    const viaPublic=request.headers['x-public-proxy-secret']===publicProxySecret&&publicProxySecret!=null;
    if(viaPublic)sessions.markPublicThread(threadId);
    const lifecycle=events.filter(event=>event.type==='turn.started'||event.type==='turn.completed').at(-1);
    if(currentThreadStatus(threadId,events)==='running'&&lifecycle?.type==='turn.started'&&lifecycle.turnId){
      await codex.request('turn/steer',{threadId,expectedTurnId:lifecycle.turnId,input:[{type:'text',text,text_elements:[]}]});
    }else{
      followups.add({id:`answer:${approvalId}`,threadId,text,images:[],files:[],permission:'ask',sourcePublic:viaPublic});
    }
    await store.addApproval(pending);
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
  const project = await addProject(config, body.path);
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
app.put('/api/settings/public-access/password',async request=>{
  const {password}=z.object({password:z.string().min(16).max(128)}).parse(request.body);
  if(password.trim()!==password)throw new Error('密码首尾不能有空格');
  return {publicAccess:await updatePublicAccessPassword(password)};
});
const usageReader=new UsageReader(codex);
app.get('/api/usage',async request=>{
  const query=z.object({threadId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),agent:z.enum(['codex','claude','antigravity','grok']).optional(),days:z.coerce.number().int().min(1).max(90).optional()}).parse(request.query);
  const agent=query.threadId?threadAgent(query.threadId):query.agent||'codex';
  return agent!=='codex'?sessions.agents.usage(query.threadId||'',agent):usageReader.read(query.threadId,query.days);
});
app.get('/api/models',async request=>{
  if((request.query as any).agents!=='all')return readModelCatalog(codex);
  const [codexModels,otherModels]=await Promise.allSettled([readModelCatalog(codex),sessions.agents.models()]);
  return {models:[...(codexModels.status==='fulfilled'?codexModels.value.models:[]),...(otherModels.status==='fulfilled'?otherModels.value:[])],source:'local-agents'};
});

app.get("/api/settings/approval-summary", async () => ({
  summary: await readApprovalPolicySummary(),
}));

app.get('/api/settings/remote-approval',async()=>({desktopAutoApprove:await readRemoteAutoApproval(),...codex.desktopApprovalStatus()}));
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
  await codex.start();
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
  hub.add(socket, authorized);
  socket.on("message", (raw) => {
    if (!authorized()) { socket.close(1008, "unauthorized"); return; }
    void (async () => {
      const message = clientCommandSchema.parse(JSON.parse(raw.toString()));
      if(viaPublic&&(message.type==='debug.echo'||(message.type==='thread.start'&&modelAgent(message.model)!=='codex')||('threadId' in message&&message.threadId&&threadAgent(message.threadId)!=='codex')))throw new Error('公网仅支持 Codex 会话');
      if(viaPublic&&'permission' in message)message.permission='ask';
      if(message.type==='turn.start' && !sessions.ownsThread(message.threadId) && currentThreadStatus(message.threadId,await readCodexThreadEvents(message.threadId))==='running')throw new Error('此任务正在桌面执行，请将消息加入待发队列。');
      if (message.type === "thread.start" || message.type === "thread.resume" || message.type === "turn.start") {
        await validateAgentModel(message.model,'threadId' in message?message.threadId:undefined);
        if (message.type === 'thread.start' && !message.projectPath) {
          const workspace = path.join(appHome(), '默认工作区');
          await fs.mkdir(workspace, {recursive:true});
          await addProject(config, workspace);
          message.projectPath = workspace;
          hub.publish({type:'projects.changed'});
        }
        message.projectPath = await assertProjectAccess(message.projectPath, "threadId" in message ? message.threadId : undefined);
      }
      await sessions.handleClientCommand(message,viaPublic);
    })().catch((error) => {
      const message = (() => {
        try {
          return JSON.parse(raw.toString()) as { type?:string; threadId?: string; requestId?: string; text?:string; images?:{id:string;name:string}[]; files?:FileAttachment[]; model?:string; effort?:string; permission?:'ask'|'auto'|'full'|'custom' };
        } catch {
          return {};
        }
      })();
      if(message.type==='turn.start'&&message.threadId&&isWriterOccupied(error)){
        try {
          const queued=followups.add({id:message.requestId||randomUUID(),threadId:message.threadId,text:message.text||'',images:message.images||[],files:message.files||[],model:message.model,effort:message.effort,permission:viaPublic?'ask':message.permission,sourcePublic:viaPublic,resume:true,error:userFacingError(error)});
          socket.send(JSON.stringify({type:'message.queued',threadId:message.threadId,requestId:message.requestId,queueId:queued.id,message:queued.error}));
          return;
        }catch(queueError){error=queueError;}
      }
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
  const text = "text" in event ? event.text : "";
  const detail = "detail" in event ? event.detail ?? "" : "";
  return !text.includes("codex_internal_context") && !detail.includes("codex_internal_context");
}

function mergeMobileThreadEvents(historicalEvents: GatewayEvent[], storedEvents: GatewayEvent[]): GatewayEvent[] {
  if (!historicalEvents.length) return storedEvents;
  const attached=new Set<GatewayEvent>();
  historicalEvents=historicalEvents.map(event=>{
    if(event.type!=='user.message')return event;
    const saved=storedEvents.find(candidate=>candidate.type==='user.message'&&(candidate.images?.length||candidate.files?.length)&&!attached.has(candidate)&&(candidate.text===event.text||(candidate.files?.length&&event.text.startsWith(candidate.text+'\n\n用户附加文件（'))) &&Math.abs(Date.parse(candidate.createdAt||'')-Date.parse(event.createdAt||''))<10000);
    if(saved?.type==='user.message'){attached.add(saved);return {...event,text:saved.text,images:saved.images,files:saved.files};}
    return event;
  });
  const cutoffs = new Map<string,number>();
  for(const event of historicalEvents)cutoffs.set(event.type,Math.max(cutoffs.get(event.type)||0,Date.parse(event.createdAt||'')||0));
  // A historical message is a completed snapshot. Keep only newer stream fragments;
  // comparing text substrings would incorrectly drop repeated words and punctuation.
  const recent = storedEvents.filter((event) => {
    if(event.type==='user.message'&&(event.images?.length||event.files?.length))return !attached.has(event);
    if (["user.message", "message.delta", "reasoning.summary"].includes(event.type)) {
      return Boolean(event.createdAt) && (Date.parse(event.createdAt!) > (cutoffs.get(event.type)||0));
    }
    return true;
  });
  return [...historicalEvents, ...recent].sort((a,b)=>(Date.parse(a.createdAt||'')||0)-(Date.parse(b.createdAt||'')||0));
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
