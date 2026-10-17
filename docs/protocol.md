# Gateway 协议

> 版本提示：本文件前半部分写于 0.1 时代，示例与个别描述可能滞后；**完整的端点清单以文末《端点总览（0.6.40）》为准**，代码以 `server/src/index.ts` 为准。

## HTTP

除下列豁免路径外，所有请求都需要：

```http
Authorization: Bearer <token>
```

豁免路径：`/health`、`/console` 及其静态资源、`/downloads/android.apk`、`POST /api/pair/claim`（配对码换 token）、`/preview/proxy`（网关自行校验）。设备端 token 与管理员 token 的权限差异见 `docs/architecture.md`。

### `GET /health`

返回服务、协议版本和能力列表。Android 连接前会先用它检查协议兼容性。

```json
{
  "ok": true,
  "version": "0.6.28",
  "protocolVersion": 1,
  "minAndroidProtocolVersion": 1,
  "capabilities": ["pairing", "terminal-pty", "followup-queue", "websocket-heartbeat"]
}
```

### `GET /api/projects`

返回可控制项目列表。

### `GET /api/config/project-roots`

返回允许手机端控制的项目根目录列表。文件、终端和 diff 操作只能作用于这些根目录对应的项目。

```json
{
  "roots": [
    { "path": "F:\\Code\\example", "name": "example", "exists": true }
  ]
}
```

### `POST /api/config/project-roots`

添加允许项目根目录。目录必须存在。

```json
{ "path": "F:/Code/example" }
```

### `DELETE /api/config/project-roots?path=...`

移除允许项目根目录。移除后该目录对应项目不再可访问。

### `GET /api/config/https`

返回 Gateway HTTPS 配置和证书文件状态。

```json
{
  "https": {
    "enabled": false,
    "certPath": "C:\\Users\\you\\.codex-mobile-control\\certs\\gateway-cert.pem",
    "keyPath": "C:\\Users\\you\\.codex-mobile-control\\certs\\gateway-key.pem",
    "certExists": true,
    "keyExists": true
  }
}
```

### `PUT /api/config/https`

保存 HTTPS 配置，可同时生成自签名证书。监听协议切换需要重启 Gateway 后生效。Android 连接自签名 HTTPS 时需要在连接设置中启用“信任自签名 HTTPS 证书”。

```json
{ "enabled": true, "generateSelfSigned": true }
```

### `GET /api/devices`

返回已连接过的设备列表。

### `GET /api/pair/start`

需要管理员 token。创建一个 5 分钟有效的配对码。

```json
{
  "code": "ABC234",
  "baseUrl": "http://127.0.0.1:38457",
  "expiresAt": "2026-06-13T06:20:00.000Z",
  "setupUrl": "codex-control://pair?baseUrl=...&code=ABC234",
  "qrSvg": "<svg ...>"
}
```

### `POST /api/pair/claim`

不需要管理员 token。手机端用配对码换取设备 token。

```json
{ "code": "ABC234", "name": "Android" }
```

### `DELETE /api/devices/:deviceId`

撤销设备。撤销后该设备 token 不能继续访问 Gateway。

### `POST /api/auth/token/rotate`

轮换当前 `Authorization` header 中的 token。使用管理员 token 调用会生成新的管理员 token；使用设备 token 调用会生成新的当前设备 token，旧 token 立即失效。该接口不接受 URL query token。

```json
{
  "kind": "device",
  "token": "new-token",
  "device": {
    "id": "abc123",
    "name": "Android",
    "firstSeenAt": "2026-06-14T01:00:00.000Z",
    "lastSeenAt": "2026-06-14T02:00:00.000Z"
  }
}
```

### `GET /api/threads`

返回已知 Codex threads，按更新时间倒序。

### `GET /api/threads/:threadId/events`

返回指定 thread 最近事件，用于手机端断线后恢复上下文。

支持 `turns` 按对话轮次读取及 `count` 按事件窗口读取。窗口边界保留完整消息，不把同一消息的实时片段从中间截断。来自已保存 Codex 正文的 `message.delta` 会带可选的 `textComplete: true`；它是指定 `itemId` 的最终完整文本，应替换同一消息的实时片段。该标志没有出现时按实时片段或未完成快照处理。最终完整文本确认后，同一 item 的迟到片段不再追加；不同 item 的后续消息仍接收。

### `POST /api/threads/:threadId/resume`

