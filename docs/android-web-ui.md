# Android 网页容器历史版本

0.4.0 已改为原生 Compose 入口，见 [原生 Android](native-android.md)。以下内容记录 0.3.3 及更早版本，不作为当前安卓构建或验收步骤。

## Android 0.3.3

手机滑条去除浏览器蓝色触摸高亮，增加按下反馈和档位过渡；侧栏、模型面板、菜单增加入场动效，并遵守系统减少动态效果设置。手机顶部 Codex 可点击进入新任务，旧任务草稿保留。

新任务无需先选项目，电脑端自动使用独立的默认工作区。发送后立即显示消息、清空输入并显示启动状态，提交失败恢复输入。从桌面同步的任务可自动登记并恢复原目录，兼容 Windows 扩展路径前缀；任务恢复重新读取会话文件，避免新任务被短时目录缓存漏掉。

36 项 Chrome 网页回归、后端 smoke 和 TypeScript 构建通过；截图中的 ICONIP 桌面任务已在真实 Gateway 恢复成功。真实 Chrome 手机尺寸检查及 Android 12 / WebView 91 模拟器安装、连接、触屏滑条和返回键检查通过，未验证实体手机。APK 版本 0.3.3 / versionCode 11，调试签名。

安装包：[Codex-Control-0.3.3.apk](../artifacts/Codex-Control-0.3.3.apk)。

## 0.3.2

修复阅读历史时被每 8 秒后台刷新拉回底部的问题。流式更新保留上翻位置，底部继续跟随；回到最新立即跳转，避免被流式刷新打断。

34 项 Chrome 网页回归通过，包括实际轮询和流式滚动检查。APK 构建及 Android 12 / WebView 91 模拟器启动、连接和界面检查通过，未验证实体手机。版本 0.3.2 / versionCode 10，调试签名。

安装包：[Codex-Control-0.3.2.apk](../artifacts/Codex-Control-0.3.2.apk)。

## 0.3.1

默认隐藏普通 warning，可通过会话菜单的“显示运行提示”查看。隐藏提示不会打断流式文字合并。真实错误保留详情，更新后的 Gateway 会将错误一起返回到历史记录。

历史导入按 Codex 的内容来源标记区分用户正文与插件推荐、AGENTS 指令、运行环境；同一条记录中的真实提问以及用户主动粘贴的标签示例仍保留。客户端也兼容旧 Gateway 的上下文包装格式，避免把内部内容显示成用户气泡。

验证：33 项网页回归、TypeScript 构建、Chrome 现场检查和 Android 12 / WebView 91 模拟器检查通过。截图对应的 `test` 任务在网页和 APK 中均只显示一条真实用户消息，warning 卡片默认不显示。安装包为 0.3.1 / versionCode 9，使用调试签名。

安装包：[Codex-Control-0.3.1.apk](../artifacts/Codex-Control-0.3.1.apk)。截图：`artifacts/visibility-after.png`、`artifacts/android-visibility.png`。

服务端导入过滤在隔离 Gateway 和真实会话文件读取中验证通过。当前旧 Gateway 由客户端兼容过滤；电脑端服务更新并重启后，历史 API 也会过滤内部上下文。

## 0.3.0

网页与 APK 共用新的任务界面。空白任务使用居中标题和圆角输入框，开始对话后输入框移到底部。模型与思考强度合成一个按钮、一个弹层：上方选择模型，下方使用自绘档位滑条调整强度，仅提供当前模型支持的等级；支持拖动和键盘操作。图片上传入口统一收进“＋”菜单，正文与输入框保持 16px。

点击左上角图标展开 280px 的常驻文字侧栏，主区随之缩放；选择项目、打开会话和进入工具后保持展开，刷新后恢复展开状态。侧栏导航文字为 14px，桌面行高收紧，手机保留触摸点击空间。文件、终端和预览采用纵向图标与文字导航，工具页可返回当前任务。手机使用抽屉导航。

