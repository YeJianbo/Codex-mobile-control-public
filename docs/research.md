# GitHub 调研

## 官方开源情况

- Codex CLI 是开源项目，仓库为 `openai/codex`，核心实现以 Rust 为主。
- 目前可直接借鉴的是 CLI、`codex app-server`、SDK、协议和命令行行为；官方 ChatGPT/Codex 移动端和桌面 App UI 本身没有找到可直接复用的开源客户端代码。
- `codex app-server` 已在官方仓库中公开，是本项目 Gateway 桥接的主要依据。

## 相近项目

### Remodex

仓库：`Emanuele-web04/remodex`

方向：本地优先 bridge + iOS App，用手机控制 Mac 上的 Codex。亮点是二维码配对、安全会话、移动端线程体验、git 操作和通知。

可借鉴：

- 配对流程和首次启动体验。
- 手机端 thread 列表、运行状态、通知入口。
- Git 操作的移动端信息架构。

差异：

- Remodex 以 Mac + iPhone 为主；本项目优先 Windows/Android/LAN。
- 本项目更强调手机端直接查看电脑终端、文件、diff、dev server 预览和 Codex 设置。

### Relaydex

仓库：`Ranats/relaydex`

方向：Remodex fork，聚焦 Windows 本机 Codex + Android 控制。

可借鉴：

- Windows host 上的 bridge 启动与配对 UX。
- Android 端连接状态与异常处理。

差异：

- 本项目已经有独立 Gateway、Android Compose 客户端和 Web 控制台，不需要跟随 fork 结构。

### CodexMonitor

仓库：`Dimillian/CodexMonitor`

方向：监控多个 workspace 的 Codex 状态，管理 app-server、resume threads、未读/运行状态。

可借鉴：

- 多 workspace 状态看板。
- 每个 workspace 独立 app-server 的生命周期策略。
- thread pin/rename/archive/draft/interrupt 这些会话管理能力。

### codex-app-mobile

仓库：`shuto-S/codex-app-mobile`

方向：SwiftUI iOS 客户端，通过 `codex app-server` WebSocket 操作远程机器，另有 SSH fallback。

可借鉴：

- 直接 app-server WebSocket 协议映射。
- SSH fallback 思路。

差异：

- 本项目选择手机不直连 app-server，而是通过 Gateway 做鉴权、重连、事件缓冲和多入口复用。

### friuns2/codex-mobile

仓库：`friuns2/codex-mobile`

方向：浏览器可访问的 Codex app-server bridge/UI，覆盖 Linux、Windows、Termux 等场景。

可借鉴：

- Web UI 的低门槛调试入口。
- Termux/浏览器移动访问路径。

### Discord/Telegram 类桥接

相关方向：`codex-mobile` Discord bridge、`codex-discord`、OpenAI Codex discussions 中的远程控制原型。

可借鉴：

- 将审批、消息、任务队列抽象成 Gateway 事件，而不是绑定某一个 UI。
- 先支持“接收状态、发送 prompt、审批允许/拒绝、停止任务”四个高频动作。

## 本项目路线判断

本项目继续采用：

```text
Android / Web / TG / 微信
  -> Local Gateway
  -> codex app-server
  -> 本机项目和终端
```

不要让每个入口各自实现 Codex 协议。所有入口只消费 Gateway 的 HTTP + WebSocket 协议，Gateway 负责：

- app-server 生命周期和版本检测。
- 设备配对、token、撤销和审计。
- thread 映射、事件缓冲、断线恢复。
- 终端、文件、diff、预览代理。
- 多入口共享审批队列。

## 后续借鉴优先级

1. Remodex/Relaydex：配对和移动端会话 UX。
2. CodexMonitor：workspace/thread 状态管理。
3. 官方 `openai/codex` app-server：协议兼容和生命周期。
4. Discord/Telegram bridge：消息入口和审批动作抽象。


## 2026-10-07：控制台接入微信与 QQ

### 结论与接入路线

两者都有可用的官方技术路径。建议在现有 Gateway 前增加消息通道适配，复用桌面会话，不为每个平台重新启动一套 Codex。工程顺序建议先接 QQ 官方 Node.js SDK，再实现微信 iLink 适配；这是基于当前 Node/TypeScript 网关和可复用 SDK 的判断，不是账号开通或端到端运行承诺。本次只调研与记录，没有安装插件、登录平台、发送消息或修改运行代码。

| 入口 | 接入方式 | 对本项目的判断 |
| --- | --- | --- |
| 微信 | Tencent/openclaw-weixin 的扫码登录及 iLink HTTPS 长轮询 | 优先按官方协议和实现复用通信层；先做自己的机器人私聊，不把协议里的 group_id 当群聊已经可用 |
| QQ | @tencent-connect/qqbot-nodejs，AppID / AppSecret，出站 WebSocket | 与现有 Node ESM 最接近，可直接集成 SDK；支持私聊、媒体及私聊流式回复，具体场景权限需用自己的机器人账号核验 |
| 企业微信 | 智能机器人 API 长连接，Bot ID / Secret | 接受企业微信入口时可选；区别于单向通知用的群机器人 Webhook |
| 普通 QQ 账号 | NapCat / OneBot 11 | 社区备选，需要维护 NTQQ 运行环境，属于普通账号协议端，不等于 QQ 官方机器人；接入优先使用其网络接口，分发前另核对项目许可证 |

