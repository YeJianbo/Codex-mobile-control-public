# ZCode 接入可行性调研（2026-09-30）

结论先行：**可行，且协议面是第一公民级的匹配**。ZCode 桌面应用自带协议兼容的 stdio app-server，网关可以用与 `codex app-server` 相同的模式接入 ZCode 作为第五个助手。剩余工作属于工程实现而非可行性风险。

## CLI 位置与版本

- 桌面应用：`D:\ZCode\ZCode.exe`（Electron，3.14.4）
- CLI 入口：`node D:\ZCode\resources\glm\zcode.cjs`（v0.16.9，进程名 `zcode-cli`）
- 桌面端自身就以 `zcode.cjs app-server --stdio --surface desktop` 常驻运行（`Get-CimInstance` 实测）
- 认证：Z.AI OAuth（`login/logout` 子命令；共享凭据在 `~/.zcode/v2/credentials.json`）

## 能力面（`--help` + 实测）

- `-p/--prompt` 无头单发；`--json` 机器可读输出；`--resume sess_...` / `-c` 恢复会话
- `--mode build|edit|plan|yolo`（权限模式，可映射 询问/自动/完全，plan 额外赠送）
- `--attach <path>` 附件（可重复）；`--cwd`、`--disallowed-tools`、`--locale zh-CN`
- **`app-server --stdio`**：ZCode Protocol（自定义 NDJSON，非 JSON-RPC）

## ZCode Protocol 实测（app-server --stdio）

消息为 `{id, method, params}` 请求 / `{id, result|error}` 应答 / `{method, params}` 通知。服务端会向客户端反提请求（客户端必须应答，超时 15s）。

已实测打通：

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `session/create` | `workspace:{workspacePath,workspaceKey}` | 返回 `projection`（mode/contextWindow/status）+ `messages` |
| `session/send` | `sessionId, content` | 返回 `{accepted:true,sessionId,stateRevision}` |
| `session/requestRuntimePreferences`（服务端→客户端请求） | `sessionId,scope` | 应答 `{nativeSearchEnhancementsEnabled:boolean}`；**schema 里没有模型字段** |
| 事件通知 | `state.updated`（mode/permission/model 补丁，reason=prompt_started/failed）、`session/event`、`computer-use/operation-event`、`v4/telemetry/event` | sessionId 从通知载荷中获取 |

方法面还包括：`session/list`、`session/resume`、`session/read`、`session/messages`、`session/events`、`session/subscribe`、`session/stop`、`session/compact`、`session/goal`（目标！与 Codex goal 概念对齐）、`session/fork`、`session/setMode`、`session/setModel`、`session/setThoughtLevel`、`session/usage`、`session/subagents`。

## 尚未打通的点（接入时要解决的工程问题）

1. **模型选择**：无头 `--prompt`/`session/send` 报 "Select a model before continuing"，`state.updated` 显示 `model.available:[]`。`requestRuntimePreferences` 应答不含模型 → 模型目录由桌面宿主另行注入。候选解法（按顺序试）：a) `session/setModel` + 从 Z.AI 账号获取的模型 id；b) 先跑 `zcode login` 让 CLI 自持认证后重试 `-p`；c) `--surface desktop` 复刻桌面宿主的应答内容。
2. **权限审批流**：ZCode 的 permission mode 在协议里有 `permission:{mode}` 状态，但审批请求（相当于 Codex 的 applyPatchApproval）走哪个方法/通知未确认——需在一次真实 build 模式 turn 中抓取通知。
3. **会话 ID 生命周期**：create 后 `projection.sessionId="unknown"`，真实 `sess_...` 从通知里捞——网关适配器要按通知补 ID（或确认 create 的其他返回字段）。
4. **并发**：本会话运行期间探测未发现冲突，但网关长驻 app-server 与桌面端同时操作同一工作区的行为未验证。

## 建议的接入步骤（工程排期参考）

1. `server/src/codex/zcodeAppServerClient.ts`：NDJSON 客户端（参考 `appServerClient.ts`），覆盖 create/send/events/stop/setMode。
2. `agentProtocol.ts`：`Agent` 增加 `'zcode'`；`agentUpdates` 解析 `state.updated`/流式文本事件。
3. `agentSessions.ts`：spawn `node zcode.cjs app-server --stdio --surface terminal`（CLI 路径可配 `CODEX_MOBILE_CONTROL_ZCODE_BIN`）；权限映射 询问→build、自动→edit、完全→yolo。
4. 客户端：Android `nativeThreadAgent`/助手名/图标 + Web `harnessNames`/图标 + `zcode-` 线程前缀。
5. 测试：mock app-server 复用 smoke 框架。

## Antigravity 适配（同日探测结论，已落地部分）

- 图片：CLI 硬拒（`only "text"`）——网关现有报错行为正确，保留。
- 审批：`ask_permission` 工具在无头模式不可用；默认 `permission_mode=always-proceed`——**"询问"过去会静默变成全自动**。已在网关为 AGY 的 ask 轮次发布显式 warning 事件（`agentSessions.ts`）。
- 模型：`agy models` 输出变体编码 ID（-low/-medium/-high/max），网关映射固定 effort 正确；CLI 亦支持 `--effort`，暂不动（避免破坏既有保存的选择）。
- 桌面历史：CLI 无会话列表子命令，暂无法导入。
