# 开发与验证

以下命令从仓库根目录执行。

Windows发行包包含本仓库Gateway、Android APK和配套Local Console。打包前，使用conda环境中的Python，先完成Android Release与`server`的`npm run build`；并确认`%USERPROFILE%\.codex\tools\local-console`具有当前可用的`src`、`dist`、`package.json`、`package-lock.json`、生产依赖及`runtime/node.exe`。这里的`dist`是已经构建的Web管理前端，Gateway的`server/dist`是另一组产物。仓库不包含该配套组件的独立开发工程，打包器从已安装组件取材。

```powershell
conda run -n base python installer/build-release.py `
  --version 0.6.444 `
  --android-build-dir D:\codex\build\Codex-mobile-control\android\app `
  --android-apk D:\codex\deliverables\Codex-mobile-control\Codex-Control-0.6.444.apk `
  --android-build-log D:\codex\build\Codex-mobile-control\automation444-build-delivery.log `
  --output-dir D:\codex\deliverables\Codex-mobile-control
```

按实际位置调整路径和环境名。`--android-build-log`指定与APK对应的构建记录，避免为打包额外复制一份日志到项目盘。省略参数时沿用仓库内默认路径。打包会生成Setup、Windows发行ZIP及组件清单，检查生产依赖版本、Node身份和压缩包CRC；暂存文件及内嵌payload使用系统临时目录，完成后清理，不运行安装或修改本机账号。

## 生成产物清理

每次编译完成并确认结果可用、当前安装包交付成功后，清理较早的生成产物；不使用定时任务。`scripts/cleanup-workspace.ps1 -KeepVersion 0.6.322,0.6.307` 显式保留当前验证通过的 Android 与 Windows 版本，只删除更早的版本 APK/EXE/ZIP、发行清单和 `artifacts/portable-*` 展开目录；版本号随实际交付更新。`-Preview` 只列出目标，构建或发行验证运行中跳过清理。清理时保留当前构建输出、源码、Git、非发行参考文件和下载入口。D 盘的版本交付也在每次确认成功后清理旧版本，保留当前可用发行包。Windows 打包的编译临时文件、展开运行时和 payload 使用系统临时目录，打包后自动释放。

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
