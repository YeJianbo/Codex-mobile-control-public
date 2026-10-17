# 路线规划

当前实际进度、已做过的改动及待调查问题见 [当前工作与完成状态](work-status.md)。本页的勾选表示对应功能已有实现，不代表实体手机体验已验收。

## 阶段 0：项目骨架

- 建立电脑端 Gateway。
- 建立 Android Compose 客户端骨架。
- 固化局域网通信协议。
- 支持读取和保存 Codex 基础设置。

## 阶段 1：可用 MVP

- [x] 手机输入电脑 IP 和 token 后连接。
- [x] 展示电脑端项目列表。
- [x] 进入项目后创建或恢复 Codex thread。
- [x] Android 端实现桌面侧边栏对应功能区：文件、侧边聊天、浏览器、终端。
- [x] 对话消息通过 WebSocket 流式显示，并在 Android 端聚合为逐字增长的连续消息。
- [x] 终端/工具输出内嵌显示。
- [x] 支持发送、停止和追加指令。
- [x] 继续/重试上一轮指令。
- [x] 支持读取和保存 `~/.codex/config.toml` 的常用配置项。
- [x] 手机端设置页支持 Provider、审批、沙盒、推理和隐私常用项的触屏化配置。
- [x] 支持读取和保存完整 `~/.codex/config.toml` 原文，覆盖桌面端未表单化设置。

## 阶段 2：本地开发体验增强

- [x] 文件树、文本编辑、raw 文件预览和 Android 内嵌预览切换。
- [x] 本地 dev server 预览代理。
- [x] 项目级 git diff 查看。
- [x] diff 按文件分组审阅和单文件 diff 查看。
- [x] diff 接受/撤销单文件更改。
- [x] diff 批量接受/撤销当前文件列表。
- [x] Android 终端块展开/折叠、搜索和复制。
- [x] 手机端在已添加项目中运行单次本机命令，并流式查看 stdout/stderr。
- [x] 手机端停止正在运行的本地终端命令。
- [x] 终端历史输出恢复和断线重连 scrollback。
- [x] 终端 scrollback 按命令分段持久化和手机端卡片展示。
- [x] 终端大输出预览和增量分页：命令列表默认只取尾部预览，详情按 offset/limit 加载。
- [x] 交互式 shell 会话复用：手机端可启动持久 shell、发送输入并停止会话。
- [x] 终端页固定显示当前活跃交互会话，统一输入入口可在多个 shell 会话间切换目标。
- [x] 终端输出显示归一化：从 ANSI 清理推进到轻量终端缓冲区解释，支持 `\r`、`\b`、清屏、清行和基础光标定位。
- [x] 终端输出保列宽显示：默认不折行并支持横向滚动。
- [x] 终端缓冲区支持 alternate screen 进出和主屏恢复。
- [x] 终端块使用内部滚动区承载长输出，减少聊天页被终端内容撑爆。
- [x] 终端缓冲区补充行/字符编辑与整屏滚动类控制序列。
- [x] 终端缓冲区支持 scroll region 与 origin mode。
- [x] 运行中终端块支持自动跟随末尾，并可一键跳回最新输出。
- [x] 终端输出支持基础 SGR 颜色与文本属性渲染。
- [x] 终端折叠/筛选/搜索高亮路径保留原始终端样式。
- [x] 终端块支持分离的“复制可见 / 复制原始”操作。
- [x] 交互式终端支持原始输入和常用控制键：`Ctrl+C`、Tab、方向键、`Esc`、`Enter`、`Home`、`End`、`Del`。
- [x] 交互式终端输入模式切换：支持“回车发送 / 原样发送”，其中原样发送允许多行与空白片段输入，并补齐左右方向键与退格快捷键。
- [x] 服务端交互会话升级为 PTY，并支持 `cols/rows` resize。
- 前端终端模拟器：把 PTY 控制序列渲染成真正可用的全屏 TUI 视图。（暂缓：Web 端已有 xterm.js 全功能终端，Android 端继续使用轻量终端缓冲区，待有实体设备验证条件后再评估）
- [x] 按 hunk 接受/撤销 diff。
- [x] 手机端快捷操作栏：允许、拒绝、停止、复制、重试、打开预览。
- [x] 断线重连后恢复 thread 和最近事件缓冲。

## 阶段 3：安全与多设备