验证：30 项网页回归、TypeScript 构建、Chrome 1440×960 / 390×844 截图与菜单检查，以及 320px 窄屏和 844×390 横屏布局检查通过。网页回归验证了模型选择后继续在同一弹层调整强度、拖动滑条、键盘档位和实际协议参数。Android 12 / WebView 91 验证了打包资源、Gateway 登录、16px 输入、14px 模型、统一模型弹层、系统触摸拖动档位条、返回键关闭弹层和侧栏，无未捕获 JavaScript 错误。安装包版本为 0.3.0 / versionCode 8，使用调试签名；尚未在实体手机验证。

安装包：[Codex-Control-0.3.0.apk](../artifacts/Codex-Control-0.3.0.apk)。当前截图：`artifacts/ux-after-desktop.png`、`artifacts/ux-after-desktop-sidebar.png`、`artifacts/ux-after-mobile.png`。

## 0.2.5 及此前记录

本轮可读性与交互更新：正文、输入框为 16px，侧栏会话为 15px，模型/思考强度为 14px，辅助文字不低于 13px；提高浅色文字对比度。模型与思考强度合并为同一条分段控件，在 360px / 390px 窄屏保持同一行。

长选项列表支持搜索，选择菜单固定显示关闭按钮、自动定位已选项，并支持方向键、Home/End、Enter 与 Escape。桌面菜单靠近触发控件，手机采用底部面板。

修复任务运行时按 Enter 会误停任务的问题：输入仅保留为草稿，停止通过停止按钮明确触发。保留中文输入法组合输入保护。Android 返回键优先取消顶层弹窗，并正确触发取消回调。终端字号提升到 14px，允许较窄的 PTY 行列数以匹配手机。

验证：28 项网页回归、Gateway smoke、Chrome 桌面/手机菜单搜索与定位检查、APK 构建通过；Android 12 / WebView 91 验证了字号、模型与强度同排及返回键取消顶层弹窗。安装包：`artifacts/Codex-Control-0.2.5.apk`，使用调试签名。

2026-09-12：项目、置顶会话和最近会话使用自绘折叠标题，记忆折叠状态；搜索临时展开，清空后恢复。侧栏只保留一个滚动容器，隐藏原生滚动条，使用可拖动的自绘滑块。

输入框旁新增思考等级选择器，只显示当前模型支持的档位，按模型记忆选择，并通过 `effort` 传给下一次 `turn/start`。这不会修改共享 Codex 配置。模型切换后不支持的档位自动回到有效默认值。

25 项网页回归和 Gateway smoke 通过，已验证等级请求传递、模型切换、折叠记忆及搜索恢复；Android 12 / WebView 91 验证了自绘等级菜单与折叠。安装包：`artifacts/Codex-Control-0.2.4.apk`。

2026-09-12 更新：

- 图片支持文件选择、剪贴板粘贴和拖拽，项目不另设图片张数上限；网关保留单张不超过 5 MB 的上传限制。上传文件保存在 Gateway 的应用数据目录，访问需要认证；Codex App Server 通过 localImage 读取已上传图片，其他支持图片的后端沿用各自传输方式。草稿只保存附件 ID，历史会话保留缩略图。
- Android 使用系统文档选择器选择图片；对话中显示上传图片，输出的本地 Markdown 图片在项目权限检查后直接展示。
- 任务计划、工具执行及输出、公开推理摘要进入实时对话并持久化；不展示原始内部推理文本。活动进度不生成虚构百分比，展开状态在流式更新时保留。
- 本机 Codex 会话按桌面 SQLite 的 recency 时间排序，置顶顺序及项目名称/顺序读取桌面状态。桌面项目作为列表元数据展示，未接入 Gateway 的项目需通过添加项目操作接入，展示不会自动扩大文件访问权限。前台每 8 秒刷新桌面列表及当前非流式会话。
- 侧栏顶部导航压缩，项目和会话列表获得更多空间。复制、下载、关闭、保存、终端新增/停止等操作使用图标并保留可访问名称和提示。
- KaTeX 本地渲染行内与独立公式，支持 `$…$`、`$$…$$`、`\\(…\\)` 和 `\\[…\\]`，代码块保持原样；字体随 APK 打包。

