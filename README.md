# Codex Mobile Control

一个运行在局域网内的触屏优化 Codex 控制台。电脑端负责运行 Codex、读取项目、管理配置和代理预览；手机端负责连接、对话、审批、查看终端和预览文件。

## 项目分工

本仓库负责远程聊天网页、原生 Android 及其聊天协议。电脑端账号、额度、模型路由和服务管理由另行安装的 Local Console 负责；沿用同一网关与配对数据，不重复建设电脑管理界面。

## 目标

- 手机与电脑在同一局域网即可控制本机 Codex。
- 对话体验接近 Codex 移动版，但更适合本地开发。
- 终端、diff、文件和预览直接在手机端展开，不依赖下载。
- 断线后可恢复同一个线程和事件缓冲。
- 后续可增加 Telegram、微信等控制入口。

## 当前结构

```text
docs/       架构、协议和迭代计划
server/     电脑端 Gateway，负责鉴权、项目、配置、Codex 桥接和事件流
android/    安卓 Compose 客户端
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

## Web 控制台

启动电脑端后可打开：

```text
https://127.0.0.1:38457/console
```

网页版是当前主要使用和调试入口，支持桌面与手机浏览器：

- 项目与会话导航、Markdown 流式对话、审批、停止任务及断线重连。
- 独立文件工作区，支持编辑、未保存提醒、HTML/Markdown/图片预览和中文路径 Git diff。
- xterm.js 交互终端，支持输入、控制键、窗口尺寸同步和历史输出。
- 本机网站预览、动态接口请求和 Vite 热更新，Codex 设置、设备配对与管理。

修改 `server/public/` 中的 HTML、CSS 或 JavaScript 后，刷新浏览器即可查看；修改服务端 TypeScript 时，`npm run dev` 会自动重启服务。Android 使用独立原生 Compose 界面，共用远程聊天协议。

Web 控制台也可以生成二维码，Android 端支持 `codex-control://pair?...` 深链路配对。
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
# 电脑端与 Android 快速入口

双击根目录的 `打开电脑控制台.cmd`，自动启动网关并打开手机配对界面。在界面中选择手机能访问的电脑地址，扫描二维码或输入配对码。首次构建前在 `server` 执行 `npm ci`。

Android 当前安装包：[Codex-Control-0.6.26.apk](artifacts/Codex-Control-0.6.26.apk)。手机浏览器可从电脑控制台显示的局域网 HTTPS 地址加 `/downloads/android.apk` 下载。安卓使用原生 Compose 界面；一轮任务的思考摘要、工具执行、文件改动、图片查看和上下文压缩收进同一个可展开的处理过程。桌面端异步提问会在手机弹出回答框，电脑上的回答按正文显示；内网连接时，桌面运行中的会话可以把待发消息改为引导。模型与思考强度使用同一个弹层，三星设备的图片与视频优先打开三星相册、文件优先打开三星文件。详细构建和使用说明见 [原生 Android](docs/native-android.md)。

如已配置公网手机入口，它只转发手机所需的接口，不开放网页控制台和终端。在电脑控制台点击“手机配对”显示二维码；手机打开“连接电脑”→“扫描电脑二维码”，也可以使用系统相机扫描。二维码包含网关证书指纹和已配置的公网地址。公网独立密码可在内网网页版“设置 → 公网连接”修改，现有密码不会因更新网关而改变；密码也保存在本机 `~/.codex-mobile-control/public-password.txt`，需要在手机“连接电脑”中另行填写。公网文件接口限制在已授权的项目工作目录内，公网发起的 Codex 回合强制使用“询问”权限。

如果 38457 端口由 Local Console 安装目录中的网关提供服务，修改仓库不会自动更新它。双击 `更新电脑网关.cmd` 将构建结果同步到实际安装目录；脚本会检查运行任务并保留旧程序备份。

公网 API 入口和 Cloudflare Tunnel 由 `CodexMobilePublicEntry`、`CodexMobileTunnel` 两个登录任务在后台运行。需要重新安装无窗口启动方式时，运行 `Install-BackgroundTasks.ps1`；它只替换这两个任务的启动动作并保留原有登录触发器。





远程聊天 0.6.0 新增独立助手工作区（Codex / Claude Code / Antigravity / Grok Build），入口在侧栏顶部。安装与验证边界见 [原生安卓说明](docs/native-android.md#060独立助手工作区)。模型只在当前助手内切换，已有会话不跨助手迁移。