- [x] 二维码/配对码配对。
- [x] 设备列表和撤销设备，Android 设置页可直接管理。
- [x] 管理员 token 与设备 token 轮换，Android 连接设置可一键保存新 token。
- [x] 只允许指定项目根目录，并在 Android 设置页管理 projectRoots。
- [x] 局域网 HTTPS 配置、自签名证书生成和 Android 自签名连接开关。
- [x] 权限 profile 审批允许/拒绝转发。
- [x] 审批策略可视化，移动端展示风险摘要并按审批类型提示。

## 阶段 4：多入口控制

- Telegram adapter。（暂缓）
- [x] 微信／QQ 共用网关通道：自动会话映射、提交回执复用、事件过滤与驱动生命周期。
- [x] QQ 官方 SDK 驱动与 AppID/AppSecret 配置入口。
- [x] 微信 iLink 驱动、扫码、验证码及上下文回复。
- [x] 官方私聊文字任务、自动新会话、状态、停止与结果取回。
- [ ] 真实 QQ/微信账号双向收发、超时窗口及断线重连联调。
- [ ] 通道附件与聊天内审批。
- [x] Web 控制台。
- 将对话、审批、项目和设置逻辑保持在 Gateway，所有入口共享同一 control plane。

## 阶段 4.5：客户端体验打磨

- [x] Web 控制台浮层体系动画：弹窗（`@starting-style` 进出场）、toast 滑入滑出、页面切换淡入、桌面侧栏展开动画、新消息入场动画。
- [x] Web 控制台流式输出打字光标与历史加载骨架屏。
- [x] Web 控制台修复弹窗错误提示样式（`inline-error`）并把连接横幅、审批卡、diff 高亮、错误 toast 收敛进暗色 token。
- [x] Web 控制台移动端触控目标统一到 44px（图片删除、目标操作、权限选项、加载更早、用量周期）。
- [x] Web 控制台桌面通知：网页在后台时，审批请求与任务完成发送系统通知（设置页开关）。
- [x] 会话正文搜索：`GET /api/threads/search`（事件缓冲 + Codex 历史），Web 侧栏展示匹配片段。
- [x] Android edge-to-edge 系统栏、`values-night` 夜间冷启动主题、触觉反馈、消息入场动画、Sheet 退场回弹、历史加载骨架屏、色板 token 收敛（Colors.kt）。
- [x] Android 本地通知：审批请求与任务完成提醒（前台服务保活，无需 FCM）。
- [x] Android 侧栏接入远程正文搜索。
- [x] Gateway 版本号与能力对齐 0.6.x，`docs/protocol.md` 补齐端点总览。
- [x] Web 聊天代码块轻量语法高亮（`public/highlight.js` 自研分词，零依赖，深浅色 token 自适应，覆盖 js/ts/py/json/css/html/bash/yaml/sql/diff 等常见语言）。
- [x] Web 大文件上传改为 XHR 进度：上传状态实时显示百分比进度条，图片按张数计数。
- [x] Web 终端背景与 xterm 主题统一为同一 `--term-bg`，消除明暗主题下的色块割裂。
- [x] Web 微交互：会话切换内容淡入、侧栏收起时导航栏滑入、断线横幅滑入、待处理审批卡呼吸描边、`details` 折叠高度过渡（`interpolate-size` 渐进增强）。
- [x] Android 通知点击深链到对应会话；图片查看器双击缩放；发送/审批按钮按压缩放（与 Web `:active` 一致）；断线状态继续由顶部状态点与连接面板呈现；侧栏置顶/排序平滑移动。

## 阶段 5：高度可用

- [x] SQLite 持久化设备、thread 映射、审批和事件缓冲，并覆盖 Gateway 重启后的事件回放。
- [x] app-server 崩溃恢复和自动拉起：异常退出后 watchdog 自动重启，并在下一条消息前重新 resume thread。
- [x] Gateway 重启后清理旧 running 终端状态，避免手机端显示不可操作的假运行会话。
- [x] WebSocket 心跳：Android 主动 ping，Gateway 定期 ping/pong 清理半断开的连接。
- [x] 基础版本检测：Codex CLI 和 app-server 运行状态。
- [x] 版本兼容检测：Gateway control protocol 和 Android client protocol。
- [x] app-server schema 兼容检测：覆盖方法清单、initialize 状态、未知事件和不支持请求统计。
- [x] 自动升级提示：Gateway 检查 Codex CLI 当前版本和 npm 最新版本，Android 设置页展示升级建议。
- [x] 端到端测试：Gateway 协议、Codex mock 已覆盖；Android 首页/会话 Compose smoke test、设置页 smoke test、终端会话 smoke test、自动连接首页流转测试、WebSocket 实时流测试、文件变更跳转测试、diff 跳转测试、终端状态联动测试已在本地模拟器跑通。