恢复已存在的 Codex thread。Gateway 会在发送新 turn 前自动恢复未激活 thread。

```json
{ "projectPath": "F:/Code/example", "model": "gpt-5.4" }
```

### `GET /api/approvals`

返回当前和历史审批请求。

### `POST /api/approvals/:approvalId/resolve`

响应 Codex app-server 发起的审批请求。

```json
{ "decision": "accept" }
```

`decision` 可为 `accept` 或 `decline`。当前支持命令审批、文件变更审批、权限 profile 审批，以及 legacy `execCommandApproval` / `applyPatchApproval`。

### `GET /api/projects/:projectId/files?path=...`

返回项目目录下的文件和子目录。路径被限制在已添加项目根目录内。

### `GET /api/projects/:projectId/file?path=...`

按 UTF-8 文本读取文件。当前限制 1 MB 以内。

### `PUT /api/projects/:projectId/file?path=...`

保存 UTF-8 文本文件。

```json
{ "content": "..." }
```

### `GET /api/projects/:projectId/diff`

返回项目 `git diff --stat` 和 `git diff`。

### `GET /api/projects/:projectId/diff/files`

返回当前项目按文件分组的未提交改动。

```json
{
  "files": [
    {
      "path": "src/index.ts",
      "status": "modified",
      "additions": 12,
      "deletions": 3
    }
  ]
}
```

`status` 可为 `added`、`modified`、`deleted`、`renamed`、`copied`、`unmerged`、`accepted` 或 `unknown`。

### `GET /api/projects/:projectId/diff/file?path=...`

返回单个文件的 `git diff -- <path>`，用于手机端按文件审阅改动。

### `GET /api/projects/:projectId/diff/file/hunks?path=...`

返回单个文件当前 diff 的 hunk 列表。`source` 为 `worktree` 或 `staged`，分别代表工作区改动和已暂存改动。

```json
{
  "path": "src/index.ts",
  "hunks": [
    {
      "id": "worktree:0",
      "index": 0,
      "source": "worktree",
      "header": "@@ -10,7 +10,8 @@",
      "text": "@@ -10,7 +10,8 @@\n..."
    }
  ]
}
```

### `POST /api/projects/:projectId/diff/file/accept?path=...`

接受单个文件的当前改动。当前语义为 `git add -- <path>`，接受后该文件会进入已暂存状态，并在 diff 文件列表中显示为 `accepted`。

### `POST /api/projects/:projectId/diff/file/revert?path=...`

撤销单个文件改动。当前语义为 `git restore --staged --worktree -- <path>`，会同时清理该文件的暂存区和工作区改动。

### `POST /api/projects/:projectId/diff/file/hunk/accept?path=...`

接受工作区中的单个 hunk。当前语义为服务端重新读取最新 diff 后执行 `git apply --cached`，因此 hunk 会进入暂存区，工作区文件内容保持不变。仅支持 `source: "worktree"`。

```json
{ "source": "worktree", "index": 0 }
```

### `POST /api/projects/:projectId/diff/file/hunk/revert?path=...`

撤销单个 hunk。`source: "worktree"` 会反向应用工作区 hunk；`source: "staged"` 会执行暂存区反向应用，用于只撤销已接受的一块改动。

```json
{ "source": "staged", "index": 0 }
```

### `POST /api/projects/:projectId/diff/files/accept`

批量接受当前 diff 文件列表中的多个文件。当前语义为逐个执行 `git add -- <path>`。

```json
{ "paths": ["src/index.ts", "README.md"] }
```

### `POST /api/projects/:projectId/diff/files/revert`

批量撤销当前 diff 文件列表中的多个文件。当前语义为逐个执行 `git restore --staged --worktree -- <path>`。

```json
{ "paths": ["src/index.ts", "README.md"] }
```

### `POST /api/projects/:projectId/terminal/run`

在指定项目目录中运行一条本机命令，并把 stdout/stderr 作为 `terminal.output` 事件流式推送给手机端。命令工作目录固定为已添加项目根目录。

```json
{ "command": "npm test" }
```

返回：

```json
{
  "commandId": "abc123",
  "threadId": "terminal:abc123",
  "cwd": "F:\\Code\\example",
  "command": "npm test"
}
```

### `POST /api/projects/:projectId/terminal/session`

