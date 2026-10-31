import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { nanoid } from "nanoid";
import type { Device, GatewayEvent, PairingSession, PendingApproval, PersistentState, TerminalCommandHistory, TerminalCommandOutputPage, ThreadRecord } from "../types.js";
import { appHome } from "./paths.js";
import {CodexLiveHistory} from './codexLiveHistory.js';
import {ParsedEventHistory} from './parsedEventHistory.js';
import {SessionTokenLedger} from './sessionTokenLedger.js';
import {readStoredThreadEvents} from './storedThreadHistory.js';
import {deferMobileActivityDetails,deferLiveActivityDetails,isVisibleMobileThreadEvent} from './mobileActivityDetails.js';
import {confirmedToolChanges} from './fileChanges.js';

const sqlitePath = path.join(appHome(), "state.sqlite");
const legacyJsonPath = path.join(appHome(), "state.json");
const maxEvents = 1000;

type CountRow = { count: number };
type DeviceRow = {
  id: string;
  name: string;
  first_seen_at: string;
  last_seen_at: string;
  token_hash: string | null;
  revoked_at: string | null;
  user_agent: string | null;
};
type PairingRow = {
  code: string;
  device_token: string;
  expires_at: string;
  created_at: string;
};
type ThreadRow = {
  id: string;
  project_path: string | null;
  title: string;
  status: ThreadRecord["status"];
  created_at: string;
  updated_at: string;
};
type ApprovalRow = {
  id: string;
  rpc_id: string;
  method: string;
  thread_id: string;
  turn_id: string | null;
  item_id: string | null;
  approval_id: string | null;
  approval_type: PendingApproval["approvalType"];
  title: string;
  detail: string | null;
  status: PendingApproval["status"];
  created_at: string;
  resolved_at: string | null;
};
type EventRow = {
  payload: string;
};

export class StateStore {
  sessionUsage:SessionTokenLedger|null=null;
  private readonly transientThreads=new Map<string,{thread:ThreadRecord;events:GatewayEvent[]}>();
  private readonly closedTransientThreads=new Set<string>();
  isEphemeral(threadId:string){return this.transientThreads.has(threadId)||this.closedTransientThreads.has(threadId);}
  dropEphemeral(threadId:string){
    this.transientThreads.delete(threadId);this.closedTransientThreads.add(threadId);
    if(this.closedTransientThreads.size>128)this.closedTransientThreads.delete(this.closedTransientThreads.values().next().value!);
  }
  private state: PersistentState = emptyState();
  private db: DatabaseSync | null = null;
  private hiddenThreads = new Set<string>();
  private codexLiveHistory:CodexLiveHistory|null=null;
  private parsedHistory:ParsedEventHistory|null=null;
  private eventSql:{insert:StatementSync;trim:StatementSync;archiveAgent:StatementSync}|null=null;
  private threadSql:{upsert:StatementSync;source:StatementSync}|null=null;
  private deviceTouchSql:StatementSync|null=null;
  private approvalSql:StatementSync|null=null;

  async load(): Promise<void> {
    await fs.mkdir(appHome(), { recursive: true });
    this.db = new DatabaseSync(sqlitePath);
    // The assistant host and the gateway keep separate connections to this file.
    this.db.exec("PRAGMA busy_timeout=5000");
    if(process.env.CODEX_MOBILE_CONTROL_AGENT_HOST==='1')this.db.exec("PRAGMA journal_mode=WAL");
    this.eventSql=null;
    this.threadSql=null;
    this.deviceTouchSql=null;this.approvalSql=null;
    this.initSchema();
    this.sessionUsage=new SessionTokenLedger(this.db);
    this.parsedHistory=new ParsedEventHistory(this.db);
    this.codexLiveHistory=new CodexLiveHistory(this.db,this.parsedHistory);
    this.db.exec("CREATE TABLE IF NOT EXISTS thread_sources (thread_id TEXT PRIMARY KEY, source TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS thread_read_receipts (thread_id TEXT PRIMARY KEY, completed_at_ms INTEGER NOT NULL)");
    this.db.exec('CREATE TABLE IF NOT EXISTS thread_completions (thread_id TEXT PRIMARY KEY,completed_at_ms INTEGER NOT NULL,desktop_unread_seen INTEGER NOT NULL DEFAULT 0)');
    this.db.exec('CREATE TABLE IF NOT EXISTS thread_pins (thread_id TEXT PRIMARY KEY,pinned_at INTEGER NOT NULL)');
    this.db.exec("CREATE TABLE IF NOT EXISTS archived_threads (id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS unread_threads (id TEXT PRIMARY KEY,completed_at_ms INTEGER NOT NULL)");
    for(const thread of this.archivedThreads())this.sessionUsage.observeThread(thread);
    this.hiddenThreads = new Set((this.db.prepare("SELECT id FROM hidden_threads").all() as { id: string }[]).map(row => row.id));
    const sqliteState = this.loadSqliteState();
    if (hasState(sqliteState)) {
      this.state = sqliteState;
      for (const event of this.state.events) this.archiveAgentEvent(event);
      this.codexLiveHistory.seed(this.state.events.filter(event=>isThreadConversationEvent(event)||event.type==='turn.started'));
      return;
    }
    const legacyState = await this.loadLegacyJsonState();
    this.state = legacyState ?? emptyState();
    for (const event of this.state.events) this.archiveAgentEvent(event);
    this.codexLiveHistory.seed(this.state.events.filter(event=>isThreadConversationEvent(event)||event.type==='turn.started'));
    await this.save(true);
  }

  get devices(): Device[] {
    return this.state.devices.map(({ tokenHash, ...device }) => ({ ...device }));
  }

