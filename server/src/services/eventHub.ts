import type { WebSocket } from "ws";
import type { GatewayEvent } from "../types.js";
import type { StateStore } from "./stateStore.js";
import { protocolMetadata } from "../protocol.js";
import { randomUUID } from "node:crypto";
import {performance} from 'node:perf_hooks';
import {scheduledMessage} from './messageSource.js';
import {deferLiveActivityDetails,mobileDeferredActivityTypes} from './mobileActivityDetails.js';
import {encodeEventPayload,EventSocketWriter,type EventPayload,type EventDisconnectCause} from './eventSocketWriter.js';

const heartbeatIntervalMs = Number(process.env.CODEX_MOBILE_CONTROL_WS_HEARTBEAT_MS || "25000");
const focusedStreamTypes=new Set(['message.delta','context.compaction','usage.updated','thread.settings.updated',...mobileDeferredActivityTypes]);

type ConnectionRoute='local'|'public'|'unknown';
type DisconnectCause=EventDisconnectCause;
type ConnectionState={id:string;openedAt:number;lastPongAt?:number;lastPingAt?:number;awaitingPong:boolean;route:ConnectionRoute};
export type EventConnectionDiagnostic={
  event:'opened'|'closed';connectionId:string;route:ConnectionRoute;stream:'all'|'thread'|'notifications';
  durationMs:number;bufferedBytes:number;heartbeatDelayMs:number;pongAgeMs?:number;pingAgeMs?:number;
  cause?:DisconnectCause;closeCode?:number;errorCode?:string;
};
export type EventLoopStall={at:string;delayMs:number;cpuUserMs:number;cpuSystemMs:number;utilization:number;rssMb:number;heapMb:number;connections:number};

export class EventHub {
  private readonly listeners=new Set<(event:GatewayEvent)=>void>();
  subscribe(listener:(event:GatewayEvent)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}

  private readonly clients = new Set<WebSocket>();
  private readonly deferredClients = new Set<WebSocket>();
  private readonly streamThreads=new Map<WebSocket,string>();
  private readonly authorizations = new Map<WebSocket, () => boolean>();
  private readonly connectionState = new Map<WebSocket, ConnectionState>();
  private readonly socketWriter=new EventSocketWriter((client,cause,code,errorCode)=>this.remove(client,cause,code,errorCode));
  private readonly heartbeatTimer: NodeJS.Timeout;
  private lastHeartbeatAt=performance.now();
  private heartbeatDelayMs=0;
  private maxHeartbeatDelayMs=0;
  private cpuSample=process.cpuUsage();
  private loopSample=performance.eventLoopUtilization();
  private lastStall?:EventLoopStall;
  private historyWriteError?:string;
  persistenceStatus(){return {ok:!this.historyWriteError,error:this.historyWriteError};}
  performanceStatus(){
    let bufferedBytes=0;for(const client of this.clients)bufferedBytes+=client.bufferedAmount;
    return {connections:this.clients.size,bufferedBytes,heartbeatDelayMs:Math.round(this.heartbeatDelayMs),maxHeartbeatDelayMs:this.maxHeartbeatDelayMs,lastStall:this.lastStall,persistenceOk:!this.historyWriteError};
  }

  constructor(private readonly store: StateStore,private readonly isSubagent:(threadId:string)=>boolean=()=>false,
    private readonly diagnose:(record:EventConnectionDiagnostic)=>void=()=>{},private readonly onStall:(record:EventLoopStall)=>void=()=>{}) {
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  add(client: WebSocket, authorized: () => boolean = () => true,deferActivities=false,streamThread?:string,route:ConnectionRoute='unknown'): void {
    this.clients.add(client);
    this.setStreamThread(client,streamThread);
    if(deferActivities)this.deferredClients.add(client);
    this.authorizations.set(client, authorized);
    this.connectionState.set(client,{id:randomUUID(),openedAt:performance.now(),awaitingPong:false,route});
    client.on("pong", () => {const state=this.connectionState.get(client);if(state){state.lastPongAt=performance.now();state.awaitingPong=false;}});
    client.on("close", (code:number) => this.remove(client,'peer_close',code));
    client.on("error", (error:Error&{code?:string}) => this.remove(client,'socket_error',undefined,
      typeof error.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.code)?error.code:undefined));
    this.report(client,'opened');
    const metadata = protocolMetadata();
    this.send(client, {
      type: "connected",
      serverVersion: metadata.version,
      protocolVersion: metadata.protocolVersion,
      minAndroidProtocolVersion: metadata.minAndroidProtocolVersion,
      capabilities: metadata.capabilities,
    });
    for (const event of this.store.events.slice(-100)) {
      this.send(client, { ...event, replayed: true });
    }
  }

  setStreamThread(client:WebSocket,threadId?:string):void{
    if(!this.clients.has(client))return;
    if(threadId===undefined)this.streamThreads.delete(client);else this.streamThreads.set(client,threadId);
  }
  focusStream(client:WebSocket,threadId:string,requestId:string):void{
    if(!this.clients.has(client))return;
    this.setStreamThread(client,threadId);
    this.socketWriter.send(client,encodeEventPayload({type:'thread.focused',threadId,requestId}));
  }
  private includes(client:WebSocket,event:GatewayEvent):boolean{
    if('threadId' in event&&event.threadId&&this.store.isEphemeral?.(event.threadId)&&this.streamThreads.get(client)!==event.threadId)return false;
    if(!this.streamThreads.has(client))return true;
    // Command execution already has tool.output. Native terminals only consume
    // commandId-addressed sessions; broadcasting the duplicate stream to every
    // phone (including its notification socket) can exhaust the reader queue.
    if(event.type==='terminal.output')return Boolean(event.commandId);
    return !('threadId' in event)||!event.threadId||!focusedStreamTypes.has(event.type)||this.streamThreads.get(client)===event.threadId;
  }