在指定项目目录中启动一个可复用的交互式 shell 会话。当前实现使用 PTY 后端，输出继续通过 `terminal.output` 推送；客户端可在创建后或视口变化时继续调用 resize 接口同步 `cols/rows`。

```json
{
  "sessionId": "abc123",
  "threadId": "terminal:abc123",
  "cwd": "F:\\Code\\example",
  "shell": "PowerShell",
  "cols": 100,
  "rows": 28,
  "backend": "pty"
}
```

### `POST /api/terminal/sessions/:sessionId/input`

向交互式 shell 会话写入输入。默认会在末尾自动补一个终端回车；如果要发送控制键、方向键、`Home/End/Del` 或原始字节序列，可传 `appendNewline: false`。该模式也支持发送多行文本和纯空格片段。

```json
{ "text": "npm test" }
```

```json
{ "text": "\u0003", "appendNewline": false }
```

### `POST /api/terminal/sessions/:sessionId/resize`

调整交互式 PTY 会话的字符尺寸。手机端会在会话创建后和终端面板大小变化后 best-effort 调用该接口。

```json
{ "cols": 100, "rows": 30 }
```

### `POST /api/terminal/sessions/:sessionId/stop`

停止交互式 shell 会话。

```json
{ "ok": true, "sessionId": "abc123", "threadId": "terminal:abc123" }
```

### `GET /api/terminal/history?limit=500`

返回最近的本地终端输出事件，用于手机端重连后恢复终端 scrollback。`limit` 范围为 1 到 1000，默认 500。

```json
{
  "events": [
    {
      "type": "terminal.output",
      "threadId": "terminal:abc123",
      "stream": "stdout",
      "text": "npm test\n"
    }
  ]
}
```

### `GET /api/terminal/commands?limit=100`

返回按命令聚合后的终端 scrollback。手机端终端页优先使用该接口展示命令卡片，`limit` 范围为 1 到 200，默认 100。

可选参数：

- `includeOutput=true|false`：是否返回完整输出。默认 `true`，用于兼容旧客户端；Android 默认使用 `false`。
- `previewChars=12000`：`includeOutput=false` 时返回尾部预览长度，范围 0 到 100000。

```json
{
  "commands": [
    {
      "commandId": "abc123",
      "threadId": "terminal:abc123",
      "cwd": "F:\\Code\\example",
      "command": "npm test",
      "status": "completed",
      "startedAt": "2026-06-14T01:40:00.000Z",
      "endedAt": "2026-06-14T01:40:03.000Z",
      "stdout": "npm test\n[exit 0]\n",
      "stderr": "",
      "output": "npm test\n[exit 0]\n",
      "stdoutLength": 18,
      "stderrLength": 0,
      "outputLength": 18,
      "outputOffset": 0,
      "outputEnd": 18,
      "outputTruncated": false,
      "chunks": 3
    }
  ]
}
```

### `GET /api/terminal/commands/:commandId/output?offset=0&limit=16000&stream=combined`

分页读取某个终端命令的输出。`stream` 可为 `combined`、`stdout` 或 `stderr`，`limit` 范围为 1 到 100000。

```json
{
  "output": {
    "commandId": "abc123",
    "threadId": "terminal:abc123",
    "stream": "combined",
    "offset": 0,
    "end": 16000,
    "limit": 16000,
    "totalLength": 64000,
    "text": "...",
    "hasMoreBefore": false,
    "hasMoreAfter": true
  }
}
```

### `POST /api/terminal/:commandId/stop`

停止仍在运行的本地终端命令。该接口用于手机端终端块的“停止”按钮。

```json
{
  "ok": true,
  "commandId": "abc123",
  "threadId": "terminal:abc123"
}
```

### `GET /raw/projects/:projectId/file?path=...&token=...`

返回文件原始内容，用于手机端 WebView/图片/PDF/HTML 预览。

### `GET /preview/proxy?url=http://localhost:5173&token=...`

代理电脑本机 `localhost` 或 `127.0.0.1` 的 dev server，方便手机端直接预览本地网页。

### `POST /api/projects`

兼容旧客户端的添加项目接口，效果等同于添加允许项目根目录。

```json
{ "path": "F:/Code/example" }
```

### `GET /api/settings/user`

读取用户级 Codex 设置。

### `GET /api/settings/approval-summary`

返回当前审批策略、沙盒和网络访问的中文摘要，用于移动端展示风险等级和建议。

