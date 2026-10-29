# 开发与验证

手机「设置 → 助手指令」编辑各助手实际读取的全局文件：Codex 的 `AGENTS.md`、Claude 的 `CLAUDE.md`、AGY 的 `GEMINI.md`、Grok / DeepSeek / OpenCode / ZCode 的各自 `AGENTS.md`，以及 Hermes 的 `SOUL.md`。路径按该进程的配置目录解析；保存前核对读取版本，避免覆盖其他端的修改。

会话菜单中的「工作区指令」编辑该会话所在项目的原生文件：Claude 使用 `CLAUDE.md`，其他助手使用 `AGENTS.md`。同一项目的会话共享文件，由助手按自身规则读取；网关不再向消息注入指令。旧版独立会话指令文件保留，不自动合并到项目文件；旧消息中的包装标记仍在展示时处理。

以下命令从仓库根目录执行。

账号额度提供「自动预热」：开关与 5 小时／7 天窗口选项在 Web 额度页及 Android 额度卡中共用 `GET/POST /api/usage/warmup`（手机走已有 `console-management` 配对入口）。安装默认关闭、选中 7 天；当前开发机按用户要求启用 7 天，5 小时可另选。选项保存在本地控制台 settings.json，按账号保存的观察值、候选重置和发送结果在 quota-warmup.json。由常驻控制台后台执行，手机离线不影响检测。

`QuotaWarmup` 开启后每 30 秒读取官方额度；时间到达本身不构成触发。官方用量归零，并且旧窗口到期、用量由正变零或官方期限明确变化到新窗口时才登记候选。已有正常用量则跳过；共享后端存在活动会话、工作台有请求或助理任务、后端切换期间则等待。发送前再次读取账号、额度和运行状态。两个所选窗口同时重置只发一条。预热轮询只更新实时额度，不额外追加历史采样；与正常刷新重叠时共享官方请求，并保留正常采样，避免缩短额度历史保留范围。

预热通过当前 ChatGPT 登录直接请求官方 Codex Responses 接口，优先 6.1 Sol、标准速度和低思考强度；仅要求回复 OK，无历史、无工具、不写聊天会话。不会经过用户配置的中转映射。一次发送在发出前持久化，断流、关闭或重启导致结果不明时不重复发；请求记录单独标记为合成请求，不混入正常速度样本。实际消耗仍由官方账号计量。官方文档没有保证一条请求能固定未来重置日期，本功能不写入或推算官方下次期限。

定向检查：`server/scripts/quota-warmup.test.mjs` 覆盖重置确认、重启去重、忙碌延期、正常请求跳过、可选窗口合并、账号／开关变化和官方无工具请求；`NativeQuotaWarmupUiTest` 覆盖窗口选择及开关保存。源码目录未安装组件依赖时可用 `.tmp/local-console-runtime-deps.mjs` 复用本机已安装组件依赖执行检查；它不改变生产模块解析。

聊天表格由 `nativeTableRows` 使用 GFM 语法解析，主聊和侧聊共用 `NativeRichTextContent`。表格内容置于同一个 `SelectionContainer`，支持长按选取文字；右上复制菜单提供 TSV（制表符分列，粘贴 Excel）和原始 Markdown。TSV 将单元格内部换行／制表符转换为空格，保留行列边界。三列及以内仍在手机宽度内换行，多列表格保留横向滚动。相关检查为 `NativeTableTextTest` 和 `NativeTableCopyUiTest`。

加载会话使用原有 `HistorySkeleton` 闪动占位，不显示文字状态；已有缓存正文时保留正文。侧聊共用相同占位。`nativeChatProgressLabel` 只处理提交与已开始轮次的等待，不为历史加载生成标签。

Android 0.6.468 起，`设置 → 应用更新` 提供版本检查、更新说明、应用内下载进度、取消／重试和系统安装入口。连接网关后每六小时至多自动检查一次，可关闭；自动检查不下载、不弹窗，发现新版后在设置入口提示。首次安装这一版本仍走原 APK 下载入口，此后可在应用内更新。安装来源权限由系统页面授权，返回后继续安装。

`NativeAppUpdateController` 在 ViewModel 中持有检查与下载状态，离开设置不取消下载；页面只负责渲染和系统安装／权限跳转。下载沿用当前 GatewayClient 的 HTTPS、设备身份、公网密码和秘密路径。校验文件大小、摘要、包名、版本和当前安装签名后才交给系统安装；每次下载使用独立临时文件，取消后的旧回调不会删除重试文件。模拟器检查 `NativeAppUpdateTest` 使用隔离应用和最终 Release APK，不替换真机应用。

Gateway 0.6.160 提供 `GET /downloads/android.json`，与现有 APK 下载入口采用相同访问规则。发布新 Android 版本时先完成构建和必要检查，再同时发布 APK 与清单；清单从真实构建元数据和 APK 生成，不手写版本号或摘要：

```powershell
node server/scripts/publish-android.mjs `
  --apk D:/codex/build/Codex-mobile-control/android/app/outputs/apk/release/app-release.apk `
  --metadata D:/codex/build/Codex-mobile-control/android/app/outputs/apk/release/output-metadata.json `
  --notes-file D:/codex/build/Codex-mobile-control/update468-notes.txt `
  --target server/public/downloads `
  --target C:/Users/YeJianbo/.codex/tools/local-console/gateway/public/downloads
