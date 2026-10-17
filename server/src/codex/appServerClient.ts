import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import { execa } from "execa";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import WebSocket from 'ws';
import {appHome} from '../services/paths.js';

type RpcMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export type CodexConnectionState={initialized:boolean;shared:boolean;generation:number};

export function applyResumeConfig(method:string,params:unknown):unknown {
  if(method!=="thread/resume"||!params||typeof params!=="object"||Array.isArray(params))return params;
  const input=params as Record<string,unknown>;
  if(typeof input.threadId!=="string")return params;
  let policy:Record<string,{openai_base_url?:string}>;
  try{policy=JSON.parse(readFileSync(path.join(appHome(),'desktop-bridge','thread-config-overrides.json'),'utf8'));}catch{return params;}
  const baseUrl=policy[input.threadId]?.openai_base_url;
  if(typeof baseUrl!=="string")return params;
  let url:URL;try{url=new URL(baseUrl);}catch{return params;}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')return params;
  const config=input.config&&typeof input.config==='object'&&!Array.isArray(input.config)?input.config as Record<string,unknown>:{};
  return {...input,config:{...config,openai_base_url:baseUrl}};
}

export class CodexAppServerClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private socket:WebSocket|null=null;
  private desktopEndpoint:{url:string;token:string}|null=null;
  private approvalSocket:WebSocket|null=null;
  private connectionGeneration=0;
  private readyGeneration=0;
  private approvalRestartTimer:NodeJS.Timeout|null=null;
  private readonly pendingDesktopResolutions=new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  private startPromise: Promise<void> | null = null;
  private nextId = 1;
  private lastExitCode: number | null = null;
  private lastError: string | null = null;
  private startedAt: string | null = null;
  private initialized = false;
  private initializedAt: string | null = null;
  private malformedMessages = 0;
  private lastMalformedAt: string | null = null;
  private stopping = false;
  private autoRestartEnabled = process.env.CODEX_MOBILE_CONTROL_AUTO_RESTART !== "0";
  private restartAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private nextRestartAt: string | null = null;
  private lastRestartAt: string | null = null;
  private readonly requestTimeoutMs = 60000;
  private readonly pending = new Map<
    number | string,
    {
      method: string;
      startedAt: number;
      timeout: NodeJS.Timeout;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  async start(): Promise<void> {
    if(this.startPromise)return this.startPromise;
    const shared=this.useDesktopBridge();
    this.startPromise = (async()=>{
      if (this.initialized && (shared?this.socket?.readyState===WebSocket.OPEN:Boolean(this.process))) {
        if(!shared||this.desktopEndpointIsCurrent())return;
      }
      // Serialize teardown with startup, including a backend replaced during initialize.
      for(let attempt=0;attempt<3;attempt++){
        if(shared&&this.socket)await this.stop();
        await this.startProcess();
        if(!shared||this.desktopEndpointIsCurrent())return;
      }
      await this.stop();
      this.stopping=false;
      throw new Error('电脑端 Codex 正在重启，请稍后重试');
    })().catch(error=>{
      this.lastError=error instanceof Error?error.message:String(error);
      if(shared&&!this.stopping)this.scheduleAutoRestart(null);
      throw error;
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async startFromUser():Promise<void>{
    await this.start();
  }

  private async startProcess(): Promise<void> {
    this.clearRestartTimer();
    if(this.useDesktopBridge()) {
      if(this.process)await this.stop();
      this.stopping=false;
      await this.connectDesktop();
      return;
    }
    if (this.process) {
      return;
    }
    this.stopping = false;
    const appServer = codexInvocation(["app-server"]);
    this.process = spawn(appServer.command, appServer.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.startedAt = new Date().toISOString();
    this.lastExitCode = null;
    this.lastError = null;
    this.initialized = false;
    this.initializedAt = null;

    const rl = readline.createInterface({ input: this.process.stdout });
    rl.on("line", (line) => this.handleLine(line));
    this.process.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.lastError = text.trim() || this.lastError;
      this.emit("stderr", text);
    });
    this.process.on("error", (error) => {
      this.lastError = error.message;
      this.rejectAllPending(error);
      this.emit("processError", error);
    });
    this.process.on("close", (code) => {
      const expectedStop = this.stopping;
      this.process = null;
      this.startedAt = null;
      this.initialized = false;
      this.initializedAt = null;
      this.lastExitCode = code;
      this.rejectAllPending(new Error(`Codex app-server 已退出：${code ?? "unknown"}`));
      this.emit("exit", code);
      if (!expectedStop) {
        this.scheduleAutoRestart(code);
      }
    });

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "codex_mobile_control",
          title: "Codex Mobile Control",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      });
      this.initialized = true;
      this.initializedAt = new Date().toISOString();
      this.restartAttempts = 0;
      this.lastRestartAt = this.startedAt;
      this.notify("initialized", {});
      this.readyGeneration++;
      this.emit('ready',this.connectionState());
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.stop();
      throw error;
    }
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (method !== "initialize") await this.start();
    params=applyResumeConfig(method,params);
    const id = this.nextId++;
    const message = { id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server 请求超时：${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, startedAt: Date.now(), timeout, resolve, reject });
      try {
        this.write(message);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  respond(id: number | string, result: unknown): Promise<void> {
    if(typeof id==='string'&&id.startsWith('desktop:')){
      if(this.approvalSocket?.readyState!==WebSocket.OPEN)throw new Error('桌面审批连接已断开，请稍后重试');
      if(this.pendingDesktopResolutions.has(id))throw new Error('审批正在提交，请稍后刷新');
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{this.pendingDesktopResolutions.delete(id);reject(new Error('桌面审批响应超时，请刷新状态'));},10000);
        this.pendingDesktopResolutions.set(id,{resolve,reject,timer});
        this.approvalSocket!.send(JSON.stringify({type:'resolve',id,result}),error=>{
          if(error){clearTimeout(timer);this.pendingDesktopResolutions.delete(id);reject(error);}
        });
      });
    }
    this.write({ id, result });
    return Promise.resolve();
  }

  respondError(id: number | string, code: number, message: string): void {
    if(typeof id==='string'&&id.startsWith('desktop:'))return;
    this.write({ id, error: { code, message } });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    this.stopping=true;
    this.connectionGeneration++;
    this.clearRestartTimer();
    if(this.approvalRestartTimer){clearTimeout(this.approvalRestartTimer);this.approvalRestartTimer=null;}
    this.rejectDesktopResolutions();
    this.approvalSocket?.close();this.approvalSocket=null;
    if(this.socket){
      const socket=this.socket;
      this.socket=null;this.desktopEndpoint=null;this.initialized=false;this.initializedAt=null;this.startedAt=null;
      this.rejectAllPending(new Error('桌面连接已断开；原任务仍由桌面端运行'));
      socket.close();
      const timer=setTimeout(()=>socket.terminate(),1000);timer.unref();
      socket.once('close',()=>clearTimeout(timer));
      this.emit('exit',null,{shared:true});
      return;
    }
    if (!this.process) {
      return;
    }
    this.stopping = true;
    const process = this.process;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        process.kill("SIGKILL");
        resolve();
      }, 3000);
      process.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      process.kill();
    });
  }

  async status(): Promise<{
    cliVersion: string | null;
    cliAvailable: boolean;
    running: boolean;
    transport: 'desktop'|'managed';
    initialized: boolean;
    initializedAt: string | null;
    pendingRequests: number;
    startedAt: string | null;
    lastExitCode: number | null;
    lastError: string | null;
    malformedMessages: number;
    lastMalformedAt: string | null;
    autoRestartEnabled: boolean;
    restartAttempts: number;
    nextRestartAt: string | null;
    lastRestartAt: string | null;
  }> {
    const cliVersion = await readCodexVersion();
    return {
      cliVersion,
      cliAvailable: Boolean(cliVersion),
      running: Boolean(this.process)||this.socket?.readyState===WebSocket.OPEN,
      transport:this.useDesktopBridge()?'desktop':'managed',
      initialized: this.initialized,
      initializedAt: this.initializedAt,
      pendingRequests: this.pending.size,
      startedAt: this.startedAt,
      lastExitCode: this.lastExitCode,
      lastError: this.lastError,
      malformedMessages: this.malformedMessages,
      lastMalformedAt: this.lastMalformedAt,
      autoRestartEnabled: this.autoRestartEnabled,
      restartAttempts: this.restartAttempts,
      nextRestartAt: this.nextRestartAt,
      lastRestartAt: this.lastRestartAt,
    };
  }

  connectionState():CodexConnectionState {
    const shared=this.useDesktopBridge();
    return {shared,generation:this.readyGeneration,initialized:this.initialized&&(shared
      ?this.socket?.readyState===WebSocket.OPEN&&this.desktopEndpointIsCurrent()
      :Boolean(this.process))};
  }

  compatibilityStats(): { malformedMessages: number; lastMalformedAt: string | null } {
    return {
      malformedMessages: this.malformedMessages,
      lastMalformedAt: this.lastMalformedAt,
    };
  }

  private async ensureStarted(): Promise<void> {
    if (!this.process) {
      await this.start();
    }
  }

  private write(message: RpcMessage): void {
    if(this.socket&&!this.desktopEndpointIsCurrent())throw new Error('电脑端 Codex 连接已更新，请重试；原消息不会自动重发');
    if(this.socket?.readyState===WebSocket.OPEN){this.socket.send(JSON.stringify(message));return;}
    if (!this.process) {
      throw new Error("Codex app-server 未启动");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      this.malformedMessages += 1;
      this.lastMalformedAt = new Date().toISOString();
      this.emit("malformed", line);
      return;
    }

    if (message.id !== undefined && !message.method && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        const detail=JSON.stringify(message.error);
        // Keep the RPC error intact so submission receipts and the queue can
        // distinguish an explicit writer rejection from an uncertain send.
        pending.reject(new Error(detail));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      this.emit("serverRequest", message);
      return;
    }

    this.emit("notification", message);
  }

  private useDesktopBridge():boolean {
    return existsSync(path.join(appHome(),'desktop-bridge','enabled.json'));
  }

  private desktopEndpointIsCurrent():boolean {
    try{
      const endpoint=JSON.parse(readFileSync(path.join(appHome(),'desktop-bridge','endpoint.json'),'utf8'));
      return this.desktopEndpoint?.url===endpoint.url&&this.desktopEndpoint?.token===endpoint.token;
    }catch{return false;}
  }

  desktopApprovalStatus():{bridgeConfigured:boolean;connected:boolean}{
    return {bridgeConfigured:this.useDesktopBridge(),connected:this.approvalSocket?.readyState===WebSocket.OPEN};
  }

  private async connectDesktop():Promise<void> {
    if(this.socket?.readyState===WebSocket.OPEN&&this.initialized&&this.desktopEndpointIsCurrent())return;
    const generation=this.connectionGeneration;
    const directory=path.join(appHome(),'desktop-bridge');
    await execa(process.execPath,[path.join(directory,'shared-backend.mjs'),'--ensure',path.join(directory,'config.json')],{windowsHide:true,timeout:30000});
    if(generation!==this.connectionGeneration||this.stopping)throw new Error('电脑端 Codex 连接已取消');
    let endpoint:{url:string;token:string;approvalUrl?:string};
    try{endpoint=JSON.parse(readFileSync(path.join(appHome(),'desktop-bridge','endpoint.json'),'utf8'));}
    catch{throw new Error('共享后端尚未就绪，原会话和待发消息会保留');}
    const url=new URL(endpoint.url);
    if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||typeof endpoint.token!=='string'||endpoint.token.length<32)
      throw new Error('桌面连接配置无效，请重新打开 Codex');
    this.stopping=false;
    const socket=new WebSocket(endpoint.url,{headers:{Authorization:`Bearer ${endpoint.token}`},handshakeTimeout:8000});
    this.socket=socket;
    this.desktopEndpoint={url:endpoint.url,token:endpoint.token};
    socket.on('message',data=>{if(this.socket===socket)this.handleLine(data.toString());});
    socket.on('error',()=>{if(this.socket===socket)this.lastError='连接电脑端 Codex 失败，请检查桌面是否已启动';});
    socket.on('close',()=>{
      if(this.socket!==socket)return;
      this.connectionGeneration++;
      if(this.approvalRestartTimer){clearTimeout(this.approvalRestartTimer);this.approvalRestartTimer=null;}
      this.rejectDesktopResolutions();
      this.approvalSocket?.close();this.approvalSocket=null;
      this.socket=null;this.desktopEndpoint=null;this.initialized=false;this.initializedAt=null;this.startedAt=null;
      this.rejectAllPending(new Error('桌面连接中断，消息发送结果待确认'));
      this.emit('exit',null,{shared:true});
      if(!this.stopping)this.scheduleAutoRestart(null);
    });
    let endpointTimer:NodeJS.Timeout|undefined;
    const endpointChanged=new Promise<never>((_,reject)=>{
      // initialize can itself hang on the retired backend; do not wait for its RPC timeout.
      endpointTimer=setInterval(()=>{
        if(this.socket===socket&&!this.desktopEndpointIsCurrent())reject(new Error('电脑端 Codex 连接已更新'));
      },100);
      endpointTimer.unref();
    });
    try {
      await Promise.race([endpointChanged,new Promise<void>((resolve,reject)=>{
        socket.once('open',resolve);
        socket.once('error',()=>reject(new Error('正在等待电脑端 Codex 连接')));
        socket.once('close',()=>reject(new Error('电脑端 Codex 连接已关闭')));
      })]);
      if(this.socket!==socket||generation!==this.connectionGeneration)throw new Error('电脑端 Codex 连接已取消');
      this.startedAt=new Date().toISOString();this.lastError=null;this.lastExitCode=null;
      await Promise.race([endpointChanged,this.request('initialize',{clientInfo:{name:'codex_mobile_control',title:'Codex Mobile Control',version:'0.5.7'},capabilities:{experimentalApi:true}})]);
      if(this.socket!==socket||generation!==this.connectionGeneration)throw new Error('电脑端 Codex 连接已取消');
      if(!this.desktopEndpointIsCurrent())return;
      this.initialized=true;this.initializedAt=new Date().toISOString();this.restartAttempts=0;this.lastRestartAt=this.startedAt;
      this.notify('initialized',{});
      this.readyGeneration++;
      this.emit('ready',this.connectionState());
      if(endpoint.approvalUrl)void this.connectApprovalChannel(endpoint,socket,generation);
    } catch(error) {
      if(this.socket===socket&&!this.stopping&&!this.desktopEndpointIsCurrent())return;
      if(this.socket===socket){await this.stop();this.stopping=false;}
      throw error;
    } finally {if(endpointTimer)clearInterval(endpointTimer);}
  }

  private async connectApprovalChannel(endpoint:{approvalUrl?:string;token:string},socket:WebSocket,generation:number):Promise<void> {
    const isCurrent=()=>!this.stopping&&this.socket===socket&&generation===this.connectionGeneration&&socket.readyState===WebSocket.OPEN&&this.desktopEndpointIsCurrent();
    if(!endpoint.approvalUrl||!isCurrent()||this.approvalSocket)return;
    const url=new URL(endpoint.approvalUrl);
    if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1')return;
    const peer=new WebSocket(endpoint.approvalUrl,{headers:{Authorization:`Bearer ${endpoint.token}`},handshakeTimeout:5000});
    this.approvalSocket=peer;
    peer.on('error',()=>{});
    peer.on('message',data=>{
      if(this.approvalSocket!==peer||!isCurrent())return;
      let message:{type?:string;request?:RpcMessage;requests?:RpcMessage[];id?:string;threadId?:string;ok?:boolean};
      try{message=JSON.parse(data.toString());}catch{return;}
      if(message.type==='request'&&message.request)this.emit('serverRequest',message.request);
      if(message.type==='snapshot')for(const request of message.requests||[])this.emit('serverRequest',request);
      if(message.type==='resolved')this.emit('notification',{method:'serverRequest/resolved',params:{requestId:message.id,threadId:message.threadId}});
      if(message.type==='resolution'&&message.id){const pending=this.pendingDesktopResolutions.get(message.id);if(pending){clearTimeout(pending.timer);this.pendingDesktopResolutions.delete(message.id);message.ok?pending.resolve():pending.reject(new Error('审批已在电脑端处理或失效，请刷新状态'));}}
    });
    peer.on('open',()=>{if(this.approvalSocket!==peer||!isCurrent())peer.close();});
    peer.on('close',()=>{
      if(this.approvalSocket!==peer)return;
      this.approvalSocket=null;
      this.rejectDesktopResolutions();
      if(isCurrent()&&!this.approvalRestartTimer){
        this.approvalRestartTimer=setTimeout(()=>{this.approvalRestartTimer=null;void this.connectApprovalChannel(endpoint,socket,generation);},1500);
        this.approvalRestartTimer.unref();
      }
    });
  }

  private rejectDesktopResolutions():void {
    for(const pending of this.pendingDesktopResolutions.values()){clearTimeout(pending.timer);pending.reject(new Error('桌面审批连接已断开，请稍后重试'));}
    this.pendingDesktopResolutions.clear();
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private scheduleAutoRestart(code: number | null): void {
    if (!this.autoRestartEnabled || this.restartTimer) {
      return;
    }
    this.restartAttempts += 1;
    const attempt = this.restartAttempts;
    const delayMs = Math.min(1000 * 2 ** Math.max(0, this.restartAttempts - 1), 15000);
    this.nextRestartAt = new Date(Date.now() + delayMs).toISOString();
    this.emit("autorestart", { attempt, delayMs, code, nextRestartAt: this.nextRestartAt });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.nextRestartAt = null;
      this.start()
        .then(() => this.emit("autorestarted", { attempt }))
        .catch((error) => {
          this.lastError = error instanceof Error ? error.message : String(error);
          this.emit("processError", error);
          this.scheduleAutoRestart(code);
        });
    }, delayMs);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.nextRestartAt = null;
  }
}

