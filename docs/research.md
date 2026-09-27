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
