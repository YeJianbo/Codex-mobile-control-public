import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { Writable } from "node:stream";
import path from "node:path";
import { nanoid } from "nanoid";
import { spawn as spawnPty, type IPty as PtyProcess } from "node-pty";
import type { GatewayEvent, ServerConfig, TerminalCommandHistory } from "../types.js";
import type { EventHub } from "./eventHub.js";
import { listProjects } from "./projects.js";

const maxCommandLength = 2000;
const maxRuntimeMs = 10 * 60 * 1000;
const defaultTerminalCols = 100;
const defaultTerminalRows = 28;

type TerminalSession = {
  commandId: string;
  threadId: string;
  child: LocalTerminalProcess;
  timeout: NodeJS.Timeout;
  stopping: boolean;
};

type LocalTerminalProcess = ChildProcessByStdio<null, Readable, Readable>;
type InteractiveTerminalSession = {
  sessionId: string;
  threadId: string;
  child: PtyProcess;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  stopping: boolean;
  writeReadyAt: number;
};

export class LocalTerminal {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly interactiveSessions = new Map<string, InteractiveTerminalSession>();

  constructor(
    private readonly config: ServerConfig,
    private readonly hub: EventHub,
  ) {}

  async runCommand(projectId: string, command: string): Promise<{ commandId: string; threadId: string; cwd: string; command: string }> {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) {
      throw new Error("命令不能为空");
    }
    if (normalizedCommand.length > maxCommandLength) {
      throw new Error("命令过长");
    }

