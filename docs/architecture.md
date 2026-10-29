# 架构

## 总览

```text
Android App / Web 聊天
  | HTTPS + WebSocket
  v
Local Gateway
  |-- JSON-RPC / stdio / WebSocket --> Codex 共享后端及其他 Harness
  |-- 文件、终端与预览 --> 本机项目
  |-- 认证后的固定管理路由 --> Local Console (127.0.0.1:25819)
                                | 账号、模型、中转、额度、统计与接入
                                v
                             本机配置与凭据
```

Windows配套发行包同时包含Local Console、Gateway和Android APK。`/console`是聊天页，`/manage/`复用Local Console的管理界面并经网关认证转发API；本机快捷方式直接打开25819。二者是独立进程、同一套配套部署。此仓库包含客户端、网关及整包安装器；打包器读取当前已安装Local Console的运行文件与生产依赖，所以仅克隆并启动Gateway不等于启动了完整管理后台。

默认共享模式下，`shared-backend.mjs` 是独立后台进程，负责启动并监督唯一的 WebSocket app-server。Gateway 启动时确保后台存在，异常断线后重连；后台对子进程崩溃做退避重启。桌面的 `desktop-bridge.mjs` 只转发 stdio 到同一个后端，桌面退出不会终止后端。后台保留正在执行的桌面连接及审批转发，桌面结束后手机仍可处理待审批请求。

共享 RPC、桌面转发和审批监听均仅绑定 127.0.0.1，并验证受保护目录中的随机令牌。独立进程锁避免多个客户端同时拉起重复后端。首次从旧的独立桌面进程迁移时，原进程仍可能占有会话写锁；必须正常退出一次，不能同时接管其写入。后续桌面和手机复用相同进程。

## 为什么需要 Gateway

`codex app-server` 是官方提供给富客户端的接口，但 WebSocket transport 仍是 experimental。非 loopback 监听还必须谨慎处理鉴权。因此本项目不让安卓端直连 app-server，而是由 Gateway 负责：

- 局域网 token 鉴权和后续二维码配对。
- 项目白名单和路径约束。
- Codex app-server 生命周期管理。
- 事件缓冲和断线重连。
- 终端、文件、预览代理。
- Telegram、微信等多入口复用。

非 Codex CLI 的进程生命周期、网关重启行为与恢复流程见 [CLI Agent Host](agent-host.md)。

## 数据模型

Gateway 0.6.90 在历史消息分页后恢复上传附件信息：仅将当前上传存储根目录内的 `<id>/content` 路径匹配到对应元数据，沿用附件 ID 和文件完整性检查。可恢复的条目转为 `files`，其他路径或缺失附件保持原记录；已有文件按 ID 去重，不改写原始历史。先生成历史图片 URL，再移除已恢复的文件附件，保留原图片索引。Android 和 Web 因而沿用现有上传附件预览入口，无需授权上传目录作为项目。

Gateway 0.6.89 的待发消息取回协议使用原队列 SQLite 记录保存 `editing` 状态。`POST /api/threads/:threadId/queue/:id/restore` 在持久化成功后暂停此条发送，重复调用返回同一份原文和附件；队列读取通过 `drafts` 返回这些待恢复条目。其后的消息仍按原顺序发送。客户端完成草稿持久化后才调用 `POST .../restore/complete` 移除电脑副本，重复完成请求可安全返回成功。

Android 将草稿内容、附件和已应用标记放在同一次 SharedPreferences 编辑中，后台 `commit()` 确认写盘后再完成协议；其等待未完成 `apply()` 的语义见 [Android Editor 文档](https://developer.android.com/reference/android/content/SharedPreferences.Editor#apply())。Web 先保存恢复中的副本，再保存各草稿映射；尚未完成本地保存时，重新载入恢复副本，保存完成但确认丢失时只继续确认。同一条原消息不会重复合入草稿。两端仅在电脑声明 `queue-draft-recovery` 能力后使用此协议。

- Project：一个可被手机控制的本地目录。
- Thread：Codex 对话线程。
- Turn：一次用户请求和 Codex 执行过程。
- Event：对话增量、终端输出、工具状态、文件变更、审批请求。
- Settings：用户级或项目级 Codex 配置。

## 触屏体验要求

- 对话消息逐字流式显示。
- 终端块默认内嵌，可展开/折叠。
- 文件和预览不下载，直接在 App 内查看。
- 命令审批使用大按钮和清晰风险提示。
- 设置使用分组表单，避免让用户直接编辑 TOML。


## QQ / 微信官方通道（Gateway 0.6.82）

QQ 使用 `@tencent-connect/qqbot-nodejs` 1.0.4 出站 WebSocket；微信按腾讯 iLink 协议实现扫码与 HTTPS 长轮询。配置页只包含官方登录入口和新会话的工作目录。官方私聊首次文字消息自动创建 Codex 会话，后续消息继续该聊天的会话；不同平台、机器人及私聊各自维护对应关系。

`channels/service.ts` 与 `channels/store.ts` 保存会话映射和入站 requestId，复用 `submitLocalTask`、项目权限检查、提交回执和 SessionManager。创建线程的事件带 requestId 时立即关联会话，防止快速完成的任务漏掉回传。旧消息重投共用回执，切换到新会话后旧消息不重新执行。

`channels/qq.ts` 完成官方 AppID/AppSecret 登录与 SDK 生命周期；`channels/weixin.ts` 实现二维码、验证码、官方域名重定向、长轮询游标、扫码身份和 context_token 回复。运行状态以握手或有效轮询响应为准；认证失效显示错误，断开通过 AbortSignal 终止连接。已启用的通道在网关重启后恢复。

`channels/delivery.ts` 收集助手正文，完成后发送文本结果；平台未确认的发送不标记成功，也不重启任务。`/结果` 从 Codex 历史或本机已收结果读取并分页，避免依赖平台长时间主动回复权限。支持 `/状态`、`/停止`、`/新会话`、`/帮助`；图片文件与审批仍由已有手机/电脑入口处理。

本机 `channels.sqlite` 存放机器人配置、密钥、游标、回复上下文和会话映射。公开状态 DTO 不返回密钥。配置路由只接受 loopback 管理员，或由本机 Windows 管理程序签发、绑定当前已配对浏览器的短期通道设置授权；公网代理和其他配对设备不能配置机器人。网页实际入口在 `public/channels-ui.js`，Windows 的 `installer/instance.mjs` 负责随“管理后台”开启本机设置权限。

主要接口：

- `GET /api/channels`：驱动、连接状态和工作目录。
- `POST /api/channels/accounts` / `DELETE /api/channels/accounts/:id`：创建或清除官方机器人配置。
- `PUT /api/channels/accounts/:id/credentials`：QQ 凭据。
- `PUT /api/channels/accounts/:id/settings`：工作目录。
- `POST /api/channels/accounts/:id/login`：微信扫码及验证码。
- `POST /api/channels/accounts/:id/connect` / `disconnect`：连接生命周期。

TypeScript 构建及 7 项本地协议模拟检查通过，覆盖自动会话隔离、消息去重、结果路由、扫码上下文、断开取消、密钥不回传和本机设置授权。真实 QQ/微信账号登录、双向收发、长任务窗口尚需本人账号联调。上游：[QQ 官方 SDK](https://github.com/tencent-connect/qqbot-nodejs)、[微信官方协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)。