验证：23 项网页回归、Gateway smoke、侧栏排序专项测试、TypeScript 构建和 APK 构建通过。真实图像请求将生成的蓝色测试图识别为“蓝色”；Android 12 / WebView 91 验证了系统选择器上传、缩略图和公式渲染。安装包为 `artifacts/Codex-Control-0.2.3.apk`，使用调试签名。

2026-09-12 输出文件更新：聊天中的 Windows 绝对路径、项目相对路径、中文/空格及行号文件链接使用项目权限检查后的预览接口打开。PDF 使用本地打包的 PDF.js 渲染，支持翻页、缩放和下载；图片、网页和文本在内置弹窗打开，其余类型提供下载。Android 使用 DownloadManager 保存下载文件，补齐旧 WebView 中 Markdown 所需的标准 API。

安装包：`artifacts/Codex-Control-0.2.2.apk`。21 项网页回归通过，覆盖聊天 PDF 链接、实际画布渲染及下载文件内容；Chrome 和 Android 12 / WebView 91 均已用 ICONIP 的实际海报验证。电脑上的 ICONIP 项目已按本次请求加入 Gateway 项目列表，其他未授权路径仍被拒绝。

2026-09-12 更新：模型菜单读取桌面配置指定的 `model_catalog_json`，只显示 `visibility = list` 的条目；未指定目录时使用 app-server 的 `model/list`，并处理分页与隐藏项。模型名称不再接受自由输入，Provider 地址只读，任务接口拒绝目录外的模型。切换模型时使用它支持的推理强度。

电脑双击仓库根目录的 `打开电脑控制台.cmd`，会启动 Gateway，通过一次性配对码自动登录并打开配对界面。电脑界面显示二维码、配对码、有效期与网卡地址选择；默认优先选择非虚拟网卡，支持刷新配对码。原来的管理 Token 不写入启动链接。

本次包为 `artifacts/Codex-Control-0.2.1.apk`。网页 20 项回归、Gateway smoke、TypeScript 构建及 Android debug 构建通过；Android 12 / WebView 91 登录与自绘菜单验证通过。真实模型探针使用临时会话收到 `MODEL_PICKER_OK`，未调用工具或修改项目文件。

安卓入口使用随 APK 打包的网页界面，与 `server/public/console.*` 共用设计和交互。连接页离线可用，输入电脑 Gateway 地址后使用 Token 或配对码登录。业务请求仍发往电脑，APK 不包含 Gateway 或 Codex CLI。

下拉选择使用 HTML 自绘弹层，复选框使用统一 CSS。系统键盘、状态栏与系统返回导航由 Android 提供。旧 Compose 页面保留在 `LegacyControlScreen.kt`，不再是应用入口。

构建：先在 `server` 执行 `npm ci`，再在 `android` 执行 `gradlew.bat :app:assembleDebug`。Gradle 自动复制网页与依赖资源，再通过 esbuild 转换旧 WebView 不支持的 JavaScript 语法。可安装调试包输出到 `android/app/build/outputs/apk/debug/app-debug.apk`。

本次交付：`artifacts/Codex-Control-0.2.0.apk`，使用开发调试签名。未制作商店发布签名包。

2026-09-10 验证：

- Android debug 构建、JVM 单元测试通过。
- 网页 18 项 smoke 通过，包括自绘项目菜单、文件保存、终端、预览、Vite HMR。
- Android 12 / WebView 91 模拟器安装和启动通过；连接真实 Gateway、终端库加载、自绘设置菜单、原生 select 隐藏及无 JavaScript 异常检查通过。
- 截图：`artifacts/android-connect.png`、`artifacts/android-workspace.png`。

WebView 检查脚本 `server/scripts/android-webview-check.mjs` 需要先把应用的调试 socket 转发到 9223，使用模拟器的 `10.0.2.2:38457` 访问电脑，并从当前用户 Gateway 配置读取 Token。脚本只做登录和界面检查，不发送模型任务或保存设置。旧 Compose instrumentation 测试不代表新的 WebView 入口验证。

尚未在实体手机验证；不同手机的键盘和 WebView 版本仍需设备检查。
