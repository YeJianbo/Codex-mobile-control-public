# Gateway 协议

## HTTP

所有请求除 `/health` 外都需要：

```http
Authorization: Bearer <token>
```

### `GET /health`

返回服务、协议版本和能力列表。Android 连接前会先用它检查协议兼容性。

```json
{
  "ok": true,
  "version": "0.1.0",
  "protocolVersion": 1,
  "minAndroidProtocolVersion": 1,
  "capabilities": ["pairing", "terminal-commands", "websocket-heartbeat"]
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
{ "type": "error", "message": "..." }
```
