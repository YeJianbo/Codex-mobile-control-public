# 远程聊天交互对照 · 0.5.8

以当前网页和原生 Android 为修改对象。参考界面行为后在现有实现中完成，没有引入第三方应用运行时。

| 参考 | 对照内容 | 本次落实 |
| --- | --- | --- |
| [ZCode 输入区](https://github.com/zai-org/ZCode/blob/main/packages/ui/src/LexicalChatInput.tsx) | 输入法、提交状态与键盘交互 | 保留中文组合输入保护；提交和排队期间明确反馈，禁用重复提交，输入时仍能停止任务 |
| [ZCode 错误提示](https://github.com/zai-org/ZCode/blob/main/packages/ui/src/ChatErrorBanner.tsx) | 简短摘要与诊断详情分开 | 队列显示可读错误；菜单保留复制原始错误详情 |
| [MiniMax Code](https://github.com/MiniMax-AI/minimax-code) | 排队与引导的明确区分 | 运行时发送显示“加入队列”，已有队列继续提供编辑、引导、重试和取消；其公开仓库主要是终端与运行时，不把它当作完整桌面 UI 源码 |
| [Remodex Android](https://github.com/Demogorgon314/remodex-android) | 原生导航、执行中输入、队列与访问权限 | 保留原生 Compose；置顶单独分组、搜索穿透折叠、消息复制与待发队列编辑、底部弹层动效和键盘避让 |
| [Grok Desktop](https://github.com/AnRkey/Grok-Desktop) | 桌面包装方式 | 该项目包装 grok.com，本项目继续使用自己的网页与原生 Android 界面 |

## 用量

两端通过受现有配对鉴权保护的 `GET /api/usage?threadId=…` 读取数据。账号额度优先读取同一个 Codex app-server 的 `account/rateLimits/read`；失败时复用电脑控制台的 `codexmate/local-console/quota-current.json`，且只接受当前账号记录并标明过期时间。不会向客户端返回账号凭据、账号 ID 或重置额度凭证。

窗口按返回的分钟数展示，不能假定 primary 永远是五小时。`usedPercent` 转成剩余比例；没有数据时保持未知。Token 使用会话现有增量历史读取缓存中的最新 `token_count`，不把每次累计快照相加。缓存输入包含在输入里，推理输出包含在输出里；上下文上限和最近请求独立展示。

## 验证边界

网页回归覆盖消息、排队、停止、公开思考摘要、公式、附件、PDF、主题和配额缺失状态。真实数据在 320、390 和 1440 像素宽度检查；用量新接口通过源码处理器预览，不能据此声称旧网关进程已经加载新路由。

Android 0.5.8 的 APK、JVM 测试和 instrumentation 测试 APK 已构建。当前会话启动模拟器的命令被自动审批拒绝，返回 `blocked by policy`；本轮没有运行设备交互测试，也没有实体手机验证。原有 0.5.7 的设备测试结果不充当本版证据。

本次不是对 Codex 全部桌面功能的完成声明；远程聊天的缺失细节仍按实际场景逐项核对。

## 0.6.0：独立助手工作区

侧栏顶部切换 Codex、Claude Code、Antigravity、Grok Build。每个助手单独保存模型、强度、权限和草稿；切换时恢复自己的会话，会话列表、队列和用量按助手区分。模型弹层只列当前助手模型，服务端拒绝把原会话交给另一个助手。

新增的三个 CLI 接入均已完成真实首轮发送和原 session 第二轮续聊检查。Claude 使用 stream-json，Antigravity 使用 headless stream-json，Grok Build 使用 ACP。只显示公开输出与工具进度，不读取内部推理。当前只接续由本客户端创建的外部助手会话，尚未导入它们各自桌面端的全部历史。

CLI 能力保留实际边界：Antigravity 当前 stream 输入只接受文本，图片会明确拒绝；其 headless 询问模式尚无手机交互审批。Claude 和 Grok 已接审批协议，但真实审批与图片交互尚未设备验证。外部助手未提供的配额或 Token 显示缺失状态，不套用 Codex 数据。

验证：42 项网页回归、4 项助手协议/会话测试、网关 smoke、118 项 Android JVM 单测通过。Chrome 在 320/390/1440 宽度验证四工作区、独立草稿、模型记忆和刷新恢复，无页面异常或溢出。Android APK 和 instrumentation 编译通过；本轮没有连接设备，未运行设备交互测试。

运行中的安装版网关未重启。静态网页和 APK 可以直接更新；新后端由项目根目录“更新电脑网关.cmd”在无执行任务时更新。仅刷新旧网关网页不会启用新增 CLI。
