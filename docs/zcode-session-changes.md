# 本会话变更清单（ZCode 会话，2026-09-27 ~ 09-30）

> 记录本会话对仓库的全部改动，按组件分组、按时间批次标注。与并行会话（0.6.104→0.6.119 的版本迭代、公网入口守护等）的改动并存于同一工作区，**全部未提交**；基线为冻结提交 `f3b1721`。改动前快照：`.backup/2026-09-27-pre-optimization/`。

## 一、网关（server/src，需 `更新电脑网关.cmd` 生效）

| 文件 | 改动 |
| --- | --- |
| `index.ts` | 新增 `GET /api/threads/search`（会话正文搜索：先查事件缓冲，再扫最近 24 个线程的 Codex 历史）；assets 映射注册 `highlight.js` |
| `services/stateStore.ts` | 新增 `searchMessageEvents()`：SQLite 事件表 LIKE 检索（转义 `%/_`，JS 端精筛） |
| `services/agentSessions.ts` | ①AGY 模型目录去重：变体 ID（gemini-x-high）收敛为"基础模型 + 可选 effort"，启动映射为 `--model base --effort x`；旧变体 ID 经 validate 兼容；②AGY 的"询问"轮次发布显式 warning（CLI 无审批能力，此前静默变成 always-proceed）；③AGY 图片校验**前置到建线程之前**（修复失败后留下空会话幻影） |
| `services/agentProtocol.ts` | ①AGY 失败结果透出 `r.error` 真实原因（此前手机端只看到残句如 "8"，实为 503 No capacity）；②AGY 工具 id 中文标题映射（write_to_file→写入文件等 20+，`browser_*` 归为浏览器操作） |
| `protocol.ts` | `SERVER_VERSION` 0.4.0 → 0.6.25（后被并行会话推进到 0.6.37，以当前为准） |
| `scripts/smoke-test.mjs` | 新增用例 `thread search finds message text` |
| `dist/` | 已重新构建（含 search 路由与 highlight.js） |

## 二、Web 控制台（server/public，随网关更新生效）

| 文件 | 改动 |
| --- | --- |
| `highlight.js`（新文件） | 自研语法高亮器（零依赖、DOM API 注入安全、深浅色 token、diff/sql/json/yaml/html/css/bash/py/clike 系），未知名与超 60KB 安全跳过 |
| `console.css` | ①暗色残留清零（连接横幅/审批卡/diff×3/toast.error/form-error 等 16 个新 token）②浮层动画体系：modal `@starting-style` 进出场、toast 滑入滑出、页面切换淡入、侧栏展开/收起动画、消息入场 `msg-enter`、跳底按钮入场 ③打字光标 `stream-cursor`、历史骨架屏 `history-skeleton` ④`--radius` 启用（15 处）、`--term-bg` 统一终端底色、`--code-*` 高亮色板 ⑤移动端 44px 触控目标（6 处）⑥运行中/连接中圆点呼吸、断线横幅滑入 + spinner、审批卡呼吸描边、队列条目入场、`details::details-content` 收起动画（`interpolate-size`）⑦上传进度条、`mark.snippet-hit` 命中高亮、快捷键弹窗样式、侧栏标题吸附 ⑧`.page` 防橡皮筋 ⑨修复 `inline-error` 无样式真 bug |
| `console.html` | 历史骨架屏、上传进度条、桌面通知开关（设置页）、正文匹配容器、横幅 spinner、PWA meta（`mobile-web-app-capable` 等） |
| `console.js` | ①toast/弹窗进出场（CSS 方案，不经 JS 延迟——时序教训见交接文档）②"回到最新"平滑滚动 + `jumpScrolling` 程序化跳转保护（修复 smooth 被 `userScrollUntil` 误判中断的回归）③流式打字光标 ④消息入场动画（新 key 限流）⑤loadOlder 骨架屏 ⑥桌面通知（Notification API + 设置开关）⑦侧栏远程正文搜索（防抖 + 命中高亮 + 点开清除）⑧上传改 XHR 实时进度 ⑨图片查看器：多图导航（按钮/方向键）+ 双击缩放（`enableImageZoom`）⑩快捷键帮助弹窗（`?`/`Ctrl+/`）⑪终端后台输出标题徽标 ⑫AGY 图片拦截提示 |
| `custom-controls.js` | 权限选择器对 antigravity 移除"询问"并迁移遗留值为"自动审批"，附"无逐条审批能力"说明 |