  threadReadThrough(threadId:string):number {
    const row=this.db!.prepare('SELECT completed_at_ms FROM thread_read_receipts WHERE thread_id=?').get(threadId) as {completed_at_ms:number}|undefined;
    return row?.completed_at_ms??0;
  }
  threadCompletion(threadId:string):number {
    return (this.db!.prepare('SELECT completed_at_ms FROM thread_completions WHERE thread_id=?').get(threadId) as {completed_at_ms:number}|undefined)?.completed_at_ms??0;
  }
  observeDesktopUnread(threadId:string,unread:boolean):boolean {
    const row=this.db!.prepare('SELECT desktop_unread_seen FROM thread_completions WHERE thread_id=?').get(threadId) as {desktop_unread_seen:number}|undefined;
    if(unread&&row&&!row.desktop_unread_seen)this.db!.prepare('UPDATE thread_completions SET desktop_unread_seen=1 WHERE thread_id=?').run(threadId);
    return !row?.desktop_unread_seen;
  }
  markThreadRead(threadId:string,completedAt:number):number {
    this.db!.prepare('DELETE FROM unread_threads WHERE id=? AND completed_at_ms<=?').run(threadId,completedAt);
    this.db!.prepare('INSERT INTO thread_read_receipts(thread_id,completed_at_ms) VALUES (?,?) ON CONFLICT(thread_id) DO UPDATE SET completed_at_ms=MAX(completed_at_ms,excluded.completed_at_ms)').run(threadId,completedAt);
    return this.threadReadThrough(threadId);
  }

