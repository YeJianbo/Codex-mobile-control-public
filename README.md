# Codex Mobile Control

一套配合本机 Web 控制台使用的 Android / Web 聊天与电脑网关。手机和网页负责对话、审批、文件及终端；Web 管理后台统一管理账号、额度、模型、中转、执行器、手机绑定和渠道接入。

## 下载与安装

当前配套发行版为 **0.6.446**，见 [GitHub Releases](https://github.com/YeJianbo/Codex-mobile-control/releases/tag/v0.6.446)。本版优化应用内通知圆角，修复新结果未读和桌面写入冲突排队；所有 Harness 默认允许公网连接，并可在助手管理中分别关闭。跨 Harness 能力及实际检查结果见 [功能对照](docs/feature-parity.md)。

| 文件 | 适用情况 |
| --- | --- |
| `Codex-Control-0.6.446.apk` | 手机安装或覆盖升级；完整修复需配套新网关 |
| `Codex-Control-0.6.446-Setup-x64.exe` | 新电脑安装，内含 Web 控制台、Gateway、Node 及生产依赖 |
| `Codex-Control-0.6.446-Windows-x64-Release.zip` | Windows 安装程序、配套 APK、使用说明与组件清单 |

首次使用按 [安装与绑定说明](docs/installation.md) 完成电脑安装和手机扫码；日常操作见 [手机使用说明](docs/mobile-usage.md)。仓库为私有时，下载需要登录有访问权限的 GitHub 账号。

开始新改动前先看 [当前工作与完成状态](docs/work-status.md)：其中登记正在做的事项、已经实现的功能、验证边界和待调查问题，避免重复实现。

电脑安装前先安装并登录 Codex 桌面版。安装后的快捷方式打开 Web 管理后台，在“接入 → 网关与手机”中设置连接、密码和绑定；关闭网页后，后台服务继续运行。

## 项目分工

本仓库包含 Android、Web 聊天、Gateway 和 Windows 配套安装器。Web 管理服务 Local Console 是配套组件，Windows 整包已包含其运行文件；Android 和 `/manage/` 通过同一个网关访问它，使用同一份账号、模型、额度与统计配置。源码开发只启动 Gateway 时，聊天可独立运行，完整管理功能仍需要配套 Local Console。

| 入口 | 地址 | 用途 |
| --- | --- | --- |
| 本机 Web 管理 | `http://127.0.0.1:25819/` | 账号、模型、中转、统计、接入和维护 |
| Web 聊天 | `https://电脑地址:38457/console` | 会话、消息、审批、文件和终端 |
| 网关内管理页 | `https://电脑地址:38457/manage/` | 沿用设备授权进入管理后台 |
| Android | 扫描后台绑定二维码 | 手机操作，连接同一网关 |

端口以实际安装配置为准。管理服务只监听回环地址，远程管理经网关认证转发；安装器的`-ConsolePort`会同时用于管理服务和网关，源码启动则给两者设置相同的`LOCAL_CONSOLE_PORT`，默认25819。

## 目标

- 手机与电脑在同一局域网即可控制本机 Codex。
- 对话体验接近 Codex 移动版，但更适合本地开发。
- 终端、diff、文件和预览直接在手机端展开，不依赖下载。
- 断线后可恢复同一个线程和事件缓冲。
- QQ 官方机器人与微信 iLink 私聊入口：在电脑管理后台的“QQ / 微信”中配置；首次文字消息自动新建 Codex 会话，后续消息继续同一会话。支持状态、结果、停止与新会话指令，详见 [接入说明](docs/installation.md#qq--微信)。

## 当前结构

```text
docs/       架构、协议和迭代计划
server/     电脑端 Gateway，负责鉴权、项目、配置、Codex 桥接和事件流
android/    安卓 Compose 客户端
ios/        SwiftUI + WKWebView 的 iPhone / iPad 工程
```

## 快速启动电脑端

```powershell
cd server
npm install
npm run dev
```

默认监听 `0.0.0.0:38457`。首次启动会在 `~/.codex-mobile-control/server.json` 创建局域网访问 token。

更多开发和验证步骤见 [docs/development.md](docs/development.md)。
相近开源项目和可借鉴方向见 [docs/research.md](docs/research.md)。

## Web 聊天与后台管理

启动电脑端后可打开：

```text
https://127.0.0.1:38457/console
```

聊天页独立运行，支持桌面与手机浏览器：

- 项目与会话导航、Markdown 流式对话（代码块语法高亮、打字光标）、审批、停止任务及断线重连；支持会话正文搜索与后台桌面通知（审批/完成提醒）。
- 独立文件工作区，支持编辑、未保存提醒、HTML/Markdown/图片预览和中文路径 Git diff。
- xterm.js 交互终端，支持输入、控制键、窗口尺寸同步和历史输出。
- 本机网站预览、动态接口请求和 Vite 热更新；文件上传带实时进度。
- 侧栏“后台管理”另开同一网关的 `/manage/`；账号额度、模型账户、绑定和渠道设置统一跳转管理页。

修改 `server/public/` 中的 HTML、CSS 或 JavaScript 后，刷新浏览器即可查看；修改服务端 TypeScript 时，`npm run dev` 会自动重启服务。Android 使用独立原生 Compose 界面，共用远程聊天协议。

本机管理入口为 `http://127.0.0.1:25819/`。在“接入 → 网关与手机”生成二维码、设置公网地址和密码、管理设备；“接入 → QQ / 微信”支持微信扫码和 QQ 凭据配置。桌面快捷方式直接打开 Web 控制台。Android 端支持 `codex-control://pair?...` 深链路配对。
浏览器使用当前网址的 Gateway；手机打开电脑的局域网地址，输入配对码即可连接。第一次在电脑上登录时，访问 Token 位于 `~/.codex-mobile-control/server.json`。

Windows 下优先使用 PATH 中的原生 `codex.exe`，再回退到 npm 的 `codex.cmd`。可通过 `CODEX_MOBILE_CONTROL_CODEX_BIN` 指定可执行文件。这样可以避免旧版 npm CLI 无法读取新版桌面端配置的问题。

## 自动化验证

```powershell
cd server
npm run smoke
npm run test:web
```

Smoke test 会启动 Gateway，并用 Codex mock 验证健康检查、Web 控制台、配对、设备列表/撤销、项目、文件、raw 预览、diff、threads、approvals、终端分页、交互式终端会话、Codex 状态、app-server schema 兼容性和崩溃自动恢复。
它也会验证 WebSocket 实时事件和断线后最近事件回放。
`test:web` 使用隔离的项目和 Codex 配置，通过真实浏览器、HTTP、WebSocket、Git 和 PTY 测试界面；Codex 模型响应由协议夹具提供。测试截图位于 `artifacts/`。详情见 [网页验证](docs/web-verification.md)。

## 设计原则

电脑端是唯一执行环境，手机端只是控制台。不要把 Codex App Server 直接暴露到局域网或互联网；本项目的 Gateway 会负责设备配对、鉴权、重连、预览代理和多入口适配。

新建会话未选择项目时，沿用 Codex 配置的 `[desktop].projectlessWorkspaceRoot`，未配置时使用 `~/Documents/Codex`，在根目录下按日期与任务名创建独立目录。选择项目时使用所选目录；已有会话继续使用其原工作目录。
# 电脑端与 Android 快速入口

双击根目录的 `打开电脑控制台.cmd`，自动启动网关并打开手机配对界面。在界面中选择手机能访问的电脑地址，扫描二维码或输入配对码。首次构建前在 `server` 执行 `npm ci`。

Android 当前 Release 安装包：[Codex-Control-0.6.315.apk](/D:/codex/deliverables/Codex-mobile-control/Codex-Control-0.6.315.apk)。手机浏览器也可从电脑控制台显示的局域网 HTTPS 地址加 `/downloads/android.apk` 下载。安卓使用原生 Compose 界面；子代理从会话右上角小按钮打开，处理过程在回复开头展开／收起，任务完成后默认折叠。历史每次读取 10 轮对话，展开处理过程后再取操作类别，点开具体操作才取命令正文；发送未确认或失败时保留原文与附件，重试先确认上次结果；用量周期切换保持窗口高度。图片预览支持缩放和平移、同一消息内连续左右滑动，原尺寸下拉关闭；PDF 可连续滚动阅读。图片缩略图显示在发送气泡上方，顶部圆环可查看上下文用量；处理过程按原始顺序分段，上下文压缩单独显示。桌面端异步提问会在手机弹出回答框；运行中发送的消息加入队列，待发项可在菜单中改为引导。“编辑文件／查看改动”在独立阅读页显示补丁。模型菜单内思考强度旁的闪电图标可直接切换 Fast，默认读取当前会话状态，手机默认缓存上次成功取得的目录；没有目录时使用默认模型与 high。打开或保存文件即时显示通知条，慢响应与失败都有提示和重试入口。停止时等待电脑确认，期间不能重复点击，失败或未确认时显示原因。实时额度剩余 10% 及以下会在输入框上方提示具体比例与重置时间；耗尽或模型 capacity 不足时显示页面通知条，可关闭并保留输入；最新执行失败卡片提供“重试”，目标续跑失败可直接重试目标，普通请求重试保留正在编辑的新草稿。长文字与图片在输入内容区滚动，模型和发送按钮独立保留；右上菜单及连接面板提供“Clash · OpenAI 节点”，可查看当前选择、切换节点和测试延迟。这两类错误不触发状态栏任务通知。“电脑控制台”可查看跨会话统计、更新模型目录、启用或隐藏模型并设置电脑默认模型。后台完成通知显示本轮答复摘要，点击可打开对应会话。详细构建和使用说明见 [原生 Android](docs/native-android.md)。

如已配置公网手机入口，它只转发手机所需的接口，不开放网页控制台和终端。在电脑控制台点击“手机配对”显示二维码；手机打开“连接电脑”→“扫描电脑二维码”，也可以使用系统相机扫描。二维码包含网关证书指纹和已配置的公网地址。公网独立密码可在 Web 控制台“接入 → 网关与手机”修改，现有密码不会因更新网关而改变；密码也保存在本机 `~/.codex-mobile-control/public-password.txt`，需要在手机“连接电脑”中另行填写。公网文件接口限制在已授权的项目工作目录内；已认证的手机可选择会话权限，并可执行 Codex 和 AGY 会话。AGY 的无头 CLI 不支持图片和逐条审批，具体会话行为见 [协议说明](docs/protocol.md)。

如果 38457 端口由 Local Console 安装目录中的网关提供服务，修改仓库不会自动更新它。双击 `更新电脑网关.cmd` 将构建结果同步到实际安装目录；脚本会检查运行任务并保留旧程序备份。

已安装 Local Console 时，`LocalCodexConsoleGuard` 每 10 秒检查公网 API 入口和 Cloudflare Tunnel 就绪状态，失效后在后台恢复。没有使用此守护时，可通过 `Install-BackgroundTasks.ps1` 安装原有的登录启动任务。





远程聊天 0.6.0 新增独立助手工作区（Codex / Claude Code / Antigravity / Grok Build / DeepSeek Harness / Hermes），入口在侧栏顶部。安装与验证边界见 [原生安卓说明](docs/native-android.md#060独立助手工作区)。模型只在当前助手内切换，已有会话不跨助手迁移。

远程会话已加入云端只读快照导入和本地 Codex 持久回执，使用方式见 [远程会话](docs/remote-sessions.md)。0.6.127 需配套 Gateway 0.6.39；最终交付见 `deliverables`，本轮没有更新正在运行的正式网关。

## iOS / iPadOS 与大屏

Android 0.6.315 在窗口宽度达到 840dp 时使用常驻侧栏，会话限制最大宽度，弹层适配大屏。iOS 使用网页套壳与原生连接面板，iOS 26 连接栏使用 Liquid Glass；工程与 Mac 构建步骤见 [iOS 说明](ios/README.md)。当前交付源码工程，没有 IPA。助手账号配置见 [Harness 说明](docs/harnesses.md)。