## 三、安卓（android/，0.6.120 APK 已含全部）

| 文件 | 改动 |
| --- | --- |
| `NativeScreen.kt` | ①断线内联横幅（错误原文 + 重连 + 关闭；Column 包裹修复与输入卡叠压遮挡的真 bug）②"回到最新"FAB 400ms 显示去抖（修流式闪现）+ 点击触觉 ③消息入场动画 `BlockEntrance`（>20 新 key 跳过）④NativeSheet 退出动画 + 拖拽回弹 ⑤workPanel Crossfade ⑥历史骨架屏 ⑦侧栏置顶/最近列表 `animateItem` 位移动画 ⑧AGY：权限面板移除"询问"并说明、图片选择入口拦截 |
| `NativeViewModel.kt` | 新增 `retryConnect()`、`searchRemote()`（250ms 防抖 + 防串台）、`remoteMatches` 状态 |
| `MainActivity.kt` | edge-to-edge（`WindowCompat.setDecorFitsSystemWindows(false)` + 透明系统栏 + InsetsController 图标明暗，替换硬编码白状态栏与废弃 API）；断线通知深链（`onNewIntent → openNotificationThread`） |
| `NotificationHelper.kt`（新） | 本地通知三渠道（approval HIGH/task DEFAULT/monitor MIN），tag 去重，深链 PendingIntent |
| `NotificationMonitorService.kt`（新） | 前台服务保活 WebSocket，审批/完成/提问发通知；断线退避重连；设置"后台提醒"开关 + onResume 幂等拉起 |
| `Colors.kt`（新） | AppColor 色板 + Radius 圆角 token（NativeScreen 硬编码颜色清零） |
| `Haptics.kt`（新） | 触觉五场景：发送/长按菜单/审批确认/复制成功/滑块档位 |
| `TerminalInput.kt`（新） | 承接被 JVM 单测引用的终端纯函数 |
| `res/values-night/styles.xml`（新） | 夜间冷启动主题（消灭深色白闪） |
| `AndroidManifest.xml` | POST_NOTIFICATIONS、FOREGROUND_SERVICE 权限 + 通知服务声明 |
| `LegacyControlScreen.kt` | 4215 行死代码移入 androidTest 源集（保住 ConnectionFlowTest），生产 APK 净减约 4500 行 |

## 四、测试与工具

| 文件 | 改动 |
| --- | --- |
| `scripts/smoke-test.mjs` | 新增 `thread search finds message text` 用例 |
| `scripts/agy-e2e-debug.mjs`（新） | AGY 端到端调试脚本：三链路（基础模型+effort+ask+warning / 旧变体兼容 / 图片拒绝）+ 防幻影断言，需本地网关 38459 |
| `ConnectionFlowTest.kt` | mock `/api/sidebar` 补齐 sidebar 分页形态（修复三项稳定失败，7/7） |
| `NativeFlowTest.kt` | 新增 `disconnectBannerShowsErrorWithRetryAndDismiss` |

## 五、文档

| 文件 | 改动 |
| --- | --- |
| `docs/handoff-2026-09-28.md` | 新建（交接文档；并行会话后续也在维护） |
| `docs/zcode-integration.md` | 新建（ZCode Protocol 逆向记录、方法面、接入步骤与未决点） |
| `docs/work-status.md` | 本会话各批次登记（与并行会话条目并存） |
| `docs/roadmap.md` | 新增"阶段 4.5 客户端体验打磨"两批共 15 项；TG/微信与全屏 TUI 标注暂缓 |
| `docs/protocol.md` | 鉴权豁免说明修正 + 0.6.25 全量端点总览 |
| `README.md` | Web 功能描述、安装包指引更新 |

