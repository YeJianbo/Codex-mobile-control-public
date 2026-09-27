export type Project = {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
};

export type ProjectRoot = {
  path: string;
  name: string;
  exists: boolean;
};

export type ControlSettings = {
  model?: string;
  modelProvider?: string;
  providerBaseUrl?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  reasoningEffort?: string;
  networkAccess?: boolean;
  disableResponseStorage?: boolean;
};

export type ApprovalPolicySummary = {
  approvalPolicy: string;
  approvalLabel: string;
  approvalRisk: "low" | "medium" | "high" | "unknown";
  sandboxMode: string;
  sandboxLabel: string;
  networkAccess: boolean;
  summary: string;
  recommendation: string;
};

export type ServerConfig = {
  host: string;
  port: number;
  token: string;
  projectRoots: string[];
  https?: {
    enabled: boolean;
    certPath?: string;
    keyPath?: string;
  };
};

export type Device = {
  id: string;
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
  tokenHash?: string;
  revokedAt?: string;
  userAgent?: string;
};

export type PairingSession = {
  code: string;
  deviceToken: string;
  expiresAt: string;
  createdAt: string;
};

export type ThreadRecord = {
  pinnedIndex?:number;
  goal?:import('./services/codexGoals.js').CodexGoal;
  id: string;
  projectPath?: string;
  title: string;
  status: "idle" | "running" | "completed" | "error" | "interrupted";
  createdAt: string;
  updatedAt: string;
};

export type PendingApproval = {
  id: string;
  rpcId: number | string;
  method: string;
  threadId: string;
  turnId?: string;
  itemId?: string;
  approvalId?: string;
  approvalType: "command" | "file" | "permission" | "question";
  title: string;
  detail?: string;
  status: "pending" | "accepted" | "declined" | "expired";
  createdAt: string;
  resolvedAt?: string;
};

export type FileEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
};

export type DiffFileEntry = {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged" | "accepted" | "unknown";
  additions?: number;
  deletions?: number;
};

export type DiffHunk = {
  id: string;
  index: number;
  source: "worktree" | "staged";
  header: string;
  text: string;
};

export type TerminalCommandHistory = {
  commandId: string;
  threadId: string;
  cwd?: string;
  command?: string;
  status: "running" | "completed" | "stopped" | "error" | "timeout" | "unknown";
  startedAt: string;
  endedAt?: string;
  stdout: string;
  stderr: string;
  output: string;
  stdoutLength?: number;
  stderrLength?: number;
  outputLength?: number;
  outputOffset?: number;
  outputEnd?: number;
  outputTruncated?: boolean;
  chunks: number;
};

export type TerminalCommandOutputPage = {
  commandId: string;
  threadId: string;
  stream: "stdout" | "stderr" | "combined";
  offset: number;
  end: number;
  limit: number;
  totalLength: number;
  text: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};

export type GatewayEvent = (
  | { type: "connected"; serverVersion: string; protocolVersion?: number; minAndroidProtocolVersion?: number; capabilities?: string[] }
  | { type: "project.changed"; project: Project }
  | { type: "projects.changed" }
  | { type: "thread.started"; threadId: string; thread?: ThreadRecord }
  | { type: "user.message"; threadId: string; text: string; images?:{id:string;name:string}[]; files?:{id:string;name:string;mime:string;size:number}[]; attachments?:{name:string;path:string;url?:string}[]; userVisible?:true; questionReplyId?:string }
  | { type: "reasoning.summary"; threadId:string; turnId?:string; itemId?:string; text:string }
  | { type: "context.compaction"; threadId:string; itemId?:string; title:string; status:"running"|"ok"|"error"|"cancelled" }
  | { type: "plan.updated"; threadId:string; turnId?:string; title:string; text:string }
  | { type: "message.delta"; threadId: string; text: string; itemId?: string; turnId?: string }
  | { type: "terminal.output"; threadId: string; stream: "stdout" | "stderr"; text: string; commandId?: string; cwd?: string; command?: string; status?: TerminalCommandHistory["status"]; createdAt?: string }
  | { type: "tool.started"; threadId: string; itemId?: string; title: string; detail?: string }
  | { type: "tool.output"; threadId: string; itemId?: string; text: string }
  | { type: "tool.completed"; threadId: string; itemId?: string; status: "ok" | "error" | "cancelled"; detail?: string }
  | { type: "approval.requested"; threadId: string; turnId?: string; itemId?: string; approvalId?: string; approvalType: "command" | "file" | "permission" | "question" | "desktop"; title: string; detail?: string }
  | { type: "approval.resolved"; threadId: string; approvalId: string; decision: "accept" | "decline" }
  | { type: "file.changed"; threadId: string; turnId?: string; itemId?: string; files: string[]; summary?: string }
  | { type: "diff.updated"; threadId: string; turnId?: string; diff: string }
  | { type: "warning"; threadId?: string; title: string; detail?: string }
  | { type: "codex.status"; status: "running" | "stopped" | "error"; detail?: string }
  | { type: "turn.completed"; threadId: string; status: string }
  | { type: "turn.started"; threadId: string; turnId?:string }
  | { type: "error"; threadId?: string; message: string }
) & { eventId?: string; createdAt?: string; requestId?: string; replayed?: boolean };

export type PersistentState = {
  devices: Device[];
  pairings: PairingSession[];
  approvals: PendingApproval[];
  threads: ThreadRecord[];
  events: GatewayEvent[];
};