    const projects = await listProjects(this.config);
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未知项目");
    }

    const commandId = nanoid(10);
    const threadId = `terminal:${commandId}`;
    const cwd = path.resolve(project.path);

    this.publishTerminalOutput({
      threadId,
      commandId,
      cwd,
      command: normalizedCommand,
      stream: "stdout",
      text: `PS ${cwd}> ${normalizedCommand}\n`,
      status: "running",
    });

    const child = spawnShellCommand(normalizedCommand, cwd);
    const timeout = setTimeout(() => {
      const session = this.sessions.get(commandId);
      if (session) {
        session.stopping = true;
      }
      stopChildProcess(child);
      this.publishTerminalOutput({
        threadId,
        commandId,
        stream: "stderr",
        text: `\n[命令超过 ${Math.round(maxRuntimeMs / 1000)} 秒，已终止]\n`,
        status: "timeout",
      });
    }, maxRuntimeMs);

    const session: TerminalSession = {
      commandId,
      threadId,
      child,
      timeout,
      stopping: false,
    };
    this.sessions.set(commandId, session);

    child.stdout.on("data", (chunk) => {
      this.publishTerminalOutput({ threadId, commandId, stream: "stdout", text: chunk.toString(), status: "running" });
    });

    child.stderr.on("data", (chunk) => {
      this.publishTerminalOutput({ threadId, commandId, stream: "stderr", text: chunk.toString(), status: "running" });
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      this.sessions.delete(commandId);
      this.publishTerminalOutput({ threadId, commandId, stream: "stderr", text: `\n[启动失败] ${error.message}\n`, status: "error" });
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      this.sessions.delete(commandId);
      const suffix = session.stopping ? "stopped" : signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`;
      this.publishTerminalOutput({
        threadId,
        commandId,
        stream: "stdout",
        text: `\n[${suffix}]\n`,
        status: session.stopping ? "stopped" : code === 0 ? "completed" : "error",
      });
    });

    return { commandId, threadId, cwd, command: normalizedCommand };
  }

  stopCommand(commandId: string): { ok: true; commandId: string; threadId: string } {
    const session = this.sessions.get(commandId);
    if (!session) {
      throw new Error("终端命令不存在或已结束");
    }
    session.stopping = true;
    stopChildProcess(session.child);
    this.publishTerminalOutput({
      threadId: session.threadId,
      commandId: session.commandId,
      stream: "stderr",
      text: "\n[已请求停止命令]\n",
      status: "stopped",
    });
    return { ok: true, commandId: session.commandId, threadId: session.threadId };
  }

  async startInteractiveSession(
    projectId: string,
    size?: { cols?: number; rows?: number },
  ): Promise<{ sessionId: string; threadId: string; cwd: string; shell: string; cols: number; rows: number; backend: "pty" }> {
    const projects = await listProjects(this.config);
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未知项目");
    }

    const sessionId = nanoid(10);
    const threadId = `terminal:${sessionId}`;
    const cwd = path.resolve(project.path);
    const shell = shellName();
    const cols = sanitizeTerminalCols(size?.cols);
    const rows = sanitizeTerminalRows(size?.rows);
    const child = spawnInteractiveShell(cwd, { cols, rows });
    const session: InteractiveTerminalSession = {
      sessionId,
      threadId,
      child,
      cwd,
      shell,
      cols,
      rows,
      stopping: false,
      writeReadyAt: 0,
    };
    this.interactiveSessions.set(sessionId, session);

    this.publishTerminalOutput({
      threadId,
      commandId: sessionId,
      cwd,
      command: `${shell} · PTY 交互式会话`,
      stream: "stdout",
      text: `\n[已启动 PTY ${shell} 会话 ${cols}x${rows}]\n`,
      status: "running",
    });

    child.onData((chunk) => {
      this.publishTerminalOutput({ threadId, commandId: sessionId, stream: "stdout", text: chunk, status: "running" });
    });
    child.onExit(({ exitCode, signal }) => {
      this.interactiveSessions.delete(sessionId);
      const suffix = session.stopping ? "stopped" : signal ? `signal ${signal}` : `exit ${exitCode ?? "unknown"}`;
      this.publishTerminalOutput({
        threadId,
        commandId: sessionId,
        stream: "stdout",
        text: `\n[session ${suffix}]\n`,
        status: session.stopping ? "stopped" : exitCode === 0 ? "completed" : "error",
      });
    });

    return { sessionId, threadId, cwd, shell, cols, rows, backend: "pty" };
  }

  writeInteractiveSession(sessionId: string, text: string, appendNewline = true): { ok: true; sessionId: string; threadId: string } {
    const session = this.interactiveSessions.get(sessionId);
    if (!session) {
      throw new Error("交互式终端会话不存在或已结束");
    }
    const input = appendNewline ? normalizeInteractiveLineInput(text) : text;
    const delayMs = Math.max(0, session.writeReadyAt - Date.now());
    if (delayMs > 0) {
      setTimeout(() => session.child.write(input), delayMs);
    } else {
      session.child.write(input);
    }
    if (!appendNewline && text.includes("\u0003")) {
      session.writeReadyAt = Date.now() + 250;
    }
    return { ok: true, sessionId: session.sessionId, threadId: session.threadId };
  }

  resizeInteractiveSession(
    sessionId: string,
    size: { cols?: number; rows?: number },
  ): { ok: true; sessionId: string; threadId: string; cols: number; rows: number } {
    const session = this.interactiveSessions.get(sessionId);
    if (!session) {
      throw new Error("交互式终端会话不存在或已结束");
    }
    const cols = sanitizeTerminalCols(size.cols ?? session.cols);
    const rows = sanitizeTerminalRows(size.rows ?? session.rows);
    if (session.cols === cols && session.rows === rows) {
      return { ok: true, sessionId: session.sessionId, threadId: session.threadId, cols, rows };
    }
    session.child.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    this.publishTerminalOutput({
      threadId: session.threadId,
      commandId: session.sessionId,
      stream: "stdout",
      text: `\n[terminal resized to ${cols}x${rows}]\n`,
      status: "running",
    });
    return { ok: true, sessionId: session.sessionId, threadId: session.threadId, cols, rows };
  }

  stopInteractiveSession(sessionId: string): { ok: true; sessionId: string; threadId: string } {
    const session = this.interactiveSessions.get(sessionId);
    if (!session) {
      throw new Error("交互式终端会话不存在或已结束");
    }
    session.stopping = true;
    session.child.kill();
    this.publishTerminalOutput({
      threadId: session.threadId,
      commandId: session.sessionId,
      stream: "stderr",
      text: "\n[已请求停止交互式会话]\n",
      status: "stopped",
    });
    return { ok: true, sessionId: session.sessionId, threadId: session.threadId };
  }

  private publishTerminalOutput(input: {
    threadId: string;
    commandId: string;
    stream: "stdout" | "stderr";
    text: string;
    status: TerminalCommandHistory["status"];
    cwd?: string;
    command?: string;
  }): void {
    this.hub.publish({
      type: "terminal.output",
      threadId: input.threadId,
      commandId: input.commandId,
      stream: input.stream,
      text: input.text,
      status: input.status,
      cwd: input.cwd,
      command: input.command,
      createdAt: new Date().toISOString(),
    } satisfies GatewayEvent);
  }
}

function spawnShellCommand(command: string, cwd: string): LocalTerminalProcess {
  if (process.platform === "win32") {
    return spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  return spawn("sh", ["-lc", command], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function spawnInteractiveShell(cwd: string, size: { cols: number; rows: number }): PtyProcess {
  if (process.platform === "win32") {
    return spawnPty("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-NoExit",
      "-Command",
      "Remove-Module PSReadLine -ErrorAction SilentlyContinue",
    ], {
      cwd,
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      env: interactiveShellEnv(),
    });
  }

  return spawnPty(process.env.SHELL || "sh", [], {
    cwd,
    name: "xterm-256color",
    cols: size.cols,
    rows: size.rows,
    env: interactiveShellEnv(),
  });
}

function shellName(): string {
  if (process.platform === "win32") {
    return "PowerShell";
  }
  return path.basename(process.env.SHELL || "sh");
}

function stopChildProcess(child: LocalTerminalProcess): void {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => child.kill());
    return;
  }

  child.kill("SIGTERM");
}

function normalizeInteractiveLineInput(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.endsWith("\n")) {
    return normalized.slice(0, -1).replace(/\n/g, "\r") + "\r";
  }
  return normalized.replace(/\n/g, "\r") + "\r";
}

function sanitizeTerminalCols(value: number | undefined): number {
  const fallback = defaultTerminalCols;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(240, Math.max(20, Math.round(value ?? fallback)));
}

function sanitizeTerminalRows(value: number | undefined): number {
  const fallback = defaultTerminalRows;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(80, Math.max(5, Math.round(value ?? fallback)));
}

function interactiveShellEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: process.env.TERM || "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
    SystemRoot: process.env.SystemRoot,
  };
}