```

`--notes-file` 为可选 UTF-8 更新说明。发布后核对本机、公网的清单版本和 APK 完整字节；保留上一版回退包，成功后清理较早 APK。Windows 打包脚本 `installer/build-release.py` 也按传入 APK 生成配套清单，更新说明可用 `--android-notes-file` 指定。

聊天发送以提交瞬间的会话 ID 为准。`GatewayClient.nativeCommand` 显式接收 ID；侧栏 `ThreadRecord` 仅提供目录等元数据，找不到记录不能改成新建会话。Android 与 Web 都拒绝把已有会话绑定到其他 ID 的回执；只有空会话且选择未变化时，新建回执才允许切换到返回的 ID。旧版持久化的错误新建命令保留文字并阻止重放，不自动换目标重发。

通知跳转是一次性导航意图：`MainActivity` 读取后移除 Intent extra；`openThread`、`newThread` 清空尚未完成的通知目标，防止侧栏请求延迟返回时跳回旧会话。分支创建回执也必须仍属于原先的选择，才打开返回的会话。对应检查为 `notificationIntentIsConsumedOnlyOnce` 与 `delayedNotificationCannotReplaceAnExplicitlyOpenedConversation`。

侧聊与主聊的 Android 控件共用 `NativeChatControls.kt`：输入框、发送／停止按钮、操作分组与处理过程标题。`NativeSideChats` 按主会话 ID 保存独立的 `NativeSideChatController`，各自持有线程、模型、思考强度、草稿、附件、提交回执和事件记录。切换主会话或收起只释放当前侧聊事件流，不打开其他主会话；重开对应侧聊恢复快照。主界面只观察可见性，侧聊 token 更新不驱动主聊天整屏重组。操作内容仍在展开后准备和渲染。Web 侧聊复用现有 composer、发送／停止按钮及主题变量。

发送会话绑定的回归检查：`node --test server/scripts/submission-routing.test.mjs`，Android `ConnectionFlowTest` 的 `selectedThreadIdDoesNotDependOnSidebarMetadata`、`anotherThreadReceiptCannotRedirectTheConversation`、`delayedAcknowledgementKeepsTheNewlySelectedThreadAndDraft`、`legacyWrongTargetCannotBeReplayed`。这些检查配合 `NativeSideChatUiTest` 使用独立 HTTP／WS 服务和隔离应用，不向用户真实会话发消息。

侧聊与桌面工具：`server/src/services/threadToolsRoutes.ts` 提供分支、临时侧聊关闭、原生后台终端和审阅；临时线程正文由 StateStore 内存表保存，不写普通历史。Android 状态入口为 `NativeSideChatController`，Web 为 `console-thread-tools.js`，两端都只为打开的侧聊增加一个聚焦流。`desktopBrowser.ts` 只连接本机 CDP，当前没有 Codex 宿主的浏览器遥控协议，不能用独立 WebView 替代。

临时分支的真实协议限制：`ephemeral:true` 不能与 `deferGoalContinuation:true` 同传，且临时线程不支持 `thread/goal/*`。`node scripts/thread-fork-native-check.mjs` 使用已安装桌面 CLI、隔离 home 和本地合成历史核对创建/关闭，不发起 `turn/start`；协议组合限制不能仅依赖 JSON schema 或无约束模拟后端判断。

新增范围的检查：先在 `server` 构建，再运行 `node --import tsx --test scripts/thread-tools.test.mjs scripts/desktop-browser.test.mjs scripts/desktop-mcp-relay.test.mjs scripts/ephemeral-storage.test.mjs scripts/event-loop-stall.test.mjs scripts/side-snapshot.test.mjs`；`node scripts/thread-tools-web-check.mjs` 使用隔离 HTTP/WS 服务和 Chrome，不连接用户会话。Android 使用 `NativeSideChatUiTest`，与编译错开运行模拟器，避免宿主内存压力影响真实网关。

Computer Use 的 MCP 授权需要共享桥的 `mcpServer/elicitation/request` 转发白名单。修改 `shared-backend.mjs` 后，复制文件不会改变已运行代理的内存代码。现有“重启共享后端”保留 owner daemon，仅重启 CLI；加载桥代码还需要重启该 daemon。必须区分网关、CLI 和共享桥的进程范围，后两项可能中断桌面任务，按有效授权激活。

Windows 发行包包含本仓库 Gateway、Android APK 和配套 Local Console。打包前使用 conda 环境中的 Python，完成 Android Release 与 `server` 的 `npm run build`。配套控制台的固定源码、Web 前端发行产物及依赖锁位于 `components/local-console`；其 `dist` 与 Gateway 的 `server/dist` 是两组不同产物。安装目录 `%USERPROFILE%\.codex\tools\local-console` 只提供匹配依赖锁的生产依赖与 Node 缓存，不再决定打包源码。组件当前不包含独立前端开发工程，说明见 [组件文档](../components/local-console/README.md)。

```powershell
conda run -n base python installer/build-release.py `
  --version 0.6.447 `
  --android-build-dir D:\codex\build\Codex-mobile-control\android\app `
  --android-apk D:\codex\deliverables\Codex-mobile-control\Codex-Control-0.6.447.apk `
  --android-build-log D:\codex\build\Codex-mobile-control\harness446-build-final.log `
  --output-dir D:\codex\deliverables\Codex-mobile-control
```

按实际位置调整路径和环境名。`--android-build-log` 指定与 APK 对应的构建记录；`--console-dir` 可显式指定配套组件目录，`--console-runtime-dir` 指定依赖和 Node 缓存目录。省略时沿用仓库组件和本机安装缓存。打包会生成 Setup、Windows 发行 ZIP 及组件清单，检查生产依赖版本、Node 身份和压缩包 CRC；暂存文件及内嵌 payload 使用系统临时目录，完成后清理，不运行安装或修改本机账号。

## 连接恢复与跨会话提问

Android 的连接循环统一管理探测、WebSocket 及重试唤醒。每次重连重新探测线路，自动模式让内网短暂领先后与公网竞争，不沿用断线前的健康结果。网络切换清理空闲连接并唤醒循环；前台返回先验证旧 Socket，健康连接保留，失效连接先发唤醒再取消，避免丢失恢复信号。当前会话和草稿不随传输重建而清空。

聊天连接在内网意外结束时，自动模式继续尝试已经配置的公网，不再因先前握手成功就中止候选遍历、重新选中 HTTP 正常的故障内网。公网接通后至少等待 30 秒才探测返回内网，普通前台切换不重置等待；用户主动切线和系统网络切换仍立即唤醒连接循环。只配置内网时保留既有的首次立即重连。

桌面 `request_user_input_async` 的 started / completed 均归一化为 `desktop-question:<callId>`，completed 不作已解决处理。`/api/approvals` 除当前会话外，仅补查事件记录中已知待回答的会话；Android 快照也进入应用内提问通知入口，使用线程与问题 ID 去重。已回答问题不因迟到快照重新提醒。

连接诊断使用网关 `Gateway event connection` 日志和 `/api/diagnostics/performance`。`peer_close / 1006` 只表示未收到正常关闭帧，不能单凭该值归因于 Wi-Fi 或客户端；本机长连接探测也不能替代手机链路检查。部署网关会切断现有连接，APK 静态下载更新无需重启网关。回归记录见 `docs/work-status.md` 的 0.6.463 条目。

## Android 断流来源记录

2026-10-20 已在 464 真机记录中捕获 `event_queue_overflow`：聊天 22.8 秒收到 803 帧、通知 41.9 秒收到 2583 帧，网关同刻心跳延迟 3ms、发送缓冲为 0。命令输出同时生成 `terminal.output` 和 `tool.output`，前者原先未经过会话聚焦过滤，造成通知连接也接收大量无用输出。156 对聚焦客户端只发送有 `commandId` 的真实工作区终端输出，并把用量与会话设置更新限制到当前会话；正文、操作、回执和跨会话提问／完成仍按原用途分发。没有提高 256 队列上限，也没有改成无界队列。

Android 465 在 JSON 解析后、事件入队前筛掉不可消费的重复终端流；通知服务只入队它实际处理的生命周期、提问、审批及任务完成事件。心跳与聚焦确认仍在 WebSocket reader 直接处理，不等待主线程。`NativeEventRouting` 的过滤与 UI 是否正忙无关，聊天中的正文与工具详情不被丢弃。

157 将同一命令的连续输出按最长 100ms 或 32768 字符合并后再持久化和分发，超大单帧直接发送；命令、线程或事件类型变化时先刷出前面的输出，保持正文、操作和审批顺序。156 部署后当前会话仍曾在 13.69 秒内收到 391 帧而溢出，因此仅过滤无关终端流不足以解决洪水。合并不截断字符，也不扩张客户端队列。

2026-10-20 的 157 日志还记录了聊天与通知同时以 1006 关闭、Socket 错误及一次客户端 ping_timeout；它们与队列溢出分开处理。Windows 当天 09:39、09:46 的资源耗尽事件 2004 确认虚拟内存不足，本轮 API31 测试模拟器约占 4.46GB 提交内存；已关闭本轮模拟器并改用单 worker、进程内 Kotlin 编译。没有停止其他项目的编译器、模拟器或共享 Codex 后端。这是宿主压力证据，不能据此认定全部 Socket 断开均由内存不足引起。

液态子代理弹层的 RenderThread 闪退已在隔离 API31 复现：父玻璃 Surface 将子控件一起录入背景，子玻璃按钮再采样该层，形成 RenderNode 环。`NativeGlassSurface` 改为只录制背景、模糊及底色层，内容控件处于采样源之外；保留真正的高斯模糊。修复与原失败用例的最终构建、复测及下载状态以工作记录为准。

## MCP 授权与自动审批状态

156 支持 `mcpServer/elicitation/request`，响应使用 `{action,content}`。空字段确认表单沿用自动审批开关，正常自动完成不发审批请求通知；需要用户内容的表单转换为问题并按原 JSON Schema 校验后回传。URL 授权及 `openai/userVerification` 保留人工完成，不伪造设备证明。没有额外打开尚未接入的初始化能力开关。

`item/autoApprovalReview/started`、`item/autoApprovalReview/completed` 和 `autoApprovalReview/strictReviewRequired` 是上游自动审查状态，不是可回答的 RPC。删除按方法名中出现 `approval` 就生成 `approval.requested` 的宽泛映射。正常审查状态保持安静，拒绝、超时或中止作为操作结果；真正人工审批仍由 `serverRequest` 创建。Android 465 将旧的非待办审批记录归入操作折叠，已自动批准的条目不占独立消息，待回答的问题与明确待办保持原入口。

从 0.6.464 起，每条事件连接结束时，Android 通过现有 GET `/api/diagnostics/performance` 记录一次 `androidSocket=` 查询参数。查看网关 `console-logs/gateway.log` 中包含该字段的请求，可按 `version`、`stream`、`cause`、`code` 和 `errorType` 区分前台检查、订阅超时、网络／界面生命周期、缓冲溢出、消费者异常及底层连接错误。`durationMs` 为连接持续时间，`idleMs` 和 `frames` 只统计有效应用 JSON 消息，不包含 WebSocket 控制帧心跳。

`NativeSocketTrace` 保留首次原因；`SocketEvents` 在消费者异常向上传播前记录该原因，避免清理阶段的取消将其覆盖。失败记录由 `NativeSocketDiagnostics` 最多暂存 16 条，后续记录或新连接打开时再次尝试；成功确认后移除，不增加常驻轮询。诊断只包含连接元信息和异常类型，不含异常消息、会话标识或消息正文。

单元检查覆盖首次原因保留、失败补发／容量边界、真实 SocketTimeoutException 心跳分类、缓冲溢出与消费者异常的记录顺序。模拟器检查同时验证实际鉴权接口请求、原会话与草稿恢复、健康连接不重建。网关 `1006` 仍不能单独代表内网故障，需与手机端原因和同一时段 HTTP／通知连接对照。

## 提交记录迁移与回退

提交记录保存于 `~/.codex-mobile-control/command-receipts.sqlite`，逐条写入，内存只保留近期工作集。旧 `command-receipts.json` 首次读取时事务导入并原位保留；未完成的提交恢复为结果待确认，不自动重发。取消一万条硬上限不意味着取消请求去重，旧请求身份仍保留在数据库中，不定时删除。

需要回退到使用 JSON 的网关版本时，先停止网关，从 `server` 目录运行以下命令，再切换旧版本。此操作不需要重启共享 Codex 或修改会话。

```powershell
node scripts/export-command-receipts.mjs --output "$env:USERPROFILE\.codex-mobile-control\command-receipts.json"
```

自定义数据目录使用 `CODEX_MOBILE_CONTROL_HOME`，也可通过 `--file` 指定原 JSON 路径。重新升级时会合并旧版新增的记录，已有请求内容冲突则停止迁移并保留原文件；不会用旧快照覆盖较新的记录。备份或搬迁 SQLite 时先停止网关，并一并保留仍存在的 `-wal`、`-shm` 文件。

验证实际Windows安装包时，可运行以下隔离检查。它使用单独的程序、用户和数据目录及随机端口，禁用自启动、快捷方式和桌面共享安装，不调用模型或修改正式后台；结束后清理临时安装，只保留检查报告及日志。这里验证的是本机隔离安装，不等同于另一台电脑或手机实测。

```powershell
node installer/release-smoke.mjs `
  --setup D:\codex\deliverables\Codex-mobile-control\Codex-Control-0.6.447-Setup-x64.exe `
  --work-root D:\codex\build\Codex-mobile-control\release-smoke `
  --report D:\codex\build\Codex-mobile-control\release-smoke\installation-verification.json
```

## Android 模型目录与连接

Android 的模型目录读取由 `NativeViewModel.refreshModelCatalog` 统一持有任务。连接时读取、普通刷新和控制台配置变更复用该入口：普通重复调用复用当前任务，强制刷新替换旧任务，连接结束由 `resetStatusReads` 取消请求并退休 ticket。`GatewayClient.nativeModelUpdates` 分批回调已完成来源，未完成来源保留上次成功条目；完整目录缓存 60 秒。目录状态不负责改写连接地址；默认模型操作还需确认发起后没有切换会话或修改选项。

自动线路的 HTTP 健康检查决定 WebSocket 握手顺序，不排除其余已配置线路。首选地址健康但 WebSocket 升级失败时，同轮继续尝试备用地址；显式内网或公网模式仍只尝试所选线路。已建立连接的恢复、认证失败处理和手动切换沿用原有逻辑。

## Android 跨盘构建

指定 `-PcmcBuildRoot` 将 Android 输出放到另一 Windows 盘符时，根构建脚本会关闭 Kotlin 1.9 增量编译。该版本无法把跨盘的生成 Java 源文件转换成相对路径，导致增量编译失败后再做整编；同盘构建继续使用默认增量行为。

## 复制与本机性能记录

返回手机查看的本地预览图保存到已授权项目内的 `artifacts/previews/`，再提供该项目内的图片链接。公网预览会校验真实文件路径是否位于授权项目中；项目外构建目录里的图片，即使已经出现在回复中，也会被拒绝。

Android 原文选区继续使用系统 TextView 的范围、拖动手柄、菜单和复制行为，蓝色底色由 `NativeSelectableTextView` 按每行实际文字的选区路径绘制，跳过空行和行尾未选中文字的空白。每行路径先与该行实际文字边界相交，再合并为一个轮廓并加轻微圆角；避免软换行端点被系统归入下一行后留下额外轮廓，以及各行独立圆角形成缺口。保留 Layout 对双向文字的分段处理。绘制及链接短按保护使用两个非负且不相等的选区端点判定，兼容反向选到第 0 个字符；Android 12 的 `TextView.hasSelection()` 会漏掉这个范围。路径按 Layout、文本和选区范围缓存，拖动选区时更新；不在 Compose 中逐帧保存选区。

行内代码使用 `NativeInlineCodeSpan`，字体和测量沿用 Markwon，代码底色先于蓝色选区绘制，避免遮住选中高亮。底色按当前文字色与 Surface 混合生成，浅色为低对比灰、深色为炭灰，不再沿用玻璃面板的白色 wash；表格和面板颜色不受影响。底色路径按文本和 Layout 缓存；复用 View、更换文本和布局时失效。Markdown 引用使用 2dp 圆角竖线和 14dp 缩进，竖线按可见行裁切绘制，首行滚出可见区域仍连续显示，不重叠叠加透明度；保留原文及嵌套层级。系统选文菜单保留，“整屏选文”入口继续按本轮回复整理纯文本。

前台收到 `approval.requested` 的 question 时使用现有应用内通知面板提示，显示会话和问题摘要，点击“回答”进入对应会话。当前会话的待回答问题也提示；历史回放不提示，同一请求按电脑、会话和 approvalId 去重。当前会话同时加入待回答列表，不等待下一次历史轮询；重复事件使用同一个问题弹框身份，已回答或远端解决后移除提示。普通自动审批不加入这条通知链路；应用在后台时继续使用原系统通知，前台不重复发系统通知，当前会话的任务完成仍静默。

图片、PDF 和文档预览通过可选内容槽展示同一份通知；只在最上层预览窗口挂载，避免通知被独立窗口遮住或重复显示。图片预览期间也暂缓自动打开回答表单，点通知“回答”后由原会话切换流程退出预览，草稿沿用原保存与恢复逻辑。

PDF、文档和整屏选文共用 `NativeReaderDialog` 与 `NativeReaderToolbar`。原生窗口覆盖完整显示区域，关闭独立窗口的灰色 dim 层；背景不透明，正文按 safeDrawing 避让系统栏，避免状态栏露出底层聊天路径。工具栏沿用当前主题的按钮和标题组件：标准主题位于正文上方，液态玻璃及轻量主题浮在预览内容上，并按实际测量高度为正文留出初始空间。每个阅读器拥有独立玻璃采样源，只采样阅读器正文，不采样底层会话；PDF 缩放时将顶栏空间换算成列表原始坐标。

PDF 预览使用双指缩放，放大后单指在横纵两个方向拖动；原始大小继续交给连续页面列表处理纵向滚动和惯性。缩放围绕手指中心进行，横向拖动限制在内容边界内；列表使用未缩放坐标保留连续翻页和当前页统计。小尺寸整页位图仅作为手势过程和未细化区域的底图；手指释放且滚动停止 100ms 后，根据当前倍率、横向位移及列表实际可见页计算裁切区域。`NativePdfPages.renderRegion` 将 PDF 矢量内容直接渲染到该可见区域的物理像素尺寸，叠加到正确页面坐标，不受整页约 200 万像素的底图限制，也不分配整页 4 倍大图。新细节准备好前继续显示原图；取消的未交付位图回收，渲染与关闭共用互斥锁。顶部保留返回、文件名、页码和保存，不显示缩放按钮。

## Android 文档阅读

上传附件和会话文件链接使用同一阅读入口，继续经过原网关文件授权，不新增上传到外部服务的转换流程。原始文件保存在既有受限缓存中；阅读时固定，关闭或清理会话上下文后释放。保存使用原始文件字节，避免将 Office 阅读内容或表格 HTML 覆盖回原文档。

文档 WebView 在液态主题下使用软件视口图层参与玻璃采样，轻量及标准主题保留原图层路径；切换主题时同步调整，避免 GL 图块绘制被捕获图层重复使用。onRenderProcessGone 接管文档渲染进程退出，销毁失效视图并在阅读器中提供重新加载，新建 WebView 恢复，宿主应用保持打开。释放后的异步视觉回调不更新状态，网络访问及脚本继续禁用。

设置首页、设置子页和文件夹共用阅读器的悬浮布局：液态主题的正文占满视口，顶部留白放在可滚动内容中，滚动后正文可经过顶栏和筛选栏背后；标准主题仍将工具栏排在正文上方。顶栏、固定筛选和文件夹导航从独立的正文图层采样真实模糊；底部弹层及菜单使用现有 MENU／SHEET 材质；账号切换、配置、维护、会话和清理确认共用 NativeAlertDialog，液态主题使用页面独立采样源，标准主题沿用 Material 对话框，确认、取消、忙碌和危险操作条件保持原逻辑。轻量主题不启用高斯采样。列表和 WebView 的滚动位置在绘制阶段读取，令采样随内容更新，不按每帧重组页面。设置分组、文件项及 Dashboard 卡片共用 INSET 材质、圆角与图标底座，不为每项独立模糊。刷新、下载、源码／阅读、返回、编辑等常用操作使用图标，保留无障碍名称；长按显示同主题说明，1.4 秒自动收起。设置值、确认、重启等需要明确对象的操作保留文字。

内网可见回复中的目录链接支持应用内只读浏览。文件接口用 HTTP 409 和 `kind:directory` 区分目录，Android 随后读取同一回复授权的目录列表；子文件通过 `directory` 来源参数读取。每次读取都重新核对原回复链接，并用真实路径限制在链接目录之内，排除向上跳转和指向外部的 junction／symlink；不添加持久项目授权。目录返回及刷新复用文件列表，图片和文档沿用阅读器，关闭阅读器后返回原目录；关闭目录或切换会话取消未完成读取。网关能力为 `local-thread-output-directories`，公网访问仍沿用原文件规则。Android 字节、图片和下载读取均保留服务端 JSON 错误原因，非 JSON 响应保留 HTTP 状态码。

工作区中的 Office 文件也使用同一阅读入口；文本文件保留原编辑器，并提供“阅读”按钮，以当前编辑草稿生成阅读内容，关闭后继续编辑，不自动写回项目。阅读草稿的保存沿用现有 Markdown 草稿行为，保存当前草稿文本；下载附件的保存则使用缓存原文件。文档排版由本机 WebView 完成，首次取得原生布局尺寸后加载本地 HTML，显示文字加载状态，视觉状态回调确认新内容已准备绘制后收起，加载失败提供重新加载。表格容器只负责横向查看，不按 `100vh` 限制高度；纵向由文档自然滚动，避免初始视口尚无尺寸时把表格裁成 0 高。

| 格式 | 应用内阅读方式 |
| --- | --- |
| PDF | 连续页面、双指缩放、放大后单指拖动、可见区域按实际倍率细化 |
| Markdown | 原有标题、正文、图片、公式和代码阅读，支持源码切换 |
| TXT、日志、JSON、YAML、XML、代码等 | 原文选择与复制，普通 TXT 使用正文字号和行距，代码保留等宽 |
| DOCX | 标题、段落、加粗／斜体、列表、表格及内嵌常见位图 |
| XLSX | 多工作表、稀疏单元格、共享／内联字符串、缓存公式值、常见日期和百分比 |
| PPTX | 按文稿顺序切换幻灯片，基础文字、图片及表格，沿用可用的形状位置 |
| CSV／TSV | 表格、行列标识、横向查看，保留引号内换行、逗号和转义引号 |
| HTML | 本机排版，支持双指缩放和蓝色文本选择 |

Office 在后台用 Android XML 和 ZIP 能力读取，按文档内容生成阅读视图，不引入完整 Office 引擎；不执行宏、不重新计算公式。旧版 DOC／XLS／PPT 沿用保存后交给系统办公应用的流程；复杂 Office 图表、母版和布局不保证桌面级还原。内嵌大图按最长 2048px、约 200 万像素缩小用于预览，保存原文档不受影响。ZIP 不解压到磁盘，对条目、总展开字节及 XML 规模限制；超过阅读规模或不能解析的 Office 文件仍提供保存原文件的入口。

HTML 与生成的 Office／表格页面使用独立 WebView，复用 `NativeReaderDialog` 的顶栏、主题、安全区和最上层通知。无 JavaScript、文件或 Content URI 权限，禁止网络资源加载，并以 CSP 限制脚本、表单及外部资源；用户点击的 HTTP／HTTPS 链接交回现有文件／浏览器处理，不把活动网页脚本带入控制台。正文、选区、表头、表格线及背景跟随当前浅色／深色主题，隐藏系统缩放按钮，保留手势缩放。

Codex 的 `:codex-file-citation{path="…" artifact_kind="workbook" purpose="output"}` 在回复中显示为文件名链接，沿用现有预览、保存和系统打开流程。Android 在答案展示及复制前转换为普通 Markdown 链接；Web 和网关的可见文件引用校验共用内联解析器。中文、空格、`%`、`#` 等字符按原始文件名编码，代码块、行内代码和转义示例保留原文。网关继续只允许读取这条可见回复实际引用的文件，公网文件访问边界不变。

设置的诊断页提供“性能记录”：手动开始、最多 60 秒，可提前结束，在本机查看或保存 JSON。默认关闭；开启后使用一个 FrameMetrics 回调线程采集 Activity 和 Dialog 窗口，记录 P50/P95/P99、超预算帧、弹窗帧及采样回调丢失数，停止后移除监听和线程。离开诊断页继续记录，返回页面查看结果。回调仅写有界普通数据，不逐帧触发 Compose State 或写文件。

记录包括回前台、连接验活、Socket 建立、历史就绪、发送按钮可用的阶段，以及健康、历史、目录和侧栏 HTTP 请求的 DNS/TCP/TLS/首字节/总耗时。不包含消息、会话 ID、URL、路径、密码或 Token，不自动上传；设备型号和 Android API 用于解释帧耗时。WebSocket 的连接标记来自业务回调，不能据此假定 OkHttp 会提供全部 WebSocket 的网络分阶段计时。

`composer` 记录发送/停止按钮的状态变化及所在前台周期，区分连接、提交、上传、停止、空输入、模型不可用和可操作状态。按钮与诊断使用同一判定，模型检查保留原短路顺序；开始采样即记录当前状态，不要求先编辑草稿。状态只在变化时写入有界记录，摘要停止后显示，聊天界面不增加诊断文字。

玻璃背景滤镜使用 Compose 管理的绘制图层，移动与场景变化在该图层内触发重绘；不再反复录制独立的带滤镜 RenderNode，避免已在 Android 12 模拟器复现的旧位置画面残留。采样范围向面板外扩展两倍模糊半径，面板仍按原尺寸布局并裁切；底色、边框和文字保持独立，不随背景一起模糊。轮廓和滤镜尺寸只随布局、主题或密度更新，不逐帧重算。

认证后的 `GET /api/diagnostics/performance` 返回网关现有两个历史工作线程的队列、执行、合并、取消和超时计数，以及连接积压字节、心跳延迟和持久化状态。手机采样前后读取该摘要，不增加网关轮询或另一套调度队列。累计计数从网关启动时开始，分析时比较前后差值；帧耗时统计不等同于实际显示 FPS，软件模拟器也不能代替实体手机性能测量。

## Android 图表提示与用量总览

额度、Token 模型曲线、统计历史曲线与年度热力图共用 `ChartCallout`。提示位置使用图表内实际触点，不使用所选数据值的高度；非焦点 Popup 可以显示在图表上方，正常留出 48dp 的手指空间并限制在窗口边缘内。窗口顶端空间不足时，按左右可用空间限制提示宽度，让文字换行，再放到能容纳它的一侧。图表坐标只由提示窗口的测量阶段读取，初次坐标未就绪时不显示内容，避免先显示宽框再突然缩窄。

提示不参与卡片测量，不推移已有内容。静止按住 140ms 后显示，横向移动超过触摸阈值即显示；短按和起手纵向滚动不发布图表选中状态，也不创建提示窗口，父页面继续滚动。横拖或按住确认查看后，由图表持续接收同一次手势；上下偏移不重新判定方向，越界坐标限制在边缘，松手或取消后隐藏。模型曲线的路径缓存保留，触点状态仅由提示子组件读取。

额度曲线先按横坐标查找每条曲线上最近的时间点，再选择离起始触点最近的曲线；同一次拖动固定这条曲线，只随横坐标改变时间，避免上下偏移跳到另一条曲线或较远时间。各曲线使用已有的时间排序结果二分定位，不在每次触点更新时过滤并扫描全部记录。

Token 总览将标题、大号总量、日期依次排列，计量记录数放在指标之后；总量与分项数字显式设置对应字号的行高。刷新状态仍在标题行显示，不添加顶部加载块或改变卡片高度。Token 数量继续使用万、亿单位，输入、输出、缓存和推理的计量口径保持不变。

## 生成产物清理

每次编译完成并确认结果可用、当前安装包交付成功后，清理较早的生成产物；不使用定时任务。`scripts/cleanup-workspace.ps1 -KeepVersion 0.6.447,0.6.446,0.6.445` 显式保留当前验证通过的 Android 与 Windows 版本，只删除更早的版本 APK/EXE/ZIP、发行清单和 `artifacts/portable-*` 展开目录；版本号随实际交付更新。`-Preview` 只列出目标，构建或发行验证运行中跳过清理。清理时保留当前构建输出、源码、Git、非发行参考文件和下载入口。D 盘的版本交付也在每次确认成功后清理旧版本，保留当前可用发行包。Windows 打包的编译临时文件、展开运行时和 payload 使用系统临时目录，打包后自动释放。

## 电脑端 Gateway

```powershell
cd server
npm install
npm run dev
```

启动后查看日志里的 token。配置文件位于：

```text
~/.codex-mobile-control/server.json
```

运行状态位于：

```text
~/.codex-mobile-control/state.sqlite
```

该数据库保存已连接设备、thread 索引、审批和最近事件缓冲。旧版本的 `state.json` 会在启动时自动迁移到 SQLite。

手机连接地址示例：

```text
http://电脑局域网IP:38457
```

## 公网秘密路径

Local Console 的公网连接表单可点击“生成秘密路径”，在现有 HTTPS 域名后添加随机路径。生成使用浏览器密码学随机数，长度 32 字节；点击“保存连接设置”才生效。也可手工填写一个 22–128 字符的路径段，字符限字母、数字、短横线和下划线，例如 `https://phone.example.com/<随机路径>`。不能包含多段路径、百分号编码、查询参数、片段或 `..`。点击“移除秘密路径”并保存可恢复域名直连。

启用前先安装 Android 0.6.448 或更新版本，再将手机公网地址改为完整地址；重新扫码配对时会自动携带秘密路径，已有设备无需撤销或重新授权。修改路径只影响之后的新请求和 WebSocket 握手，已建立的连接不会主动断开。入口立即读取新配置，守护进程也使用带前缀的健康检查，不重启共享 Codex。

回退旧网关前，在新版控制台移除秘密路径并保存，同步还原手机地址；旧版公网入口不识别前缀。原密码和设备绑定不变。

Android 0.6.449 起，公网健康检查的连接、读取、总时限分别为 10、10、15 秒；内网仍为 3、4、5 秒。手动公网测试使用可取消请求，依次验证 HTTPS/密码、设备认证和实时连接，总时限 40 秒；错误路径的 HTTP 404 单独提示。公网入口日志只记录去除前缀后的 `/health`、`/ws` 或泛化的 `/api/*`，不记录秘密路径、查询参数、密码或设备 Token。

请求先校验秘密路径，再按 HTTP 方法和去除前缀后的接口白名单检查。缺失、错误和越界形式返回 404；正确路径仍需原公网密码、设备 Token 和证书签名。手机对完整外部路径签名，入口覆盖转发头并传递原始目标，Gateway 仅信任持有代理密钥的入口。秘密路径用于减少接口暴露，不替代身份认证；不要将完整地址写入公开日志或截图。

`/downloads/android.apk` 继续作为公开安装包地址，保持已有更新和下载链接有效，不包含接口或设备凭据。公网聊天、管理网页和其他接口的现有开放范围不因秘密路径而扩大。

## 设备配对

先在电脑端启动 Gateway，然后用管理员 token 生成配对码：

```powershell
$token = (Get-Content "$env:USERPROFILE\.codex-mobile-control\server.json" | ConvertFrom-Json).token
Invoke-RestMethod http://127.0.0.1:38457/api/pair/start -Headers @{ Authorization = "Bearer $token" }
```

手机端输入电脑地址和返回的 `code`，点击“配对”。配对成功后手机会保存设备 token；之后不需要再输入管理员 token。

也可以打开 Web 控制台点击“生成配对码”，页面会显示二维码。Android 注册了：

```text
codex-control://pair?baseUrl=...&code=...
```

手机扫码后会自动填入 Gateway 地址并完成配对。

撤销设备：

```powershell
Invoke-RestMethod http://127.0.0.1:38457/api/devices -Headers @{ Authorization = "Bearer $token" }
Invoke-RestMethod http://127.0.0.1:38457/api/devices/<deviceId> -Method Delete -Headers @{ Authorization = "Bearer $token" }
```

## API 验证

```powershell
$token = "日志中的 token"
Invoke-RestMethod http://127.0.0.1:38457/health
Invoke-RestMethod http://127.0.0.1:38457/api/projects -Headers @{ Authorization = "Bearer $token" }
Invoke-RestMethod http://127.0.0.1:38457/api/settings/user -Headers @{ Authorization = "Bearer $token" }
```

## Smoke Test

```powershell
cd server
npm run smoke
```

该脚本会自动启动 Gateway，并验证：

- `/health` 服务版本、协议版本和能力列表
- `/console`
- 配对码、设备 token、设备列表和撤销
- 管理员 token 与设备 token 轮换，旧 token 失效、新 token 继续可用
- projectRoots 添加、列表、移除和项目列表同步
- HTTPS 配置读取、自签名证书生成和证书文件状态检查
- 项目添加和列表
- 文件树、文本读取、raw 文件预览
- Codex 常用设置和完整 `config.toml` 原文读写
- 审批策略摘要、风险等级和移动端展示
- git diff
- diff 文件清单和单文件 diff
- 单文件 diff 接受和撤销
- 当前 diff 文件列表批量接受和撤销
- 单文件 hunk 列表、按 hunk 接受和撤销
- 项目内本地命令执行、停止和终端输出事件
- 终端历史输出恢复 API
- 终端命令历史聚合 API 和 Android 按命令卡片展示
- SQLite 状态库生成、设备/事件写入，以及 Gateway 重启后的事件回放
- threads 和 approvals API
- Codex CLI/app-server 状态 API
- Codex mock app-server、崩溃自动重启，以及重启后的 thread resume
- WebSocket 连接、实时事件和最近事件回放

Smoke test 会通过临时 `CODEX_MOBILE_CONTROL_HOME` 运行 Gateway，不写入用户真实的 `~/.codex-mobile-control` 配置和状态，避免临时项目污染手机首页。

## Web 控制台

```text
http://127.0.0.1:38457/console
```

打开当前 Gateway 的网页后，使用 Token 或配对码连接。网页版是当前主要使用与调试入口，提供项目、会话、文件、diff、PTY 终端和预览。运行 `npm run test:web` 验证实际浏览器操作；覆盖范围见 [网页验证](web-verification.md)。原生 Android 后续按网页版设计移植。

## Android

当前工程带有 Gradle wrapper：

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

项目盘空间不足时可指定中间文件与 Gradle 项目缓存目录，源码仍使用当前仓库：

```powershell
.\gradlew.bat :app:assembleRelease --project-cache-dir D:\codex\build\Codex-mobile-control\gradle-cache -PcmcBuildRoot=D:\codex\build\Codex-mobile-control\android '-Pkotlin.incremental=false'
```

Release 输出位于指定根目录下的 `app\outputs\apk\release`。Windows 打包时通过 `--android-build-dir D:\codex\build\Codex-mobile-control\android\app` 读取对应构建元数据，`--android-apk` 可指定已复制到其他盘的最终 APK；省略时按原规则读取仓库 artifacts 中的版本文件。省略 `cmcBuildRoot` 时沿用默认构建目录。

Windows 上源码和中间产物跨盘时，Kotlin 增量编译不能计算两者的相对路径，需在该命令中关闭增量编译。默认同盘构建沿用现有设置。

本机必须安装 Android SDK，并满足以下任一条件：

- 设置 `ANDROID_SDK_ROOT`
- 或在 `android/local.properties` 写入 `sdk.dir=你的Android SDK路径`

Windows 常见的 Android SDK 位置：

```text
%LOCALAPPDATA%\Android\Sdk
```

Debug APK 输出：

```text
<仓库目录>\android\app\build\outputs\apk\debug\app-debug.apk
```

当前验证结果：

- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run smoke` 通过。
- `.\gradlew.bat assembleDebug` 通过。
- `.\gradlew.bat connectedDebugAndroidTest` 通过。

Android smoke test 可直接用项目脚本执行：

```powershell
.\scripts\run-android-smoke.ps1
```

默认行为：

- 若本机不存在 `codexApi31` AVD，会自动基于 `system-images;android-31;google_apis;x86_64` 创建。
- 若当前没有运行中的模拟器，会自动以无窗口模式启动。
- 执行 `:app:connectedDebugAndroidTest`，当前覆盖 9 条 Android Compose / 仪器回归。
- 当前还覆盖一条连接流测试：已保存连接自动连上 Gateway 后，首页展示项目/会话，点击会话进入聊天，再返回首页。
- 当前还覆盖一条实时流测试：后台线程消息不会抢走当前会话焦点，当前线程的 WebSocket 增量会继续追加到聊天内容。
- 当前还覆盖一条文件跳转测试：聊天里收到 `file.changed` 事件后，可直接切到文件页并加载项目根目录文件列表。
- 当前还覆盖一条 diff 跳转测试：聊天里收到 `diff.updated` 事件后，可直接切到 diff 视图并看到改动文件。
- 当前还覆盖一条终端联动测试：收到 `terminal.output` 事件后，终端页会显示命令、输出和运行中/已完成状态。
- 当前还覆盖一条设置页 smoke test：模型 Provider 设置卡片会渲染当前 Provider 和 base_url 控件。
- 当前还覆盖一条终端会话 smoke test：终端页会突出显示当前活跃交互会话，并提供统一输入入口。
- 测试结束后默认关闭模拟器；需要保留模拟器可传 `-KeepEmulator`。

## 当前 MVP 能力

- 电脑端 Gateway Bearer token 鉴权。
- 项目列表、添加项目。
- Android 设置页可管理允许项目根目录；移除后该目录不再出现在项目列表，文件、终端和 diff 也无法继续访问。
- 读取和保存用户级 Codex 设置。
- Android 设置页可直接修改 `model_provider`、当前 Provider `base_url` 和 `disable_response_storage`。
- Android 设置页展示审批策略、沙盒和网络访问的风险摘要；审批卡片按命令、文件、权限类型显示提示和动作文案。
- 读取和保存完整用户级 Codex `config.toml`，用于覆盖桌面端全部设置内容。
- WebSocket 事件通道。
- Android 连接前校验 Gateway 协议版本，连接弹窗展示 Gateway 版本和协议号。
- 设备、thread、审批和最近事件使用 SQLite 持久化。
- 配对码、设备 token、设备撤销和 token 轮换。
- Android 连接设置可一键轮换当前 token，并自动保存新 token 后重连。
- Gateway 支持 HTTPS 配置和自签名证书生成；Android 可选择信任自签名 HTTPS 证书连接本机 Gateway。
- Android 设置页可查看已授权设备、刷新设备列表并撤销设备。
- Thread 事件回放 API。
- Thread resume：Gateway 重启或 app-server 重启后，发送新消息前会自动恢复历史 thread。
- Codex app-server stdio 桥接。
- Android 连接区和桌面侧边栏对应功能区：文件、侧边聊天、浏览器、终端、项目、设置。
- Android 使用 Material You 风格浅色主题、圆角卡片、在线/离线状态点、连接设置弹窗和右上角低频功能菜单。
- Android 设置页把审批策略、沙盒模式和推理强度改成可点选控件，更适合触屏操作；Provider 和隐私项单独成卡片。
- Android Gradle 配置已显式把 `src/main/java` 挂到 `test` 和 `androidTest` 源集，避免老版本 AGP/Kotlin 组合下测试源码偶发丢失主代码类路径。
- Android 默认首页按项目展示会话，支持搜索项目/会话；点项目会进入新会话，点会话会恢复聊天并自动绑定对应项目上下文。
- Android 端保存最近连接地址和 token。
- 对话页支持 message delta 聚合，连续增量会显示为一条逐字增长的消息。
- 对话页支持发送 prompt 和停止当前 turn。
- 对话页支持继续当前对话和重试上一条用户指令。
- 对话输入区支持加号工具菜单、会话列表弹窗、模型快捷设置，以及发送/停止单图标按钮。
- 对话事件块支持就地快捷动作：审批允许/拒绝、消息复制、文件变更跳转、diff 查看、终端停止/复制。
- 对话页支持终端块内嵌显示、展开/折叠、搜索和复制。
- 本地 Web 控制台，用于在无 Android SDK 环境下验证主链路。
- 服务端 smoke test，覆盖 Gateway 关键 API。
- 文件树、文本读取/保存、raw 文件预览 URL。
- 手机文件页支持编辑 / 预览切换，图片、HTML、SVG 和常见文本可直接内嵌查看。
- 本机 dev server 预览代理。
- 项目 git diff 查看、按文件列出改动、单文件 diff 查看。
- 手机端 diff 文件列表支持单文件和批量接受/撤销；接受会暂存文件，撤销会恢复对应文件的暂存区和工作区。
- 手机端单文件 diff 支持按 hunk 接受/撤销；工作区 hunk 可单独暂存，已暂存 hunk 可单独撤回。
- 手机端终端页可选择已添加项目、运行或停止单次本机命令，并流式显示 stdout/stderr。
- 手机端连接后会恢复最近终端输出，并按命令卡片展示 scrollback，支持展开、搜索、复制和停止运行中的命令。
- 终端命令列表支持大输出尾部预览，手机端可按需加载更早输出分页。
- 手机端可启动持久交互式 shell 会话，连续发送输入并停止会话；服务端当前已切到 PTY 后端，Windows 使用 ConPTY/winpty 路径，普通交互式 CLI、提示符和终端尺寸感知已明显好于普通管道进程。
- 手机端终端页会固定显示“当前交互会话”输入栏，可在多个活跃 shell 会话间切换目标，并统一发送输入或停止会话。
- 手机端终端显示已从简单文本清洗升级为轻量终端缓冲区解释器，当前可处理 ANSI 颜色清理、`\r`/`\b`、清屏、清行、光标相对移动和绝对定位，进度条、覆盖刷新和部分全屏界面输出会更接近真实终端。
- 手机端终端块已支持基础 SGR 富文本渲染：8 色/高亮色、256 色、truecolor、粗体、斜体、下划线、dim 和反显会按终端样式显示，不再全部压成单色文本。
- 终端折叠视图、搜索筛选和命中高亮现在都会保留原始终端样式；搜索不会再因为筛出匹配行而把颜色和属性丢掉。
- 手机端终端输出区域默认不自动折行，并支持横向滚动，长命令行、表格和列对齐输出不会被手机窄屏强行打散。
- 手机端终端缓冲区已支持 `alternate screen` 进出时恢复主屏内容，`less`、`vim` 一类全屏界面退出后的 shell 画面不会再直接丢失。
- 手机端终端块本身带内部滚动区，长输出会在块内纵向滚动，而不是把整个聊天页无限撑长；配合横向滚动更接近桌面终端面板。
- 终端缓冲区当前额外支持插入/删除行、删除字符、整屏滚动和 reverse index，一些 curses/全屏工具的重绘过程会更稳定。
- 终端缓冲区当前已支持 `scroll region` 和 `origin mode`，全屏界面在局部滚动区域内重绘、翻页和回到区域原点时会更接近真实 VT 终端。
- 终端命令仍在运行时，终端块会自动跟随输出末尾；如果手动上滑离开末尾，会出现“最新”按钮，方便一键回到底部继续追踪输出。
- 终端块的复制动作已拆成“复制可见”和“复制原始”：前者适合直接带走当前渲染结果，后者保留原始控制序列和完整输出，便于复现或调试。
- 手机端终端页支持常用控制键快捷发送：`Ctrl+C`、`Tab`、`Enter`、方向键、`Esc`、`Home`、`End` 和 `Del` 会以原始输入方式发送，不自动补换行。
- 手机端终端输入框支持“回车发送 / 原样发送”两种模式；原样模式允许发送多行文本、纯空格片段和控制序列，适合补全、分段输入与 TUI 交互，快捷键里额外补了左右方向键与退格。
- 手机端在线性输入模式下会把软键盘发送动作直接映射到“发送到当前会话”；原样模式保留键盘默认换行，便于粘贴和分段编辑多行输入。
- 手机端切换当前交互会话后，不会因后续输出刷新而跳回默认会话，多个活跃 shell 并行时可稳定盯住当前目标。
- 手机端终端页会根据当前终端面板尺寸估算 `cols/rows` 并自动同步到服务端 PTY，会话创建后以及视口变化后都会 best-effort 触发 resize。
- 当前仍缺一个真正的前端终端模拟器，所以 `vim`、`less`、`htop` 这类复杂全屏 TUI 虽然已经有 PTY 基础和部分控制序列渲染，但手机端显示层还没完全追上。
- Codex CLI/app-server 状态检测、请求超时、退出清理、启动/重启和异常退出自动拉起。
- Codex app-server 事件适配：命令输出、工具状态、审批请求、文件变更、turn diff、警告。
- app-server 异常退出后会清空 Gateway 内存中的 active thread 缓存，下一条消息会先 resume 再继续 turn。
- 手机端允许/拒绝命令、文件与权限 profile 审批请求。

## 下一轮优先事项

- 前端终端模拟器和全屏 TUI 渲染。
- Telegram adapter。
- QQ / 微信真实账号联调及附件、审批接入（文字驱动已实现）。

Android 0.6.469 的侧聊复用主聊模型控制、上传接口与图片预览，附件由侧聊 controller 持有，不能通过主聊上传方法修改主草稿。未确认提交保留原文字和附件并禁止重复发送，收到接受回执只清除该次提交的内容，后续编辑保留。上传取消与清理使用独立任务标记，旧上传不覆盖新任务。主聊和侧聊共用 `NativeChatProcessing`，在消息列表末尾靠左显示扫光文字。侧聊附件区域限制高度，避免多文件挤掉输入框。

侧聊上传沿用设备草稿 owner，`uploadDraftBody` 合并所有侧聊的未发送附件引用；进入附件清理界面前统一同步，收起侧聊不会解除草稿保护。上传期间若电脑连接断开，连接错误在侧聊上传任务中处理，保留草稿并结束上传状态。

Android 0.6.470 的聊天状态统一由 NativeChatProgress.kt 判断：加载优先，发送确认单列，只有当前轮尚无回复时显示等待；已展示正文或操作时不追加通用状态。等待文字与 NativeActivityHeader 的标题对齐。NativeChatProgressTest 覆盖加载、旧 running 元数据、已结束轮次、迟到边界与首个内容的转换。

速度统计分组键是 model／provider／tier／effort／phase；NativeSpeedService 的会话聚合及 Web／Android 分组身份须采用同一维度。原生历史统计是整段可见回复的平均估算速率；路由请求是包含等待和推理的端到端速率。firstTextMs 只取正文增量，不能用 firstOutputMs 的工具／思考事件替代；旧记录缺失时返回 null。原生 tier 来自会话记录，路由 tier 来自上游响应，均不从当前 UI 开关追溯改写旧样本。派生缓存迁移可重建自身索引，不能修改原始会话历史。定向检查：node --test server/scripts/speed-dimensions.test.mjs（先构建网关以生成测试导入的 dist）。