  publish(event: GatewayEvent, persist=true): void {
    if(event.type==='user.message')event={...event,...scheduledMessage(event.text)};
    if((event.type==='turn.completed'||event.type==='goal.completed')&&this.isSubagent(event.threadId))event={...event,subagent:true};
    event = { ...event, eventId: event.eventId ?? randomUUID(), createdAt: event.createdAt ?? new Date().toISOString() };
    if(persist)void this.store.appendEvent(event).then(()=>{this.historyWriteError=undefined;},error=>{
      const firstFailure=!this.historyWriteError;
      this.historyWriteError=error instanceof Error?error.message:String(error);
      // Keep the live stream available, but never claim that an unsaved event is recoverable.
      if(firstFailure){
        console.error('Gateway history write failed',error);
        this.publish({type:'warning',title:'历史记录保存失败',detail:'当前内容仍会实时显示，尚未保存的内容无法在断线后恢复。请检查电脑存储空间和文件权限。'},false);
      }
    });
    for(const listener of this.listeners){
      try{listener(event);}catch{console.error('Gateway event subscriber failed');}
    }
    if(this.clients.size){
      let deferred:ReturnType<typeof deferLiveActivityDetails>|undefined;
      let fullPayload:EventPayload|undefined,deferredPayload:EventPayload|undefined;
      for(const client of this.clients){
        if(!this.includes(client,event))continue;
        if(this.deferredClients.has(client))deferred??=deferLiveActivityDetails(event);
        const payload=this.deferredClients.has(client)&&deferred!==event
          ?deferredPayload??=encodeEventPayload(deferred):fullPayload??=encodeEventPayload(event);
        this.socketWriter.send(client,payload);
      }
    }
  }

  closeUnauthorized(): void {
    for (const client of this.clients) {
      if (!this.authorizations.get(client)?.()) { this.remove(client,'unauthorized',1008);client.close(1008, "unauthorized"); }
    }
  }

  private send(client: WebSocket, event: GatewayEvent): void {
    if(!this.includes(client,event))return;
    this.socketWriter.send(client,encodeEventPayload(this.deferredClients.has(client)?deferLiveActivityDetails(event):event));
  }

  private checkHeartbeats(): void {
    const now=performance.now();
    this.heartbeatDelayMs=Math.max(0,Math.round(now-this.lastHeartbeatAt-heartbeatIntervalMs));
    this.maxHeartbeatDelayMs=Math.max(this.maxHeartbeatDelayMs,this.heartbeatDelayMs);
    this.lastHeartbeatAt=now;
    const cpu=process.cpuUsage(this.cpuSample);this.cpuSample=process.cpuUsage();
    const loop=performance.eventLoopUtilization(this.loopSample);this.loopSample=performance.eventLoopUtilization();
    if(this.heartbeatDelayMs>=1500){
      const memory=process.memoryUsage();
      this.lastStall={at:new Date().toISOString(),delayMs:this.heartbeatDelayMs,cpuUserMs:Math.round(cpu.user/1000),cpuSystemMs:Math.round(cpu.system/1000),
        utilization:Math.round(loop.utilization*1000)/1000,rssMb:Math.round(memory.rss/1048576),heapMb:Math.round(memory.heapUsed/1048576),connections:this.clients.size};
      this.onStall(this.lastStall);
    }
    this.closeUnauthorized();
    for (const client of this.clients) {
      if (client.readyState !== client.OPEN) {
        this.remove(client,'not_open');
        continue;
      }
      const state=this.connectionState.get(client)!;
      // After a host stall, queued pongs may not have run before this timer.
      // Give a fresh ping one normal interval; the next check still closes a dead peer.
      if (state.awaitingPong&&this.heartbeatDelayMs<heartbeatIntervalMs/2) {
        this.remove(client,'heartbeat_timeout');
        client.terminate();
        continue;
      }
      state.awaitingPong=true;state.lastPingAt=now;
      client.ping();
    }
  }

  private report(client:WebSocket,event:'opened'|'closed',cause?:DisconnectCause,closeCode?:number,errorCode?:string):void{
    const state=this.connectionState.get(client);if(!state)return;
    const now=performance.now(),age=(at:number|undefined)=>at===undefined?undefined:Math.max(0,Math.round(now-at));
    this.diagnose({event,connectionId:state.id,route:state.route,
      stream:!this.streamThreads.has(client)?'all':this.streamThreads.get(client)?'thread':'notifications',
      durationMs:age(state.openedAt)!,bufferedBytes:client.bufferedAmount,heartbeatDelayMs:this.heartbeatDelayMs,
      pongAgeMs:age(state.lastPongAt),pingAgeMs:age(state.lastPingAt),cause,closeCode,errorCode});
  }

  private remove(client: WebSocket,cause:DisconnectCause,closeCode?:number,errorCode?:string): void {
    if(!this.clients.has(client))return;
    this.report(client,'closed',cause,closeCode,errorCode);
    this.authorizations.delete(client);
    this.deferredClients.delete(client);
    this.streamThreads.delete(client);
    this.clients.delete(client);
    this.connectionState.delete(client);
  }
}
