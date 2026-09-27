import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { nanoid } from "nanoid";
import type { Device, GatewayEvent, PairingSession, PendingApproval, PersistentState, TerminalCommandHistory, TerminalCommandOutputPage, ThreadRecord } from "../types.js";
import { appHome } from "./paths.js";

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
  private state: PersistentState = emptyState();
  private db: DatabaseSync | null = null;
  private hiddenThreads = new Set<string>();

  async load(): Promise<void> {
    await fs.mkdir(appHome(), { recursive: true });
    this.db = new DatabaseSync(sqlitePath);
    this.initSchema();
    this.hiddenThreads = new Set((this.db.prepare("SELECT id FROM hidden_threads").all() as { id: string }[]).map(row => row.id));
    const sqliteState = this.loadSqliteState();
    if (hasState(sqliteState)) {
      this.state = sqliteState;
      return;
    }
    const legacyState = await this.loadLegacyJsonState();
    this.state = legacyState ?? emptyState();
    await this.save();
  }

  get devices(): Device[] {
    return this.state.devices.map(({ tokenHash, ...device }) => ({ ...device }));
  }

  get threads(): ThreadRecord[] {
    return this.state.threads.filter(thread => !this.hiddenThreads.has(thread.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  readFollowups(): Record<string, unknown>[] {
    return (this.db!.prepare('SELECT payload FROM followups ORDER BY rowid').all() as {payload:string}[]).map(row=>JSON.parse(row.payload));
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
    device.lastSeenAt = new Date().toISOString();
    device.name = input.name?.trim() || device.name;
    device.userAgent = input.userAgent ?? device.userAgent;
    await this.save();
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

  async upsertThread(input: { id: string; projectPath?: string; title?: string; status?: ThreadRecord["status"] }): Promise<ThreadRecord> {
    const now = new Date().toISOString();
    let thread = this.state.threads.find((item) => item.id === input.id);
    if (!thread) {
      thread = {
        id: input.id,
        projectPath: input.projectPath,
        title: input.title ?? "新对话",
        status: input.status ?? "idle",
        createdAt: now,
        updatedAt: now,
      };
      this.state.threads.push(thread);
    } else {
      thread.projectPath = input.projectPath ?? thread.projectPath;
      thread.title = input.title ?? thread.title;
      thread.status = input.status ?? thread.status;
      thread.updatedAt = now;
    }
    await this.save();
    return thread;
  }

  async updateThread(id: string, input: { title?: string }): Promise<ThreadRecord> {
    const thread = this.state.threads.find((item) => item.id === id);
    if (!thread) {
      throw new Error("会话不存在");
    }
    const title = input.title?.trim();
    if (title) {
      thread.title = title.slice(0, 160);
    }
    thread.updatedAt = new Date().toISOString();
    await this.save();
    return thread;
  }

  async deleteThread(id: string): Promise<void> {
    this.hiddenThreads.add(id);
    this.requireDb().prepare("INSERT OR IGNORE INTO hidden_threads (id) VALUES (?)").run(id);
    this.state.threads = this.state.threads.filter((item) => item.id !== id);
    this.state.events = this.state.events.filter((event) => !("threadId" in event) || event.threadId !== id);
    this.state.approvals = this.state.approvals.filter((approval) => approval.threadId !== id);
    await this.save();
  }

  async addApproval(input: Omit<PendingApproval, "status" | "createdAt">): Promise<PendingApproval> {
    const approval: PendingApproval = {
      ...input,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.state.approvals = this.state.approvals.filter((item) => item.id !== approval.id);
    this.state.approvals.push(approval);
    await this.save();
    return approval;
  }

  async resolveApproval(id: string, decision: "accept" | "decline"): Promise<PendingApproval> {
    const approval = this.state.approvals.find((item) => item.id === id);
    if (!approval) {
      throw new Error("审批不存在");
    }
    if (approval.status !== "pending") throw new Error("审批已经处理，请刷新状态");
    approval.status = decision === "accept" ? "accepted" : "declined";
    approval.resolvedAt = new Date().toISOString();
    await this.save();
    return approval;
  }

  async expirePendingApprovals(): Promise<void> {
    const pending = this.state.approvals.filter(approval => approval.status === "pending");
    if (!pending.length) return;
    for (const approval of pending) { approval.status = "expired"; approval.resolvedAt = new Date().toISOString(); }
    await this.save();
  }

  async expireApproval(id:string):Promise<void> {
    const approval=this.state.approvals.find(a=>a.id===id&&a.status==='pending');
    if(approval){approval.status='expired';approval.resolvedAt=new Date().toISOString();await this.save();}
  }

  async appendEvent(event: GatewayEvent): Promise<void> {
    this.state.events.push(event);
    if (this.state.events.length > maxEvents) {
      this.state.events.splice(0, this.state.events.length - maxEvents);
    }
    const db = this.requireDb();
    db.prepare("INSERT INTO events (type, thread_id, payload) VALUES (?, ?, ?)")
      .run(event.type, "threadId" in event ? event.threadId ?? null : null, JSON.stringify(event));
    db.prepare("DELETE FROM events WHERE seq NOT IN (SELECT seq FROM events ORDER BY seq DESC LIMIT ?)").run(maxEvents);
  }

  eventsForThread(threadId: string, limit = 200): GatewayEvent[] {
    return this.state.events
      .filter((event) => "threadId" in event && event.threadId === threadId)
      .filter(isThreadConversationEvent)
      .slice(-limit);
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
      await this.save();
    }
    return dangling.length;
  }

  close(): void {
    this.db?.close();
    this.db = null;
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
      threads: threads.map(rowToThread),
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

  private async save(): Promise<void> {
    const db = this.requireDb();
    const state = this.state;
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
    const insertEvent = db.prepare("INSERT INTO events (type, thread_id, payload) VALUES (?, ?, ?)");

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM devices; DELETE FROM pairings; DELETE FROM threads; DELETE FROM approvals; DELETE FROM events;");
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
      for (const event of state.events) {
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
    event.type === "turn.completed";
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

