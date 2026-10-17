import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import TOML from "@iarna/toml";
import type { ApprovalPolicySummary, ControlSettings } from "../types.js";
import { userCodexConfigPath } from "./paths.js";

type TomlValue = string | number | boolean | Date | TomlValue[] | { [key: string]: TomlValue };
type TomlRecord = { [key: string]: TomlValue };

export async function readProjectlessWorkspaceRoot(): Promise<string> {
  const config = await readToml(userCodexConfigPath());
  const desktop = asRecord(config.desktop);
  const configured = readString(desktop.projectlessWorkspaceRoot)?.trim();
  if (configured && !path.isAbsolute(configured)) throw new Error("Codex 默认工作区必须是绝对路径");
  return configured || path.join(os.homedir(), "Documents", "Codex");
}

export async function readUserSettings(): Promise<ControlSettings> {
  const config = await readToml(userCodexConfigPath());
  const workspace = (config.sandbox_workspace_write ?? {}) as TomlRecord;
  const modelProvider = readString(config.model_provider);
  const providerRecord = activeProviderRecord(config, modelProvider);
  return {
    model: readString(config.model),
    modelProvider,
    providerBaseUrl: readString(providerRecord.base_url),
    approvalPolicy: readString(config.approval_policy),
    sandboxMode: readString(config.sandbox_mode),
    reasoningEffort: readString(config.model_reasoning_effort),
    networkAccess: typeof workspace.network_access === "boolean" ? workspace.network_access : undefined,
    disableResponseStorage: readBoolean(config.disable_response_storage),
  };
}

export async function readApprovalPolicySummary(): Promise<ApprovalPolicySummary> {
  const settings = await readUserSettings();
  const approvalPolicy = settings.approvalPolicy || "默认";
  const sandboxMode = settings.sandboxMode || "默认";
  const networkAccess = settings.networkAccess === true;
  const approval = describeApprovalPolicy(approvalPolicy);
  const sandbox = describeSandboxMode(sandboxMode, networkAccess);
  return {
    approvalPolicy,
    approvalLabel: approval.label,
    approvalRisk: combinedRisk(approval.risk, sandbox.risk),
    sandboxMode,
    sandboxLabel: sandbox.label,
    networkAccess,
    summary: `${approval.summary} ${sandbox.summary}`,
    recommendation: recommendationFor(approvalPolicy, sandboxMode, networkAccess),
  };
}

export async function readUserSettingsRaw(): Promise<{ path: string; content: string }> {
  const filePath = userCodexConfigPath();
  try {
    return { path: filePath, content: await fs.readFile(filePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: filePath, content: "" };
    }
    throw error;
  }
}

export async function writeUserSettingsRaw(content: string): Promise<{ path: string; content: string; settings: ControlSettings }> {
  const filePath = userCodexConfigPath();
  TOML.parse(content);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content.trimEnd() + "\n", "utf8");
  return {
    path: filePath,
    content: await fs.readFile(filePath, "utf8"),
    settings: await readUserSettings(),
  };
}