let versionCache:{value:string|null;expiresAt:number}|undefined;
let versionRequest:Promise<string|null>|undefined;
async function readCodexVersion(): Promise<string | null> {
  if(versionCache&&versionCache.expiresAt>Date.now())return versionCache.value;
  if(versionRequest)return versionRequest;
  versionRequest=probeCodexVersion().then(value=>{
    versionCache={value,expiresAt:Date.now()+(value?60000:10000)};
    return value;
  }).finally(()=>{versionRequest=undefined;});
  return versionRequest;
}

async function probeCodexVersion(): Promise<string | null> {
  try {
    const version = codexInvocation(["--version"]);
    const { stdout } = await execa(version.command, version.args, { timeout: 5000, windowsHide:true });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function codexInvocation(args: string[]): { command: string; args: string[] } {
  const configuredCommand = process.env.CODEX_MOBILE_CONTROL_CODEX_BIN || process.env.CODEX_CLI_PATH;
  // Desktop ships a native CLI that understands its configuration. Prefer it to
  // an older npm shim when both are on PATH; explicit operator settings win.
  const native = process.platform === "win32" ? (process.env.PATH ?? "").split(path.delimiter)
    .map(directory => path.join(directory.replace(/^"|"$/g, ""), "codex.exe")).find(existsSync) : undefined;
  // Desktop updates replace the hashed install directory. A long-lived Gateway
  // can retain an obsolete PATH, so discover the current installation on launch.
  let desktop: string | undefined;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const root = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      desktop = readdirSync(root).map(name => path.join(root,name,'codex.exe')).filter(existsSync)
        .sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];
    } catch { /* Use an explicitly configured executable or PATH below. */ }
  }
  const command = configuredCommand || desktop || native || (process.platform === "win32" ? "codex.cmd" : "codex");
  const fullArgs = [...codexArgPrefix(), ...args];
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...fullArgs],
    };
  }
  return {
    command,
    args: fullArgs,
  };
}

function codexArgPrefix(): string[] {
  const raw = process.env.CODEX_MOBILE_CONTROL_CODEX_ARG_PREFIX;
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