```json
{
  "summary": {
    "approvalPolicy": "on-request",
    "approvalLabel": "按请求审批",
    "approvalRisk": "medium",
    "sandboxMode": "workspace-write",
    "sandboxLabel": "工作区写入",
    "networkAccess": false,
    "summary": "Codex 在需要提升权限或执行敏感操作时会请求确认。 Codex 可写工作区，但网络默认受限。",
    "recommendation": "当前配置适合日常手机端控制；遇到命令、文件或权限审批时仍需逐项确认。"
  }
}
```

### `PUT /api/settings/user`

保存用户级 Codex 设置。

```json
{
  "model": "gpt-5.4",
  "approvalPolicy": "on-request",
  "sandboxMode": "workspace-write",
  "reasoningEffort": "high",
  "networkAccess": true
}
```

### `GET /api/settings/user/raw`

读取用户级 Codex `config.toml` 原文，用于覆盖表单尚未列出的桌面端设置项。

```json
{
  "config": {
    "path": "C:\\Users\\you\\.codex\\config.toml",
    "content": "model = \"gpt-5.4\"\n"
  }
}
```

### `PUT /api/settings/user/raw`

保存用户级 Codex `config.toml` 原文。服务端会先解析 TOML，格式错误时拒绝保存。

```json
{ "content": "model = \"gpt-5.4\"\napproval_policy = \"on-request\"\n" }
```

### `GET /api/codex/status`

返回电脑端 Codex CLI 和 app-server 运行状态。

```json
{
  "codex": {
    "cliVersion": "codex-cli 0.133.0",
    "cliAvailable": true,
    "running": false,
    "initialized": false,
    "initializedAt": null,
    "pendingRequests": 0,
    "startedAt": null,
    "lastExitCode": null,
    "lastError": null,
    "malformedMessages": 0,
    "lastMalformedAt": null,
    "autoRestartEnabled": true,
    "restartAttempts": 0,
    "nextRestartAt": null,
    "lastRestartAt": null
  }
}
```

### `GET /api/codex/compatibility`

返回 Gateway 对 `codex app-server` schema 的适配覆盖和运行时异常计数。此接口只读，不会为了检测而启动 app-server。

```json
{
  "compatibility": {
    "status": "warning",
    "checkedAt": "2026-06-14T12:00:00.000Z",
    "cliVersion": "codex-cli 0.133.0",
    "cliAvailable": true,
    "appServerRunning": false,
    "initialized": false,
    "pendingRequests": 0,
    "adapter": {
      "clientRequests": ["initialize", "thread/start", "thread/resume", "turn/start", "turn/interrupt"],
      "notifications": ["item/agentMessage/delta", "turn/completed", "item/started", "item/completed"],
      "serverRequests": ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"],
      "clientCapabilities": ["experimentalApi"]
    },
    "observations": {
      "unknownNotifications": [],
      "unsupportedServerRequests": [],
      "malformedMessages": 0,
      "lastMalformedAt": null
    },
    "recommendations": ["app-server 当前未运行；启动后才能确认 initialize 握手和实时事件。"]
  }
}
```

### `GET /api/codex/upgrade-check`

检查电脑端 Codex CLI 是否有可升级版本。默认查询 npm registry；测试或离线环境可通过 `CODEX_MOBILE_CONTROL_CODEX_LATEST_VERSION` 注入最新版本，或用 `CODEX_MOBILE_CONTROL_DISABLE_UPGRADE_CHECK=1` 关闭检查。

```json
{
  "upgrade": {
    "checkedAt": "2026-06-14T04:00:00.000Z",
    "installedVersion": "0.133.0",
    "installedRaw": "codex-cli 0.133.0",
    "latestVersion": "0.134.0",
    "packageName": "@openai/codex",
    "updateAvailable": true,
    "command": "npm install -g @openai/codex@latest",
    "source": "npm"
  }
}
```

### `POST /api/codex/start`

启动 `codex app-server` 并返回最新状态。

### `POST /api/codex/restart`

重启 `codex app-server`。用于手机端发现 app-server 卡住、退出或协议请求长时间无响应时恢复。

## WebSocket

连接地址：

```text
ws://<host>:38457/ws?token=<token>
```

客户端可追加 `device` 查询参数：

```text
ws://<host>:38457/ws?token=<token>&device=Android
```

Gateway 会定期发送 WebSocket ping 并清理没有 pong 响应的连接；Android 客户端也会定期发送 ping，用于更快发现局域网半断开状态。