export async function writeUserSettings(settings: ControlSettings): Promise<ControlSettings> {
  const filePath = userCodexConfigPath();
  const config = await readToml(filePath);
  if(settings.model?.includes('::')){
    const provider=asRecord(asRecord(config.model_providers)[readString(config.model_provider)||'openai']);
    let relay=false;
    try{const url=new URL(readString(provider.base_url)||'');relay=['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&['/v1','/relay/v1'].includes(url.pathname.replace(/\/$/,''));}catch{}
    if(!relay)throw new Error('中转模型请在新会话中选择；桌面默认模型仍使用当前官方配置');
  }
  assignString(config, "model", settings.model);
  assignString(config, "model_provider", settings.modelProvider);
  assignString(config, "approval_policy", settings.approvalPolicy);
  assignString(config, "sandbox_mode", settings.sandboxMode);
  assignString(config, "model_reasoning_effort", settings.reasoningEffort);
  assignBoolean(config, "disable_response_storage", settings.disableResponseStorage);

  if (typeof settings.networkAccess === "boolean") {
    const workspace = asRecord(config.sandbox_workspace_write);
    workspace.network_access = settings.networkAccess;
    config.sandbox_workspace_write = workspace;
  }

  const activeProvider = readString(config.model_provider);
  if (typeof settings.providerBaseUrl === "string" && activeProvider) {
    assignProviderBaseUrl(config, activeProvider, settings.providerBaseUrl);
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, TOML.stringify(config as Parameters<typeof TOML.stringify>[0]), "utf8");
  return readUserSettings();
}

async function readToml(filePath: string): Promise<TomlRecord> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return TOML.parse(raw) as TomlRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function assignString(target: TomlRecord, key: string, value: string | undefined): void {
  if (typeof value === "string" && value.trim().length > 0) {
    target[key] = value.trim();
  } else if (typeof value === "string") {
    delete target[key];
  }
}

function assignBoolean(target: TomlRecord, key: string, value: boolean | undefined): void {
  if (typeof value === "boolean") {
    target[key] = value;
  }
}

function asRecord(value: TomlValue | undefined): TomlRecord {
  if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
    return value;
  }
  return {};
}

function activeProviderRecord(config: TomlRecord, providerKey: string | undefined): TomlRecord {
  if (!providerKey) {
    return {};
  }
  const providers = asRecord(config.model_providers);
  return asRecord(providers[providerKey]);
}

function assignProviderBaseUrl(config: TomlRecord, providerKey: string, value: string): void {
  const providers = asRecord(config.model_providers);
  const provider = asRecord(providers[providerKey]);
  if (value.trim().length > 0) {
    provider.base_url = value.trim();
  } else {
    delete provider.base_url;
  }
  providers[providerKey] = provider;
  config.model_providers = providers;
}

function describeApprovalPolicy(policy: string): { label: string; risk: ApprovalPolicySummary["approvalRisk"]; summary: string } {
  switch (policy) {
    case "on-request":
      return { label: "按请求审批", risk: "medium", summary: "Codex 在需要提升权限或执行敏感操作时会请求确认。" };
    case "on-failure":
      return { label: "失败后再请求", risk: "medium", summary: "Codex 会先尝试在当前限制下运行，失败后再请求放宽权限。" };
    case "never":
      return { label: "不请求审批", risk: "high", summary: "Codex 不会请求人工审批，遇到受限操作通常会失败或绕路。" };
    case "untrusted":
      return { label: "不信任工作区", risk: "low", summary: "Codex 会把工作区视为不可信，审批更保守。" };
    default:
      return { label: policy || "默认", risk: "unknown", summary: "当前审批策略未在移动端内置说明中覆盖。" };
  }
}

function describeSandboxMode(mode: string, networkAccess: boolean): { label: string; risk: ApprovalPolicySummary["approvalRisk"]; summary: string } {
  if (mode === "danger-full-access") {
    return { label: "完全访问", risk: "high", summary: "沙盒允许较高权限访问，本机文件和命令风险更高。" };
  }
  if (mode === "workspace-write") {
    return {
      label: networkAccess ? "工作区写入 + 网络" : "工作区写入",
      risk: networkAccess ? "medium" : "low",
      summary: networkAccess ? "Codex 可写工作区并访问网络。" : "Codex 可写工作区，但网络默认受限。",
    };
  }
  if (mode === "read-only") {
    return { label: "只读", risk: "low", summary: "Codex 默认不能修改文件。" };
  }
  return { label: mode || "默认", risk: "unknown", summary: "当前沙盒模式未在移动端内置说明中覆盖。" };
}

function combinedRisk(left: ApprovalPolicySummary["approvalRisk"], right: ApprovalPolicySummary["approvalRisk"]): ApprovalPolicySummary["approvalRisk"] {
  const order = ["unknown", "low", "medium", "high"];
  return order.indexOf(left) > order.indexOf(right) ? left : right;
}

function recommendationFor(policy: string, sandboxMode: string, networkAccess: boolean): string {
  if (sandboxMode === "danger-full-access") {
    return "建议只在可信项目中使用完全访问，并认真检查每个权限审批。";
  }
  if (policy === "never") {
    return "建议移动端控制时使用 on-request 或 on-failure，避免敏感操作缺少确认。";
  }
  if (networkAccess) {
    return "启用网络访问时，建议保留审批，以便确认安装依赖、下载脚本等操作。";
  }
  return "当前配置适合日常手机端控制；遇到命令、文件或权限审批时仍需逐项确认。";
}

export async function readCustomPermissions() {
  const root=await readToml(userCodexConfigPath());
  const profile=typeof root.profile==='string'?(root.profiles as TomlRecord|undefined)?.[root.profile]:undefined;
  const config={...root,...(profile&&typeof profile==='object'?profile:{})} as TomlRecord;
  const workspace=(config.sandbox_workspace_write||{}) as TomlRecord;
  const sandbox=typeof config.sandbox_mode==='string'?config.sandbox_mode:'read-only';
  const sandboxPolicy=sandbox==='danger-full-access'?{type:'dangerFullAccess'}:sandbox==='workspace-write'?{type:'workspaceWrite',networkAccess:workspace.network_access===true,writableRoots:Array.isArray(workspace.writable_roots)?workspace.writable_roots:[],excludeTmpdirEnvVar:workspace.exclude_tmpdir_env_var===true,excludeSlashTmp:workspace.exclude_slash_tmp===true}:{type:'readOnly'};
  return {approvalPolicy:config.approval_policy||'on-request',approvalsReviewer:config.approvals_reviewer||'user',sandbox,sandboxPolicy};
}