  get threads(): ThreadRecord[] {
    const pins=new Map((this.db!.prepare('SELECT thread_id,pinned_at FROM thread_pins ORDER BY pinned_at,thread_id').all() as {thread_id:string;pinned_at:number}[]).map((row,index)=>[row.thread_id,index+1]));
    return [...this.state.threads,...[...this.transientThreads.values()].map(value=>value.thread)].filter(thread => !this.hiddenThreads.has(thread.id)).map(thread=>pins.has(thread.id)?{...thread,pinnedIndex:pins.get(thread.id)}:thread).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  setThreadPinned(threadId:string,pinned:boolean):void{
    if(pinned)this.db!.prepare('INSERT OR IGNORE INTO thread_pins(thread_id,pinned_at) VALUES (?,?)').run(threadId,Date.now());
    else this.db!.prepare('DELETE FROM thread_pins WHERE thread_id=?').run(threadId);
  }

  readFollowups(): Record<string, unknown>[] {
    return (this.db!.prepare('SELECT payload FROM followups ORDER BY rowid').all() as {payload:string}[]).map(row=>JSON.parse(row.payload));
  }
  private uploadDraftTable(){this.db!.exec('CREATE TABLE IF NOT EXISTS upload_drafts (owner TEXT PRIMARY KEY, payload TEXT NOT NULL)');}
  uploadDrafts():{kind:'image'|'file';id:string}[]{
    this.uploadDraftTable();return (this.db!.prepare('SELECT payload FROM upload_drafts').all() as {payload:string}[]).flatMap(row=>JSON.parse(row.payload));
  }
  setUploadDrafts(owner:string,items:{kind:'image'|'file';id:string}[]){
    this.uploadDraftTable();
    if(!items.length)this.db!.prepare('DELETE FROM upload_drafts WHERE owner=?').run(owner);
    else this.db!.prepare('INSERT INTO upload_drafts(owner,payload) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload').run(owner,JSON.stringify(items));
  }
  addUploadDraft(owner:string,item:{kind:'image'|'file';id:string}){
    this.uploadDraftTable();const row=this.db!.prepare('SELECT payload FROM upload_drafts WHERE owner=?').get(owner) as {payload:string}|undefined;
    const items=row?JSON.parse(row.payload):[];if(!items.some((ref:any)=>ref.kind===item.kind&&ref.id===item.id))items.push(item);this.setUploadDrafts(owner,items);
  }
  readAgentMeta(id:string):any {
    this.db!.exec('CREATE TABLE IF NOT EXISTS agent_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    const row=this.db!.prepare('SELECT payload FROM agent_sessions WHERE id=?').get(id) as {payload:string}|undefined;
    return row?JSON.parse(row.payload):undefined;
  }
  writeAgentMeta(id:string,value:unknown):void {
    this.db!.exec('CREATE TABLE IF NOT EXISTS agent_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    this.db!.prepare('INSERT INTO agent_sessions(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(value));
  }
  writeFollowup(id:string,value:unknown):void {
    this.db!.prepare('INSERT INTO followups(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(value));
  }
  writeFollowupOrder(entries:{id:string}[]):void {
    this.db!.exec('BEGIN');
    try{for(const entry of entries)this.writeFollowup(entry.id,entry);this.db!.exec('COMMIT');}
    catch(error){this.db!.exec('ROLLBACK');throw error;}
  }
  removeFollowup(id:string):void { this.db!.prepare('DELETE FROM followups WHERE id=?').run(id); }

  isThreadHidden(id: string): boolean { return this.hiddenThreads.has(id); }

  get events(): GatewayEvent[] {
    return [...this.state.events];
  }

  get approvals(): PendingApproval[] {
    return [...this.state.approvals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createPairing(): Promise<PairingSession> {
    this.pruneExpiredPairings();
    const now = new Date();
    const pairing: PairingSession = {
      code: createPairingCode(),
      deviceToken: nanoid(40),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    };
    this.state.pairings = this.state.pairings.filter((item) => item.code !== pairing.code);
    this.state.pairings.push(pairing);
    await this.save();
    return pairing;
  }

  async consumePairing(input: { code: string; name?: string; userAgent?: string }): Promise<{ device: Device; token: string }> {
    this.pruneExpiredPairings();
    const code = input.code.trim().toUpperCase();
    const pairing = this.state.pairings.find((item) => item.code === code);
    if (!pairing) {
      throw new Error("配对码无效或已过期");
    }
    this.state.pairings = this.state.pairings.filter((item) => item.code !== code);
    const device = await this.rememberDevice({
      name: input.name,
      userAgent: input.userAgent,
      token: pairing.deviceToken,
    });
    return { device, token: pairing.deviceToken };
  }

  async rememberDevice(input: { name?: string; userAgent?: string; token?: string }): Promise<Device> {
    const now = new Date().toISOString();
    const name = input.name?.trim() || "Android";
    const tokenHash = input.token ? hashToken(input.token) : undefined;
    let device = tokenHash
      ? this.state.devices.find((item) => item.tokenHash === tokenHash)
      : this.state.devices.find((item) => item.name === name && item.userAgent === input.userAgent && !item.revokedAt);
    if (!device) {
      device = {
        id: nanoid(12),
        name,
        userAgent: input.userAgent,
        tokenHash,
        firstSeenAt: now,
        lastSeenAt: now,
      };
      this.state.devices.push(device);
    } else {
      device.name = name;
      device.userAgent = input.userAgent ?? device.userAgent;
      device.tokenHash = tokenHash ?? device.tokenHash;
      device.revokedAt = undefined;
      device.lastSeenAt = now;
    }
    await this.save();
    return publicDevice(device);
  }

  async touchDeviceToken(token: string, input: { name?: string; userAgent?: string } = {}): Promise<Device | null> {
    const tokenHash = hashToken(token);
    const device = this.state.devices.find((item) => item.tokenHash === tokenHash && !item.revokedAt);
    if (!device) {
      return null;
    }
    const next={...device,lastSeenAt:new Date().toISOString(),name:input.name?.trim()||device.name,userAgent:input.userAgent??device.userAgent};
    const sql=this.deviceTouchSql??=this.requireDb().prepare('UPDATE devices SET name=?,user_agent=?,last_seen_at=? WHERE id=? AND token_hash=? AND revoked_at IS NULL');
    if(!sql.run(next.name,next.userAgent??null,next.lastSeenAt,device.id,tokenHash).changes)return null;
    Object.assign(device,next);
    return publicDevice(device);
  }

  async revokeDevice(deviceId: string): Promise<Device> {
    const device = this.state.devices.find((item) => item.id === deviceId);
    if (!device) {
      throw new Error("设备不存在");
    }
    device.revokedAt = new Date().toISOString();
    await this.save();
    return publicDevice(device);
  }

  async rotateDeviceToken(token: string, input: { userAgent?: string } = {}): Promise<{ device: Device; token: string } | null> {
    const tokenHash = hashToken(token);
    const device = this.state.devices.find((item) => item.tokenHash === tokenHash && !item.revokedAt);
    if (!device) {
      return null;
    }
    const nextToken = nanoid(40);
    device.tokenHash = hashToken(nextToken);
    device.userAgent = input.userAgent ?? device.userAgent;
    device.lastSeenAt = new Date().toISOString();
    await this.save();
    return {
      device: publicDevice(device),
      token: nextToken,
    };
  }

  isValidDeviceToken(token: string): boolean {
    const tokenHash = hashToken(token);
    return this.state.devices.some((item) => item.tokenHash === tokenHash && !item.revokedAt);
  }

  certificateForToken(token:string):string|undefined {
    const device=this.state.devices.find(item=>item.tokenHash===hashToken(token)&&!item.revokedAt);
    if(!device)return undefined;
    return (this.requireDb().prepare('SELECT certificate FROM device_certificates WHERE device_id=?').get(device.id) as {certificate:string}|undefined)?.certificate;
  }

  bindDeviceCertificate(deviceId:string,certificate:string):void {
    this.requireDb().prepare('INSERT INTO device_certificates(device_id,certificate) VALUES (?,?) ON CONFLICT(device_id) DO UPDATE SET certificate=excluded.certificate').run(deviceId,certificate);
  }

  async upsertThread(input: { id: string; projectPath?: string; title?: string; status?: ThreadRecord["status"]; source?: ThreadRecord["source"];ephemeral?:boolean;forkedFromId?:string }): Promise<ThreadRecord> {
    const now = new Date().toISOString();
    if(this.closedTransientThreads.has(input.id))return {id:input.id,title:'侧聊已结束',status:'completed',createdAt:now,updatedAt:now,ephemeral:true};
    if(input.ephemeral||this.transientThreads.has(input.id)){
      const previous=this.transientThreads.get(input.id);
      const thread:ThreadRecord={createdAt:now,updatedAt:now,title:'侧聊',status:'idle',...previous?.thread,...Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined)),id:input.id,ephemeral:true};
      thread.updatedAt=now;
      this.transientThreads.set(input.id,{thread,events:previous?.events??[]});
      return thread;
    }
    const previous = this.state.threads.find((item) => item.id === input.id);
    const thread:ThreadRecord = previous ? {
      ...previous,
      source:input.source??previous.source,
      projectPath:input.projectPath??previous.projectPath,
      title:input.title??previous.title,
      status:input.status??previous.status,
      updatedAt:now,
    } : {
        id: input.id,
        source: input.source,
        projectPath: input.projectPath,
        title: input.title ?? "新对话",
        status: input.status ?? "idle",
        createdAt: now,
        updatedAt: now,
      };
    this.saveThread(thread);
    if(previous)Object.assign(previous,thread);else this.state.threads.push(thread);
    return previous??thread;
  }

  async updateThread(id: string, input: { title?: string }): Promise<ThreadRecord> {
    const thread = this.state.threads.find((item) => item.id === id);
    if (!thread) {
      throw new Error("会话不存在");
    }
    const title = input.title?.trim();
    const next={...thread,title:title?title.slice(0,160):thread.title,updatedAt:new Date().toISOString()};
    this.saveThread(next);
    Object.assign(thread,next);
    return thread;
  }

  private saveThread(thread:ThreadRecord):void {
    this.sessionUsage?.observeThread(thread);
    const db=this.requireDb();
    const sql=this.threadSql??={
      upsert:db.prepare(`INSERT INTO threads(id,project_path,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET project_path=excluded.project_path,title=excluded.title,status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at`),
      source:db.prepare('INSERT OR REPLACE INTO thread_sources(thread_id,source) VALUES (?,?)'),
    };
    db.exec('BEGIN IMMEDIATE');
    try{
      sql.upsert.run(thread.id,thread.projectPath??null,thread.title,thread.status,thread.createdAt,thread.updatedAt);
      if(thread.source)sql.source.run(thread.id,thread.source);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }

  manualUnread(threadId:string):number|undefined {
    return (this.db!.prepare('SELECT completed_at_ms FROM unread_threads WHERE id=?').get(threadId) as {completed_at_ms:number}|undefined)?.completed_at_ms;
  }
  markThreadUnread(threadId:string,completedAt:number):void {
    this.db!.prepare('INSERT OR REPLACE INTO unread_threads(id,completed_at_ms) VALUES (?,?)').run(threadId,completedAt);
  }
  archivedThreads():ThreadRecord[]{
    return (this.db!.prepare('SELECT payload FROM archived_threads').all() as {payload:string}[]).map(row=>JSON.parse(row.payload));
  }
  restoreThread(id:string):void {
    this.hiddenThreads.delete(id);
    this.db!.prepare('DELETE FROM hidden_threads WHERE id=?').run(id);
    this.db!.prepare('DELETE FROM archived_threads WHERE id=?').run(id);
  }
  archiveThread(id:string,thread?:ThreadRecord):void {
    if(thread)this.sessionUsage?.observeThread(thread);
    // Preserve local replay/history while excluding this ID from every sidebar
    // refresh, including a still-cached desktop family snapshot.
    this.hiddenThreads.add(id);
    this.requireDb().prepare("INSERT OR IGNORE INTO hidden_threads (id) VALUES (?)").run(id);
    if(thread)this.db!.prepare('INSERT OR REPLACE INTO archived_threads(id,payload) VALUES (?,?)').run(id,JSON.stringify(thread));
  }

  closeSubagents(threads:ThreadRecord[]):void {
    // This records a reversible gateway dismissal, never a Desktop archive.
    const db=this.requireDb();
    db.exec('BEGIN');
    try{
      for(const thread of threads){
        this.sessionUsage?.observeThread(thread);
        db.prepare('INSERT OR IGNORE INTO hidden_threads(id) VALUES (?)').run(thread.id);
        db.prepare('INSERT OR REPLACE INTO archived_threads(id,payload) VALUES (?,?)').run(thread.id,JSON.stringify({...thread,closureKind:'gatewayClosed'}));
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    for(const thread of threads)this.hiddenThreads.add(thread.id);
  }

  async deleteThread(id: string): Promise<void> {
    this.hiddenThreads.add(id);
    this.requireDb().prepare("INSERT OR IGNORE INTO hidden_threads (id) VALUES (?)").run(id);
    this.state.threads = this.state.threads.filter((item) => item.id !== id);
    this.state.events = this.state.events.filter((event) => !("threadId" in event) || event.threadId !== id);
    this.codexLiveHistory?.remove(id);
    this.state.approvals = this.state.approvals.filter((approval) => approval.threadId !== id);
    await this.save(true);
  }

  async removeTurnEvents(threadId:string,turnId:string):Promise<void>{
    const live=this.codexLiveHistory?.read(threadId)||[];
    const events=[...this.state.events,...live].filter(event=>'threadId' in event&&event.threadId===threadId);
    const owned=events.filter(event=>'turnId' in event&&event.turnId===turnId);
    const fallback=events.filter(event=>event.type==='user.message').at(-1);
    const cutoff=owned.map(event=>event.createdAt).filter((at):at is string=>Boolean(at)).sort()[0]||fallback?.createdAt;
    const removed=(event:GatewayEvent)=>'threadId' in event&&event.threadId===threadId&&
      ('turnId' in event&&event.turnId===turnId||Boolean(cutoff&&event.createdAt&&event.createdAt>=cutoff));
    this.state.events=this.state.events.filter(event=>!removed(event));
    this.codexLiveHistory?.remove(threadId);
    for(const event of live.filter(event=>!removed(event)))this.codexLiveHistory?.append(event);
    this.requireDb().prepare("DELETE FROM events WHERE thread_id=? AND (json_extract(payload,'$.turnId')=? OR json_extract(payload,'$.createdAt')>=?)")
      .run(threadId,turnId,cutoff??null);
    await this.save(true);
  }

  async addApproval(input: Omit<PendingApproval, "status" | "createdAt">): Promise<PendingApproval> {
    const approval: PendingApproval = {
      ...input,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.saveApprovals([approval]);
    this.state.approvals = this.state.approvals.filter((item) => item.id !== approval.id);
    this.state.approvals.push(approval);
    return approval;
  }

  async resolveApproval(id: string, decision: "accept" | "decline"): Promise<PendingApproval> {
    const approval = this.state.approvals.find((item) => item.id === id);
    if (!approval) {
      throw new Error("审批不存在");
    }
    if (approval.status !== "pending") throw new Error("审批已经处理，请刷新状态");
    const next:PendingApproval={...approval,status:decision==="accept"?"accepted":"declined",resolvedAt:new Date().toISOString()};
    this.saveApprovals([next]);
    Object.assign(approval,next);
    return approval;
  }

  async expirePendingApprovals(keep?: (approval: PendingApproval) => boolean): Promise<void> {
    const pending = this.state.approvals.filter(approval => approval.status === "pending" && !keep?.(approval));
    if (!pending.length) return;
    const next=pending.map(approval=>({...approval,status:"expired" as const,resolvedAt:new Date().toISOString()}));
    this.saveApprovals(next);
    pending.forEach((approval,index)=>Object.assign(approval,next[index]));
  }

  async expireApproval(id:string):Promise<void> {
    const approval=this.state.approvals.find(a=>a.id===id&&a.status==='pending');
    if(approval){
      const next:PendingApproval={...approval,status:'expired',resolvedAt:new Date().toISOString()};
      this.saveApprovals([next]);Object.assign(approval,next);
    }
  }

  private saveApprovals(approvals:readonly PendingApproval[]):void {
    const db=this.requireDb();
    const sql=this.approvalSql??=db.prepare(`INSERT INTO approvals(id,rpc_id,method,thread_id,turn_id,item_id,approval_id,approval_type,title,detail,status,created_at,resolved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET rpc_id=excluded.rpc_id,method=excluded.method,thread_id=excluded.thread_id,turn_id=excluded.turn_id,item_id=excluded.item_id,
      approval_id=excluded.approval_id,approval_type=excluded.approval_type,title=excluded.title,detail=excluded.detail,status=excluded.status,created_at=excluded.created_at,resolved_at=excluded.resolved_at`);
    db.exec('BEGIN IMMEDIATE');
    try{
      for(const approval of approvals)sql.run(approval.id,JSON.stringify(approval.rpcId),approval.method,approval.threadId,approval.turnId??null,approval.itemId??null,approval.approvalId??null,
        approval.approvalType,approval.title,approval.detail??null,approval.status,approval.createdAt,approval.resolvedAt??null);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }

  async appendEvent(event: GatewayEvent): Promise<void> {
    if('threadId' in event&&this.closedTransientThreads.has(event.threadId??''))return;
    const transient='threadId' in event?this.transientThreads.get(event.threadId??''):undefined;
    if(transient){
      const previous=transient.events.at(-1);
      if((event.type==='message.delta'||event.type==='reasoning.summary')&&previous?.type===event.type&&previous.itemId===event.itemId&&previous.turnId===event.turnId){
        transient.events[transient.events.length-1]={...previous,eventId:event.eventId,createdAt:event.createdAt??previous.createdAt,text:previous.text+event.text};
      }else transient.events.push(event);
      if(transient.events.length>maxEvents)transient.events.splice(0,transient.events.length-maxEvents);
      return;
    }
    const payload=JSON.stringify(event);
    const db=this.requireDb(),sql=this.eventWrites();
    // Commit history and replay together before exposing the event in memory.
    db.exec('BEGIN IMMEDIATE');
    try{
      this.archiveAgentEvent(event,payload);
      this.archiveCodexEvent(event,payload);
      if(event.type==='turn.completed'&&event.status==='completed'){
        const at=Date.parse(event.createdAt||'');
        if(at>0)db.prepare('INSERT INTO thread_completions(thread_id,completed_at_ms) VALUES (?,?) ON CONFLICT(thread_id) DO UPDATE SET completed_at_ms=excluded.completed_at_ms,desktop_unread_seen=0 WHERE excluded.completed_at_ms>completed_at_ms').run(event.threadId,at);
      }
      sql.insert.run(event.type, "threadId" in event ? event.threadId ?? null : null, payload);
      // Delete the expired prefix by primary key without scanning retained payloads.
      sql.trim.run(maxEvents);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    this.state.events.push(event);
    if (this.state.events.length > maxEvents) {
      this.state.events.splice(0, this.state.events.length - maxEvents);
    }
  }

  private eventWrites(){
    const db=this.requireDb();
    return this.eventSql??={
      insert:db.prepare("INSERT INTO events (type, thread_id, payload) VALUES (?, ?, ?)"),
      trim:db.prepare("DELETE FROM events WHERE seq <= (SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?)"),
      archiveAgent:db.prepare("INSERT OR IGNORE INTO agent_history (event_key, thread_id, payload) VALUES (?, ?, ?)"),
    };
  }

  recentEventsForThread(threadId:string):GatewayEvent[]{
    return this.transientThreads.get(threadId)?.events.slice()??this.state.events.filter(event=>'threadId' in event&&event.threadId===threadId&&isThreadConversationEvent(event));
  }

  async readThreadEvents(threadId:string,deferred:boolean|'live'=false,signal?:AbortSignal):Promise<GatewayEvent[]>{
    if(this.transientThreads.has(threadId))return this.eventsForThread(threadId,1000);
    const complete=await readStoredThreadEvents(threadId,deferred,signal);
    const recent=this.recentEventsForThread(threadId);
    const additions=deferred?confirmedToolChanges(recent.filter(isVisibleMobileThreadEvent)).map(event=>(deferred==='live'?deferLiveActivityDetails(event):deferMobileActivityDetails(event)) as GatewayEvent):recent;
    return this.mergeThreadEvents(additions,complete);
  }

  eventsForThread(threadId: string, limit = 200): GatewayEvent[] {
    const transient=this.transientThreads.get(threadId);
    if(transient)return transient.events.slice(-limit).map(event=>event.type==='message.delta'||event.type==='reasoning.summary'?{...event,eventId:`history:side:${event.eventId}`,textComplete:true}:event);
    if (/^(antigravity|claude|grok|deepseek|hermes|opencode|zcode|pi|acp)-/.test(threadId)) {
      // External CLIs have no Codex rollout reader. Their transcript must outlive
      // both the reconnect ring and unrelated threads producing streaming events.
      this.requireDb();
      return this.parsedHistory!.read('agent_history',threadId);
    }
    const recent=this.state.events
      .filter((event) => "threadId" in event && event.threadId === threadId)
      .filter(isThreadConversationEvent)
      .slice(-limit);
    const complete=this.codexLiveHistory?.read(threadId);
    return this.mergeThreadEvents(recent,complete??[]);
  }

  private mergeThreadEvents(recent:GatewayEvent[],complete:GatewayEvent[]):GatewayEvent[]{
    if(!complete?.length)return recent;
    // The disk window protects whole replies, while the existing ring may still
    // contain earlier upload IDs or live operation IDs needed by cached pages.
    const ids=new Set(complete.map(event=>event.eventId).filter(Boolean));
    const diffTurns=new Set(complete.flatMap(event=>event.type==='diff.updated'&&event.turnId?[event.turnId]:[]));
      const times=new Map<string,number>();
      const at=(event:GatewayEvent)=>{
        const value=event.createdAt||'',known=times.get(value);
        if(known!==undefined)return known;
        const parsed=Date.parse(value)||0;times.set(value,parsed);return parsed;
      };
    return [...recent.filter(event=>(!event.eventId||!ids.has(event.eventId))&&
        !(event.type==='diff.updated'&&event.turnId&&diffTurns.has(event.turnId))),...complete]
        .sort((a,b)=>at(a)-at(b));
  }

  eventsForIds(threadId:string,ids:readonly string[]):GatewayEvent[] {
    const wanted=new Set(ids),found=new Map(this.state.events.filter(event=>'threadId' in event&&event.threadId===threadId&&event.eventId&&wanted.has(event.eventId)).map(event=>[event.eventId!,event]));
    const table=/^(antigravity|claude|grok|deepseek|hermes|opencode|zcode|pi|acp)-/.test(threadId)?'agent_history':'codex_live_events';
    const read=this.requireDb().prepare(`SELECT payload FROM ${table} WHERE event_key=? AND thread_id=?`);
    for(const id of wanted)if(!found.has(id)){
      const row=read.get(id,threadId) as EventRow|undefined;if(row)found.set(id,JSON.parse(row.payload) as GatewayEvent);
    }
    return ids.flatMap(id=>found.has(id)?[found.get(id)!]:[]);
  }

  private archiveCodexEvent(event:GatewayEvent,payload?:string):void {
    if('threadId' in event&&event.threadId&&this.hiddenThreads.has(event.threadId))return;
    if(isThreadConversationEvent(event)||event.type==='turn.started')this.codexLiveHistory?.append(event,payload);
  }

  private archiveAgentEvent(event: GatewayEvent,encoded?:string): void {
    if (!("threadId" in event) || !event.threadId || !/^(antigravity|claude|grok|deepseek|hermes|opencode|zcode|pi|acp)-/.test(event.threadId) ||
        !(isThreadConversationEvent(event) || event.type === 'turn.started')) return;
    const payload = encoded??JSON.stringify(event);
    const inserted=this.eventWrites().archiveAgent.run(event.eventId || payload, event.threadId, payload);
    if(inserted.changes)this.parsedHistory?.markDirty('agent_history',event.threadId);
  }

  searchMessageEvents(query: string, limit = 200): GatewayEvent[] {
    const db = this.requireDb();
    const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const rows = db
      .prepare(
        "SELECT payload FROM events WHERE thread_id IS NOT NULL AND type IN ('user.message','message.delta') AND json_extract(payload, '$.text') LIKE ? ESCAPE '\\' ORDER BY seq DESC LIMIT ?",
      )
      .all(`%${escaped}%`, limit) as { payload: string }[];
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.payload) as GatewayEvent];
      } catch {
        return [];
      }
    });
  }

  terminalEvents(limit = 500): GatewayEvent[] {
    return this.state.events
      .filter((event) => event.type === "terminal.output")
      .slice(-limit);
  }

  terminalCommands(limit = 100, options: { includeOutput?: boolean; previewChars?: number } = {}): TerminalCommandHistory[] {
    const includeOutput = options.includeOutput ?? true;
    const previewChars = Math.max(0, Math.min(options.previewChars ?? 8000, 100000));
    return [...this.aggregateTerminalCommands().values()].reverse().slice(0, limit).map((record) => {
      const outputLength = record.output.length;
      const stdoutLength = record.stdout.length;
      const stderrLength = record.stderr.length;
      const outputOffset = includeOutput ? 0 : Math.max(0, outputLength - previewChars);
      const output = includeOutput ? record.output : record.output.slice(outputOffset);
      return {
        ...record,
        stdout: includeOutput ? record.stdout : "",
        stderr: includeOutput ? record.stderr : "",
        output,
        stdoutLength,
        stderrLength,
        outputLength,
        outputOffset,
        outputEnd: outputOffset + output.length,
        outputTruncated: !includeOutput && outputOffset > 0,
      };
    });
  }

  terminalCommandOutput(commandId: string, options: { offset?: number; limit?: number; stream?: "stdout" | "stderr" | "combined" } = {}): TerminalCommandOutputPage {
    const record = this.aggregateTerminalCommands().get(commandId);
    if (!record) {
      throw new Error("终端命令不存在");
    }
    const stream = options.stream ?? "combined";
    const source = stream === "stdout" ? record.stdout : stream === "stderr" ? record.stderr : record.output;
    const limit = Math.max(1, Math.min(options.limit ?? 16000, 100000));
    const offset = Math.max(0, Math.min(options.offset ?? Math.max(0, source.length - limit), source.length));
    const end = Math.min(source.length, offset + limit);
    return {
      commandId,
      threadId: record.threadId,
      stream,
      offset,
      end,
      limit,
      totalLength: source.length,
      text: source.slice(offset, end),
      hasMoreBefore: offset > 0,
      hasMoreAfter: end < source.length,
    };
  }

  async closeDanglingTerminalCommands(reason = "Gateway 已重启，原终端进程已关闭"): Promise<number> {
    const now = new Date().toISOString();
    const dangling = [...this.aggregateTerminalCommands().values()].filter((record) => record.status === "running");
    for (const record of dangling) {
      this.state.events.push({
        type: "terminal.output",
        threadId: record.threadId,
        commandId: record.commandId,
        stream: "stderr",
        text: `\n[${reason}]\n`,
        status: "stopped",
        cwd: record.cwd,
        command: record.command,
        createdAt: now,
      });
    }
    if (this.state.events.length > maxEvents) {
      this.state.events.splice(0, this.state.events.length - maxEvents);
    }
    if (dangling.length > 0) {
      await this.save(true);
    }
    return dangling.length;
  }

  close(): void {
    this.sessionUsage=null;
    this.db?.close();
    this.db = null;
    this.parsedHistory=null;this.codexLiveHistory=null;
    this.eventSql=null;
    this.threadSql=null;
    this.deviceTouchSql=null;this.approvalSql=null;
  }

  private initSchema(): void {
    this.db!.exec('CREATE TABLE IF NOT EXISTS followups (id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
    const db = this.requireDb();
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        token_hash TEXT,
        revoked_at TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);
      CREATE TABLE IF NOT EXISTS device_certificates (device_id TEXT PRIMARY KEY, certificate TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pairings (
        code TEXT PRIMARY KEY,
        device_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_path TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hidden_threads (id TEXT PRIMARY KEY);
      CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        rpc_id TEXT NOT NULL,
        method TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        item_id TEXT,
        approval_id TEXT,
        approval_type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_created_at ON approvals(created_at);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        thread_id TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_thread_id ON events(thread_id);
      CREATE TABLE IF NOT EXISTS agent_history (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL UNIQUE,
        thread_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_history_thread_seq ON agent_history(thread_id, seq);
    `);
  }

  private loadSqliteState(): PersistentState {
    const db = this.requireDb();
    const devices = db.prepare("SELECT * FROM devices ORDER BY first_seen_at").all() as DeviceRow[];
    const pairings = db.prepare("SELECT * FROM pairings ORDER BY created_at").all() as PairingRow[];
    const threads = db.prepare("SELECT * FROM threads ORDER BY updated_at").all() as ThreadRow[];
    const approvals = db.prepare("SELECT * FROM approvals ORDER BY created_at").all() as ApprovalRow[];
    const events = db.prepare("SELECT payload FROM events ORDER BY seq").all() as EventRow[];
    return {
      devices: devices.map(rowToDevice),
      pairings: pairings.map(rowToPairing),
      threads: threads.map(row=>{const thread=rowToThread(row);const metadata=db.prepare("SELECT source FROM thread_sources WHERE thread_id=?").get(row.id) as {source:ThreadRecord["source"]}|undefined;return metadata?{...thread,source:metadata.source}:thread;}),
      approvals: approvals.map(rowToApproval),
      events: events.map((row) => JSON.parse(row.payload) as GatewayEvent),
    };
  }

  private async loadLegacyJsonState(): Promise<PersistentState | null> {
    try {
      const raw = await fs.readFile(legacyJsonPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistentState>;
      return normalizeState(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async save(replaceEvents=false): Promise<void> {
    const db = this.requireDb();
    const state = this.state;
    const rememberSource=db.prepare("INSERT OR REPLACE INTO thread_sources (thread_id,source) VALUES (?,?)");
    for(const thread of state.threads)if(thread.source)rememberSource.run(thread.id,thread.source);
    const insertDevice = db.prepare(`
      INSERT INTO devices (id, name, first_seen_at, last_seen_at, token_hash, revoked_at, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPairing = db.prepare(`
      INSERT INTO pairings (code, device_token, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const insertThread = db.prepare(`
      INSERT INTO threads (id, project_path, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertApproval = db.prepare(`
      INSERT INTO approvals (id, rpc_id, method, thread_id, turn_id, item_id, approval_id, approval_type, title, detail, status, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Streaming events are already committed by appendEvent. Replace replay
    // only when importing or explicitly changing the in-memory history.
    const insertEvent = replaceEvents?this.eventWrites().insert:null;

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM devices; DELETE FROM pairings; DELETE FROM threads; DELETE FROM approvals;");
      if(insertEvent)db.exec("DELETE FROM events;");
      for (const device of state.devices) {
        insertDevice.run(
          device.id,
          device.name,
          device.firstSeenAt,
          device.lastSeenAt,
          device.tokenHash ?? null,
          device.revokedAt ?? null,
          device.userAgent ?? null,
        );
      }
      for (const pairing of state.pairings) {
        insertPairing.run(pairing.code, pairing.deviceToken, pairing.expiresAt, pairing.createdAt);
      }
      for (const thread of state.threads) {
        insertThread.run(thread.id, thread.projectPath ?? null, thread.title, thread.status, thread.createdAt, thread.updatedAt);
      }
      for (const approval of state.approvals) {
        insertApproval.run(
          approval.id,
          JSON.stringify(approval.rpcId),
          approval.method,
          approval.threadId,
          approval.turnId ?? null,
          approval.itemId ?? null,
          approval.approvalId ?? null,
          approval.approvalType,
          approval.title,
          approval.detail ?? null,
          approval.status,
          approval.createdAt,
          approval.resolvedAt ?? null,
        );
      }
      if(insertEvent)for (const event of state.events) {
        insertEvent.run(event.type, "threadId" in event ? event.threadId ?? null : null, JSON.stringify(event));
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private pruneExpiredPairings(): void {
    const now = Date.now();
    this.state.pairings = this.state.pairings.filter((item) => Date.parse(item.expiresAt) > now);
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("StateStore 未加载");
    }
    return this.db;
  }

  private aggregateTerminalCommands(): Map<string, TerminalCommandHistory> {
    const grouped = new Map<string, TerminalCommandHistory>();
    for (const event of this.state.events) {
      if (event.type !== "terminal.output" || !event.threadId.startsWith("terminal:")) {
        continue;
      }
      const commandId = event.commandId ?? event.threadId.slice("terminal:".length);
      const existing = grouped.get(commandId);
      const createdAt = event.createdAt ?? existing?.startedAt ?? "";
      const record = existing ?? {
        commandId,
        threadId: event.threadId,
        cwd: undefined,
        command: undefined,
        status: "unknown",
        startedAt: createdAt,
        endedAt: undefined,
        stdout: "",
        stderr: "",
        output: "",
        chunks: 0,
      };
      record.cwd = event.cwd ?? record.cwd;
      record.command = event.command ?? record.command;
      record.status = statusFromEvent(event, record.status);
      record.startedAt = record.startedAt || createdAt;
      if (isTerminalFinalStatus(record.status)) {
        record.endedAt = event.createdAt ?? record.endedAt;
      }
      if (event.stream === "stderr") {
        record.stderr += event.text;
      } else {
        record.stdout += event.text;
      }
      record.output += event.text;
      record.chunks += 1;
      grouped.set(commandId, record);
    }
    return grouped;
  }
}

export function stateStorePath(): string {
  return sqlitePath;
}

export function legacyStateStorePath(): string {
  return legacyJsonPath;
}

function emptyState(): PersistentState {
  return {
    devices: [],
    pairings: [],
    approvals: [],
    threads: [],
    events: [],
  };
}

function normalizeState(parsed: Partial<PersistentState>): PersistentState {
  return {
    devices: parsed.devices ?? [],
    pairings: parsed.pairings ?? [],
    approvals: parsed.approvals ?? [],
    threads: parsed.threads ?? [],
    events: parsed.events ?? [],
  };
}

function hasState(state: PersistentState): boolean {
  return state.devices.length > 0 ||
    state.pairings.length > 0 ||
    state.approvals.length > 0 ||
    state.threads.length > 0 ||
    state.events.length > 0;
}

function isThreadConversationEvent(event: GatewayEvent): boolean {
  return event.type === 'tool.started' || event.type === 'tool.output' || event.type === 'tool.completed' || event.type === "reasoning.summary" || event.type === "plan.updated" || event.type === "thread.started" ||
    event.type === "user.message" ||
    event.type === "message.delta" ||
    event.type === "approval.requested" ||
    event.type === "file.changed" ||
    event.type === "diff.updated" ||
    event.type === "warning" ||
    event.type === "error" ||
    event.type === "turn.started" || event.type === "turn.completed";
}

function statusFromEvent(event: Extract<GatewayEvent, { type: "terminal.output" }>, current: TerminalCommandHistory["status"]): TerminalCommandHistory["status"] {
  if (event.status) {
    return event.status;
  }
  if (event.text.includes("[stopped]") || event.text.includes("已请求停止命令")) {
    return "stopped";
  }
  if (event.text.includes("已终止")) {
    return "timeout";
  }
  if (event.text.includes("[启动失败]") || event.text.includes("[signal ") || event.text.includes("[exit 1]")) {
    return "error";
  }
  if (event.text.includes("[exit 0]")) {
    return "completed";
  }
  return current === "unknown" ? "running" : current;
}

function isTerminalFinalStatus(status: TerminalCommandHistory["status"]): boolean {
  return status === "completed" || status === "stopped" || status === "error" || status === "timeout";
}

function publicDevice(device: Device): Device {
  const { tokenHash: _tokenHash, ...publicRecord } = device;
  return publicRecord;
}

function rowToDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    tokenHash: row.token_hash ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    userAgent: row.user_agent ?? undefined,
  };
}

function rowToPairing(row: PairingRow): PairingSession {
  return {
    code: row.code,
    deviceToken: row.device_token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function rowToThread(row: ThreadRow): ThreadRecord {
  return {
    id: row.id,
    projectPath: row.project_path ?? undefined,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToApproval(row: ApprovalRow): PendingApproval {
  return {
    id: row.id,
    rpcId: JSON.parse(row.rpc_id) as number | string,
    method: row.method,
    threadId: row.thread_id,
    turnId: row.turn_id ?? undefined,
    itemId: row.item_id ?? undefined,
    approvalId: row.approval_id ?? undefined,
    approvalType: row.approval_type,
    title: row.title,
    detail: row.detail ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return code;
}