支持 `focused-thread-stream` 能力的网关接受 `streamThread` 查询参数：省略时保留全量推送；指定会话 ID 时，仅推送该会话的 `message.delta`、`reasoning.summary`、`tool.started`、`tool.output`、`tool.completed`、`plan.updated`、`file.changed`、`diff.updated` 和 `context.compaction`；显式传入空字符串时，不推送这些正文及操作事件。用户消息及回执、审批、错误、完成、用量、终端及其他状态事件仍正常推送，持久化和网关内部订阅保持全量。此规则同时用于连接回放和实时推送，协议版本仍为 1。

切换会话时，客户端发送 `{ "type": "thread.focus", "threadId": "thr", "requestId": "nonce" }`，网关更新订阅后返回 `{ "type": "thread.focused", "threadId": "thr", "requestId": "nonce" }`。空 `threadId` 表示停止正文流。客户端收到当前连接、会话及 requestId 匹配的回执后再读取历史，以补齐聚焦前内容；创建新会话后也应补读。旧网关不声明此能力时，客户端沿用全量流。

Android 与 Web 聊天均按此方式订阅当前会话。Web 在空白对话时订阅空字符串，收到新会话的发送回执后切换到新 ID；历史读取在等待确认期间保持实时缓冲，后台会话的补读不会改变当前订阅。离开会话或关闭旧连接会结束对应等待，旧连接的关闭事件不能清除新连接的订阅。

### 客户端消息

```json
{ "type": "thread.start", "requestId": "1", "projectId": "abc" }
{ "type": "thread.resume", "requestId": "1b", "threadId": "thr" }
{ "type": "turn.start", "requestId": "2", "threadId": "thr", "text": "总结这个项目" }
{ "type": "turn.interrupt", "requestId": "3", "threadId": "thr" }
```

### 服务端消息

```json
{ "type": "connected", "serverVersion": "0.1.0", "protocolVersion": 1, "minAndroidProtocolVersion": 1, "capabilities": ["pairing", "terminal-commands", "websocket-heartbeat"] }
{ "type": "message.delta", "threadId": "thr", "text": "你" }
{ "type": "terminal.output", "threadId": "thr", "stream": "stdout", "text": "npm test" }
{ "type": "tool.started", "threadId": "thr", "title": "shell_command" }
{ "type": "tool.output", "threadId": "thr", "itemId": "item_1", "text": "..." }
{ "type": "tool.completed", "threadId": "thr", "status": "ok" }
{ "type": "approval.requested", "threadId": "thr", "approvalId": "1-item_1", "approvalType": "command", "title": "npm install", "detail": "..." }
{ "type": "approval.resolved", "threadId": "thr", "approvalId": "1-item_1", "decision": "accept" }
{ "type": "file.changed", "threadId": "thr", "files": ["src/index.ts"], "summary": "1 个文件变更" }
{ "type": "diff.updated", "threadId": "thr", "diff": "diff --git ..." }
{ "type": "warning", "title": "配置警告", "detail": "..." }
{ "type": "codex.status", "status": "running", "detail": "codex-cli 0.133.0" }
{ "type": "turn.completed", "threadId": "thr", "status": "completed" }
{ "type": "error", "threadId": "thr", "turnId": "turn_1", "message": "...", "title": "正在重新连接", "detail": "原始错误及附加详情", "willRetry": true }
```

错误事件的 `title`、`detail`、`turnId`、`willRetry` 为可选字段。`detail` 保留原始错误、附加详情及上游错误类型，客户端优先展示并支持复制全文。`willRetry=true` 表示上游仍在重试，客户端保持任务运行及待发送状态；缺失或为 false 时按最终失败处理。只有上游提供重试次数时才显示次数。

## 端点总览（0.6.40）

与 `server/src/index.ts` 保持同步的完整 HTTP 端点清单。除上文豁免路径外都需要 Bearer token；标注「公网」的行为经 Cloudflare Tunnel 入口（带 `x-public-proxy-secret`）暴露，其余仅限局域网。

### 通用