## 六、产出的 APK（本会话构建）

| 版本 | 说明 |
| --- | --- |
| 0.6.113（136） | 首个包含断线横幅等全部累积改动的 Release |
| 0.6.114（137） | + 光标对齐修复、抽屉对称圆角、弹窗不抢焦点 |
| **0.6.120（143）** | **当前最新**：+ AGY 权限诚实化、图片门控、侧栏 animateItem、FAB 触觉；2,439,792 字节，SHA-256 `B721902DA3552AF815FFD0AA95810343C7ADA251B70AEBCE5D62103752FEA152` |
| 0.6.115~0.6.119 | 并行会话构建（非本会话） |

## 七、验证状态汇总

- 服务端：typecheck 0 错误、smoke 全通过（含新增搜索用例）、dist 已重建
- Web：`test:web` 49/49（多次确认；曾修复"回到最新"平滑滚动回归）
- 安卓：编译 + JVM 单测全绿；仪器套件 98 项完整跑完（ConnectionFlowTest 7/7；剩 1 个满负载轮换 flake，单跑即过；崩溃 flake 为模拟器框架层 NPE，未根治）
- 真机：S23 待验（断线横幅、FAB 手感、AGY 选择器需先更新网关）

## 八、明确没做的

- Telegram / 微信 adapter（用户指示暂缓）
- 全屏 TUI 终端（roadmap 标注暂缓）
- ZCode 接入实现（可行性成立、协议已逆向，规格在 `docs/zcode-integration.md`；未写网关代码）
- AGY 实时审批（CLI 硬限制）与桌面历史导入（无接口）
- 仪器套件崩溃 flake 根治（测试编排器，需新增 androidx 依赖，待决策）

## 九、2026-09-30 后续 AGY 完善

- 已将模型与推理强度写入会话元数据；续接沿用原 conversation、模型和强度，换模型不携带旧强度。历史接口为 Android/Web 回传设置，并兼容已保存的旧变体 ID。
- 模型、强度和附件校验前置；错误请求不留下空会话。启动期间也占用会话，同一会话的并发发送不会重复拉起进程。AGY 计划模式映射为 `--mode plan`。
- 工具输出快照转为增量，工具完成与最终结果去重；异常结果、结构化错误及中断时未结束的工具都有收尾。
- 合并并发目录读取，按可选档位选默认强度。已核对本机 CLI help：Claude 没有 `models` 子命令，原探测会进入对话并拖住 AGY 校验，现已删除该调用；Grok 与 AGY 的目录命令保留。
- 现有配对设备可通过公网执行 AGY，支持启动、续接、队列和中断。独立密码、设备签名、接口白名单与授权目录限制保持；Claude/Grok 公网执行继续拒绝。公网队列的编辑、移动、取消和重试均检查消息来源。
- 实际安装网关已更新，桌面共享连接恢复，沿用 0.6.120 APK。19 项定向回归、构建、Gateway smoke、Web 49 项与签名队列权限检查通过，公网安全检查通过。
- 真实 CLI 的完整通过与失败范围见 [当前状态](work-status.md)。新增 `server/scripts/agy-live-check.mjs`：默认使用隔离网关并检查重启后第三轮；`--installed` 使用实际公网入口检查工具读取、队列记忆与历史设置。测试参数可通过 `CODEX_AGY_TEST_MODEL`、`CODEX_AGY_TEST_EFFORT` 指定；默认 3.8 Flash/medium。失败或超时退出 1，不因收到某个图片拒绝事件而假报通过；临时设备、线程及探针文件会清理。