微信官方插件支持扫码和多种媒体，安装该插件本身要求 OpenClaw。官方仓库另外提供了用于后端集成的协议说明，因此自建适配器有实现依据，但不是把插件直接装进本项目就能用。[微信官方项目](https://github.com/Tencent/openclaw-weixin)、[后端协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)。

QQ SDK 提供协议和类型，不承载模型业务，支持 WebSocket / Webhook 两种接收方式；本机常驻控制台优先选出站 WebSocket。QQ 方案无需引入 OpenClaw。[QQ 官方 SDK](https://github.com/tencent-connect/qqbot-nodejs)。

微信长轮询、QQ 出站 WebSocket 和企微长连接都能由电脑主动发起，不需要为接收消息开放电脑管理接口的公网入站端口；电脑仍须联网并保持服务运行。企微入口、凭据和长连接流程见[腾讯云文档](https://cloud.tencent.com/document/product/1831/137051)。NapCat 的 HTTP / WebSocket 对接见[项目网络文档](https://doc.napneko.icu/onebot/network)，项目性质与许可证入口见[仓库](https://github.com/NapNeko/NapCatQQ)。

### 已核对的本地接点

- `server/src/index.ts`：`POST /api/local-tasks` 已接收带 requestId 的 Codex 新任务或续接任务，返回提交回执；`GET /api/local-tasks/:requestId` 可查提交状态。该接口当前是 Codex 文本任务入口，不能假定已覆盖其他后端或附件。
- 同文件 `/ws` 已接收 `thread.start`、`turn.start`、`turn.interrupt`、审批等命令，并执行模型、项目访问与身份检查。多模态与其他后端可沿用这条入口。
- `/api/threads`、`/api/threads/:threadId/events` 可查询会话与历史，`/api/approvals`、审批回答和处理接口可复用。
- `server/src/services/eventHub.ts` 已推送任务、消息和审批事件，连接时会回放缓存事件。通道适配器必须根据用户与会话绑定筛选，再发往聊天平台。
- `docs/roadmap.md` 原有微信 adapter 处于暂缓状态；本次调研不将其改成已实现。

建议结构：

```text
微信 iLink / QQ SDK
        ↕
通道适配器：账号绑定、会话映射、收件去重、出站消息
        ↕ 本机鉴权 HTTP + WebSocket
现有 Gateway → 桌面共享会话 → 本地项目
```

适配器只做传输与显式指令分发，普通文本进入既有模型会话；不在 OpenClaw 或另一套框架中再跑一次模型理解。若后续决定复用整个 OpenClaw 插件，需单独对接其消息处理流程，避免产生第二套会话和任务执行器。

### 控制台与聊天侧的操作设计

控制台增加消息通道设置：微信扫码登录；QQ 填写 AppID / AppSecret；展示实际在线状态、最近错误、重连与解绑。凭据只保存在本机配置中，不进入安装包。绑定使用平台提供的稳定用户 ID，先允许自己的账号；群场景另设群与操作者范围。

第一版建议支持：列出已授权项目与会话、选择会话、普通文字发任务、查询状态、停止、收到最终结果、处理既有审批。绑定键包括平台、机器人账号、聊天和操作者，指向现有 threadId；发送新任务前回显目标，避免操作错误项目。Android、网页和聊天入口能看到同一线程。

平台重复投递的消息映射到同一个 requestId，先复用网关回执确认是否已受理，避免重连时重复执行。审批按钮或文字回复对应具体 threadId / approvalId，并验证操作者；沿用现有审批流程。图片、文件后续接到现有上传机制，发送产物时沿用文件访问范围。

### 平台限制与必须核验的项

1. **微信上下文**：官方协议建议回复携带入站 context_token，类型定义不能证明服务器接受缺少该字段的请求；文档也明确说明 group_id 字段不代表群聊功能已实现。先做私聊及有上下文的回复，主动通知能力单独实测。[协议说明](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)
2. **QQ 长任务**：SDK 的 C2C 流式消息要求关联五分钟内的入站消息，按完整文本更新；主动消息路径受额度限制。普通私聊、群聊和流式回复不能混用同一个时间限制。[SDK 使用指南](https://github.com/tencent-connect/qqbot-nodejs/blob/main/USAGE.md)
3. **QQ 文档差异**：旧 bot-docs 仍写主动推送自 2025-04-21 停止，新官方 SDK 和插件提供主动发送接口并说明可能被平台拦截。当前证据不足以保证任意机器人都有稳定主动推送权限。应以拟使用 AppID 的后台能力和实际响应为准，不把旧额度直接当现行统一规则。[旧平台文档](https://github.com/tencent-connect/bot-docs/blob/main/docs/develop/api-v2/server-inter/message/send-receive/send.md)、[新插件说明](https://github.com/tencent-connect/openclaw-qqbot/blob/main/README.zh.md)
4. **长时间任务的结果交付**：任务在 Gateway 独立运行并保存结果；聊天侧只报告平台确认成功的投递。超出平台回复窗口时，用户发“状态／结果”仍能取回，不能无限重发或重复启动任务。
5. **接入验证顺序**：先核对微信扫码可用性／QQ 机器人场景权限；再验证绑定账号的双向文本、正确线程、断线后的去重恢复、停止与审批；最后专门验证长任务和图片／文件。当前没有平台账号授权与联调证据，因此结论是接口与架构可行，尚未接通。