| 端点 | 说明 |
| --- | --- |
| `GET /health` | 健康检查、版本、capabilities（免鉴权） |
| `GET /console`、`GET /console/assets/*` | Web 控制台页面与静态资源（免鉴权） |
| `GET /downloads/android.apk` | 安卓安装包下载（免鉴权） |
| `GET /api/projects`、`POST /api/projects` | 项目列表 / 添加项目 |
| `GET /api/sidebar` | 合并读取桌面端侧栏（项目、会话、目标） |
| `GET /raw/projects/:projectId/file` | 原始文件预览 |
| `GET /preview/proxy` | 本机 localhost 开发服务预览代理（含 WebSocket/HMR 升级） |

### 配对、设备与鉴权

| 端点 | 说明 |
| --- | --- |
| `GET/POST /api/pair/start`、`POST /api/pair/claim` | 发起配对 / 用配对码换取设备 token（claim 免鉴权） |
| `GET /api/devices`、`DELETE /api/devices/:deviceId` | 设备列表 / 撤销设备 |
| `POST /api/auth/token/rotate` | 轮换管理员或设备 token |
| `GET/PUT /api/config/https` | 局域网 HTTPS 与自签证书配置 |

### 项目配置

| 端点 | 说明 |
| --- | --- |
| `GET/POST/DELETE /api/config/project-roots` | 项目根目录白名单管理 |

### 会话与对话

| 端点 | 说明 |
| --- | --- |
| `GET /api/cloud-snapshots` | 云端只读快照列表，固定采集时间、摘要/消息导出类型及过期标记 |
| `POST /api/cloud-snapshots/import` | 严格字段的人工摘要/用户可见消息导入；仅保存本地副本 |
| `GET/POST /api/local-tasks`、`GET /api/local-tasks/:requestId` | 本地 Codex 提交与持久回执；全负载哈希校验，重复执行合并 |
| `GET /api/threads` | 会话列表（合并桌面历史、目标、置顶） |
| `GET /api/threads/search?q=&agent=&limit=` | 按消息正文搜索会话（先查事件缓冲，再扫最近 24 个线程的 Codex 历史，返回 threadId/标题/片段） |
| `GET /api/threads/:threadId/events?count=` | 事件回放（窗口裁剪、断线恢复） |
| `GET /api/threads/:threadId/events?turns=10` | 按用户对话轮次读取；折叠操作返回 `activityGroupId`、摘要和数量，正文延迟读取 |
| `GET /api/threads/:threadId/activity?groupId=` | 展开处理过程时读取操作类别与标识，`detailsDeferred=true` 表示正文尚未读取 |
| `GET /api/threads/:threadId/activity?eventIds=` | 展开具体操作时读取正文；参数为 JSON 字符串数组，单次最多 100 项 |
| `GET /api/threads/:threadId/submission?requestId=` | 查询发送状态 `processing/accepted/failed/unknown/uncertain`；新会话创建前使用 `_new` 作为 threadId |
| `GET /api/threads/:threadId/history-image` | 历史图片受限还原 |
| `POST /api/threads/:threadId/resume` | 恢复会话 |
| `PATCH /api/threads/:threadId` | 改名 |
| `POST /api/threads/:threadId/pin` | 置顶（仅 Codex） |
| `PATCH /api/threads/:threadId/goal` | 目标更新（仅 Codex，状态通过 Codex API 保存） |
| `GET/POST /api/automations`、`PATCH /api/automations/:id` | 读取 Codex 定时任务、为指定会话新建 heartbeat、编辑内容／间隔／执行会话、暂停／恢复；`threadId` 的修改写入 `target_thread_id`，cron 保留每次新建会话的语义；列表和保存回包包含会话名称及原始路径 |
| `GET /api/automations/targets?q=&limit=60` | 按名称、路径或 ID 查找执行会话，仅查询桌面数据库及会话名称索引；返回 `threads` 与 `hasMore`，排除已归档会话及子代理；`limit` 上限 500，不读取消息或恢复会话 |
| `POST /api/threads/:threadId/goal/continue` | 显式继续目标：先通过 thread/settings/update 保存当前模型、思考等级、权限和模式，再激活目标；携带 requestId 去重，不创建用户消息或额外 turn/start |
| `DELETE /api/threads/:threadId` | 删除会话 |
| `GET/POST /api/threads/:threadId/queue`、`PATCH/DELETE .../queue/:id`、`POST .../queue/:id/:action` | 待发消息队列（编辑/撤销/steer/retry；steer 支持桌面占用时改引导） |
| `GET /api/approvals`、`POST /api/approvals/:approvalId/resolve`、`POST /api/approvals/:approvalId/answer` | 审批列表 / 命令与权限审批 / 提问回答 |

