# 架构

## 总览

```text
Android App
  | HTTP + WebSocket
  v
Local Gateway
  | JSON-RPC / stdio or websocket
  v
codex app-server
  |
  v
本机项目、终端、文件、预览服务
```

## 为什么需要 Gateway

`codex app-server` 是官方提供给富客户端的接口，但 WebSocket transport 仍是 experimental。非 loopback 监听还必须谨慎处理鉴权。因此本项目不让安卓端直连 app-server，而是由 Gateway 负责：

- 局域网 token 鉴权和后续二维码配对。
- 项目白名单和路径约束。
- Codex app-server 生命周期管理。
- 事件缓冲和断线重连。
- 终端、文件、预览代理。
- Telegram、微信等多入口复用。

## 数据模型

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