### 文件与改动

| 端点 | 说明 |
| --- | --- |
| `GET /api/projects/:projectId/files`、`GET/PUT .../file` | 文件树、读取与保存（1MB 上限） |
| `GET /api/projects/:projectId/diff`、`.../diff/files`、`.../diff/file`、`.../diff/file/hunks` | 项目级/文件级/hunk 级 diff |
| `POST .../diff/file/accept|revert`、`.../diff/files/accept|revert`、`.../diff/file/hunk/accept|revert` | 单文件/批量/hunk 接受与撤销 |
| `POST /api/uploads/images`、`POST /api/uploads/files` | 手机上传图片（单张≤5MB，项目不另设图片张数上限）与文件（≤100MB，每消息最多 8 个） |

### 终端

| 端点 | 说明 |
| --- | --- |
| `POST /api/projects/:projectId/terminal/run`、`POST .../terminal/session` | 单次命令运行 / PTY 交互会话 |
| `GET /api/terminal/history`、`GET /api/terminal/commands`、`GET /api/terminal/commands/:commandId/output` | 历史恢复、命令聚合列表、分页输出 |
| `POST /api/terminal/:commandId/stop`、`POST /api/terminal/sessions/:sessionId/input|resize|stop` | 停止与交互输入/尺寸调整 |

### 设置、状态与用量

| 端点 | 说明 |
| --- | --- |
| `GET/PUT /api/settings/user`、`GET/PUT /api/settings/user/raw` | Codex 表单化配置 / config.toml 原文 |
| `GET /api/settings/approval-summary` | 审批策略摘要 |
| `GET/PUT /api/settings/remote-approval` | 桌面审批自动处理开关 |
| `GET /api/settings/public-access`、`PUT /api/settings/public-access/password` | 公网入口状态 / 公网独立密码 |
| `GET /api/usage?agent=&days=&threadId=` | 用量与配额（1-90 天） |
| `GET /api/network/openai` | 读取电脑端 Clash 中名称包含 OpenAI 的分组、当前选择和节点延迟 |
| `PUT /api/network/openai/node` | `{group,node}`，校验节点属于 OpenAI 组，切换后读回当前选择 |
| `POST /api/network/openai/test` | `{group,node}`，测试指定节点延迟，返回 `{delay}`（毫秒） |
| `GET /api/models?agents=all` | 模型目录（可合并外部助手模型） |
| `GET /api/codex/status`、`/api/codex/compatibility`、`/api/codex/upgrade-check` | 运行状态 / schema 兼容性 / 升级检查 |
| `POST /api/codex/start`、`POST /api/codex/restart` | 启动 / 重启 Codex |

公网入口只转发手机所需的子集（线程、队列、审批、上传、用量等），不开放 Web 控制台与终端。执行入口支持 Codex 和 Antigravity；Claude Code、Grok Build 的公网执行请求仍拒绝。公网设备必须同时提供独立密码、配对 token 和设备签名，项目访问沿用已授权工作目录，任务权限按客户端所选值传递。队列的编辑、移动、取消、重试和引导仅允许处理公网排队的消息。接口白名单见 `server/scripts/public-routes.mjs`，助手与队列限制见 `server/src/index.ts`。

### Antigravity 会话

`antigravity::基础模型` 与 `effort` 分别传给 AGY 的 `--model`、`--effort`；旧的 `-low/-medium/-high/-max` 模型变体仍可使用，历史设置也转成基础模型与强度。强度必须属于 CLI 支持的档位；模型目录提供可选项时，进一步按该模型校验。续接沿用已保存的 conversation、模型和强度；更换模型时按新模型选择默认强度。历史接口的 `settings` 返回 `{model,effort}`，供 Android 与网页恢复会话设置。

模型、强度及附件先校验，失败请求不创建空会话。同一会话同时提交两条消息只启动一个进程；另一条提示加入队列。AGY 工具输出快照转为增量，重复结果不重复累计用量；中断或异常退出会结束未完成的工具记录。`mode: plan` 传给 CLI 的 `--mode plan`。

AGY 无头 CLI 不支持图片消息与逐条审批；遗留 `ask` 请求会被拒绝并提示选择自动审批或完全访问，客户端已移除该选项。此限制与公网鉴权、项目边界分别处理。

### Claude Code 与 Grok Build（0.6.53）

模型目录通过 CLI 初始化握手读取，不发送提示词或创建任务。目录保留可选别名及其解析模型、各模型推理档位；`backends[].supportsImages` 表示 CLI 明确声明的图片能力，缺失表示未知。历史的 `settings.actualModel` 单独保存响应所报告的模型，不能用入口品牌或目录别名替代。

Claude 使用 stream-json 控制通道处理工具审批；`AskUserQuestion` 转成已有 `approvalType: question` 卡片，经 `/api/approvals/:id/answer` 回传实际答案。`mode: plan` 传给 CLI 的计划权限模式。Grok 使用 ACP，启动时明确覆盖 CLI 默认权限，续聊重新应用所选模型与推理强度；停止先取消会话再等待进程，必要时只终止所属进程树。已完成的编辑输出 `file.changed`；存在结构化差异时提供 `diff`，被拒绝的编辑不报告成功。

AGY/Claude 的原生发送与队列保留 `mode`。当前 Grok ACP 的计划切换及外部后端的统一快速模式会被明确拒绝。账号额度窗口未提供时返回空窗口，不从 Token 用量推算剩余额度。

### 远程会话与提交确认（0.6.40）

云端快照 ID 使用 `cloud-snapshot:` 前缀；`source=cloudSnapshot`、`readOnly=true`。`snapshotUpdatedAt` 是采集时间，`snapshotStatus` 是当时状态，超过 5 分钟标记过期。`snapshotContentKind=summary|messages` 区分人工摘要与消息导出；两者都不会实时同步。HTTP 修改与 WebSocket 控制均拒绝快照 ID。

`command.accepted` 与既有 `message.confirmed`、`user.message`、`message.queued` 共用原生确认路径。Codex 执行由 `command-receipts.json` 唯一记账；`messageSubmissions.ts` 保留原确认接口及其他助手的兼容路径。`starting` 对应原接口的 `processing`；`accepted` 仅表示接受提交或进入队列（`queued=true`），不表示模型任务完成。`uncertain` 禁止重新执行；`failed` 且 `retryAllowed=true` 表示明确的 writer 拒绝，可用原 ID 和负载重试。原生客户端持久保存原始消息命令，线程创建后的 ID 更新不会改变重试负载。

新任务默认 `gpt-6-sol/high`；Astra 默认 `medium`。显式模型和思考等级保留，不修改全局配置。REST 继续会话时未指定模型会沿用可读取的线程设置。请求负载中的图片、文件、模型、权限、思考等级及其他字段都参与完整哈希；同 ID 的不同负载拒绝，即使默认值归一化后相同。完整接口及示例见 [远程会话](remote-sessions.md)。


## 会话未读与筛选

Gateway 0.6.88 的 `GET /api/threads` 支持 `filter=all|running|unread`，能力标记为 `thread-sidebar-filters`。先按代理、项目和会话家族筛选，再分页；`hasMore` 对应匹配家族。子代理匹配时保留所属主会话及子代理树。`include` 中的当前会话额外返回最新元数据，客户端按筛选条件决定是否显示。

电脑端未读集合改变时，通过 WebSocket 发送 `thread.read-state.changed`，客户端重新获取当前列表和展开的项目。此事件不持久化、不重放，也不携带可直接清除某一轮未读的回执。监听目录中的原子替换，300 毫秒合并文件变化，5 秒读取兜底；读取或 JSON 解析失败不发布状态变化。手机已读仍通过 `POST /api/threads/:threadId/read` 提交 `completedAt`，`thread.read` 回执只清除已观察到的完成结果。

## 内网会话输出文件

`GET /api/threads/:threadId/output-file/:name?eventId=&path=`：已配对内网客户端读取该助手可见回复中实际引用的本地文件。原始历史事件和连续流式分片均支持；仅返回文件字节（最大 50 MB），不修改项目配置。不存在于该回复的链接、非助手消息、目录和云快照拒绝。公网仅允许该回复中实际引用且位于已授权项目内的图片，并核验图片格式及 20 MB 上限。能力标记为 `local-thread-output-files`。

Gateway 0.6.72 支持可选 `source` 参数，表示该回复中实际引用的 Markdown 文件。仅限内网：来源文档不超过 5 MB，目标必须是文档中的图片引用，真实路径位于文档目录内，且通过图片格式及 20 MB 检查。不会扩大持久项目授权；公网读取关联图片应走原有已授权项目路径。
