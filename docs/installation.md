# Codex Control 安装与使用

支持 Windows 10 / 11 x64、.NET Framework 4.6.2 或更新版本，以及 Android 8.0 及以上。

从 [GitHub Releases](https://github.com/YeJianbo/Codex-mobile-control/releases) 下载最新版本。新电脑使用 Setup，或下载包含 Setup、APK 和说明的 Windows 整包；更新时请安装同一发行版的手机和电脑组件。

## 组件与入口

Windows 整包把 Web 管理后台和手机网关一起安装。Web 聊天与管理后台是两个页面，共用电脑上的执行器和配置；Android 连接同一网关。

| 组件 | 默认入口 | 用途 |
| --- | --- | --- |
| Web 管理服务 Local Console | `http://127.0.0.1:25819/` | 账号、额度、模型、中转、统计、手机绑定、接入和维护 |
| Gateway | `https://电脑局域网地址:38457` | 手机配对、设备认证、消息和文件接口 |
| Web 聊天 | 网关地址加 `/console` | 会话、审批、文件及终端 |
| 网关管理页 | 网关地址加 `/manage/` | 通过已配对网关进入同一套管理界面 |
| Codex 共享后端 | 本机回环端口，自动发现 | 桌面、手机和聊天页复用会话 |

Local Console 与 Gateway 都需要运行，手机上的完整管理功能才可用。管理端口默认25819，仅监听本机；Android通过网关转发管理操作，不直接连接这个端口。安装器通过`-ConsolePort`记录选定端口，启动脚本将它传给两项服务；源码部署时，给两者设置相同的`LOCAL_CONSOLE_PORT`。关闭网页不停止服务。

## 一、第一次安装

1. 在目标电脑安装 Codex 桌面版，完成账号登录，并打开过一次项目。安装程序会寻找完整的 Windows Codex 执行组件；没有找到时会说明原因，不复制其他人的账号。OpenAI 当前安装和登录说明见 [Windows 桌面版](https://learn.chatgpt.com/docs/windows/windows-app) 与 [登录方式](https://learn.chatgpt.com/docs/auth)。
2. 双击下载的 `Codex-Control-<版本号>-Setup-x64.exe` 安装包，选择安装目录，点击“安装”。默认目录是 `%USERPROFILE%\.codex\tools\local-console`；包内包含 Web 管理后台、Gateway、Node 和生产依赖。
3. 默认勾选登录 Windows 后后台启动、与 Codex 桌面版共享会话。安装不会替换 Codex 本体，不关闭桌面任务。共享后端会由网关自动拉起，无需先打开桌面。安装时已经运行的旧桌面需正常退出一次，释放旧会话；重新打开后接入共享后端。
4. 桌面会出现 `Codex Control` 快捷方式，直接打开 Web 管理后台；进入“接入 → 网关与手机”查看绑定二维码、配对码、电脑地址和授权密码设置。日常配置都在 Web 中完成。
5. 安装发行包中的 Android APK，也可从电脑网关的 `/downloads/android.apk` 下载。已有同签名版本可覆盖安装，手机原有数据保留。

Release EXE、APK 和文档在同一个发行 ZIP 中。首次安装生成本机 HTTPS 证书、随机网关 Token 和独立公网密码；分发包没有账号、会话、项目内容、手机设备授权或 Cloudflare 凭据。

## QQ / 微信

打开 Web 控制台的“接入 → QQ / 微信”，选择通用助理或已有工作目录。

- QQ：填写 QQ 开放平台创建的机器人 AppID、AppSecret，也可导入配置后点击“保存并连接 QQ”。在管理页生成绑定码，由需要授权的 QQ 账号私聊机器人发送绑定命令；机器人权限在 [QQ 官方开放平台](https://q.qq.com/) 设置。
- 微信：点击“微信扫码连接”，使用微信扫描并确认；需要验证码时填入微信显示的验证码，确认后自动连接。

授权后发送文字即可开始任务。同一聊天继续原会话；`/新会话` 让下一条消息新建会话，`/状态` 查看当前状态，`/结果` 取最近答复，`/结果 2` 翻到第二页，`/停止` 提交停止请求。已有会话保留原工作目录。

连接使用 QQ 官方 SDK 出站 WebSocket 和微信 iLink HTTPS 长轮询，无需新增公网端口。QQ 凭据、微信登录信息及回复上下文保存在本机数据目录的 `channels.sqlite`，不在发行包内，配置 API 不返回密钥。网关重启会恢复主动连接；平台登录失效时，在这里断开并重新登录。电脑后台需要保持运行。

本版支持私聊文字任务与文本结果；图片文件和审批继续在手机或电脑控制台操作。长任务结果保留在 Codex 会话中，平台拒绝自动回传时可发 `/结果` 获取。官方账号开通、扫码及平台实际发送权限须由自己的账号完成；当前验证为编译和协议模拟检查，尚无真实 QQ/微信账号联调记录。

本机控制台与已认证网关的后台管理共用同一套渠道配置，不在聊天页面重复维护。网关后台沿用设备身份校验。

## 二、扫码绑定手机

1. 首次绑定先让手机与电脑处于同一局域网。在 Web 控制台“接入 → 网关与手机”选择手机能访问的实际网卡地址，避开 VMware、WSL、VPN 等虚拟网卡地址。
2. 在 Android 中打开“连接电脑”→“扫描电脑二维码”。系统相机支持深链路时也可以扫描。
3. 二维码带有电脑地址、一次性配对码和本机证书指纹。配对码过期后点“刷新绑定二维码”，不需要重装。
4. 绑定成功后打开已有会话。桌面状态尚未显示 Codex 已连接时，重新打开 Codex 桌面版。新绑定设备独立于其他设备，不会撤销原有手机。

手机操作详见 [手机使用说明](mobile-usage.md)。

手机连不上局域网时，先检查 Windows 网络是否为“专用”，并允许当前用户的 `runtime\node.exe` 通过专用网络防火墙。网关默认端口为 38457。安装程序不自动修改防火墙；无需把这个端口映射到公网。

## 三、设置授权密码

Web 控制台“接入 → 网关与手机”的公网连接卡片可修改地址和授权密码。密码默认遮挡，点击“显示”查看；输入 6–128 个字符并确认后保存。

- 这是公网入口使用的独立密码，不是 Codex 账号密码，也不是设备绑定 Token。
- 同一局域网首次绑定依靠二维码中的一次性配对码；公网连接还需要手机证书、设备 Token 和授权密码。
- 保存后，公网入口的新请求使用新密码。手机“连接电脑”中的公网密码也需要更新；更改密码不撤销手机证书和设备绑定。
- 输入框为空时不会覆盖密码。安装初始生成的密码保存在本机 `%USERPROFILE%\.codex-mobile-control\public-password.txt`；可以用上述界面改成自己的密码。
- 下方“公网地址”可留空。要使用公网时填写自己的 HTTPS 域名，例如 `https://phone.example.com`。填写地址本身不会自动创建 Cloudflare 隧道或 DNS 记录。

## 四、管理后台

Web 聊天与管理后台使用独立页面：

- 本机管理：`http://127.0.0.1:25819/`，负责账号、额度、模型、中转、执行器、接入、统计及维护。桌面快捷方式直接打开这里，无需启动旧管理 EXE。
- Web 聊天：网关地址下的 `/console`，保留会话、消息、审批、文件和终端。
- 聊天侧栏“后台管理”另开同一网关下的 `/manage/`，沿用当前设备身份；管理页提供“返回聊天”。账号额度、模型账户、手机绑定和渠道设置跳转到同一管理界面。
- “接入 → 网关与手机”统一管理二维码、地址、密码和绑定设备；“接入 → QQ / 微信”管理平台账号。

25819 服务继续只监听回环地址。网关管理 API 通过固定路由转发，保留设备认证，不向浏览器发送本机管理密钥。公网入口仍限制网页和终端访问；本轮未新增公网浏览器登录流程。

### 网关聊天页的浏览器证书

首次安装自动生成这台电脑的自签名 HTTPS 证书。旧版管理 EXE 点击“打开管理后台”时，程序把该证书的公钥指纹传给独立 Chrome 配置，只为匹配这个公钥的证书设置例外，随后用一次性码自动授权。0.6.165 已在本机独立安装目录验证：不带公钥例外时 Chrome 拒绝该自签名证书，带正确公钥例外时正常加载后台、自动授权并显示配对弹窗，地址栏中的一次性码也已清除。0.6.167 沿用该浏览器流程。此方式不向 Windows 或其他浏览器安装受信任根证书。

直接把局域网 HTTPS 地址粘贴到普通浏览器，仍可能看到证书警告。本机日常管理使用 HTTP 回环地址 25819，无需访问网关证书页面。手机扫描二维码后固定网关证书指纹；覆盖安装保留原证书，主动更换证书后需要重新绑定。

## 五、公网连接：自己的域名和隧道

局域网功能不需要 Cloudflare。跨网络连接需要目标电脑自己的 Cloudflare Tunnel、域名和密码。不要把发行包当作现成的共享公网账号。

按 [Cloudflare 本地管理隧道文档](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/) 安装并登录 cloudflared，创建隧道及 DNS 路由，例如：

```powershell
cloudflared tunnel login
cloudflared tunnel create codex-mobile
cloudflared tunnel route dns <自己的-Tunnel-ID> phone.example.com
```

创建后，在目标电脑的 PowerShell 执行安装目录中的配置脚本，使用该隧道自己的凭据 JSON：

```powershell
$program = Join-Path $env:USERPROFILE '.codex\tools\local-console'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$program\installer\Configure-Public.ps1" `
  -Domain 'phone.example.com' `
  -TunnelId '<自己的-Tunnel-ID>' `
  -CredentialsFile "$env:USERPROFILE\.cloudflared\<自己的-Tunnel-ID>.json"
```

默认按目标电脑的正常网络建立 HTTP/2 隧道，不固定代理节点。如必须通过本机 HTTP CONNECT 代理出网，可增加 `-ProxyPort <实际端口>`；不要照抄其他电脑的端口。代理停了也会影响隧道。

配置脚本将凭据复制到本机受保护的数据目录，创建 `cloudflared.yml`，更新公网地址并重新加载守护进程；网关和 Codex 桌面任务保持运行。域名 DNS 和 Cloudflare 账号授权仍需在自己的账号完成。

在 Web 控制台“接入 → 网关与手机”刷新二维码，手机填写同一公网地址与新授权密码。未带密码访问公网 `/health` 返回 401 是正常鉴权结果；带正确密码才返回网关健康结果。公网入口转发允许的手机接口；本机 Web 管理服务的25819端口、Web聊天页和任意终端不直接暴露。

## 六、升级

新版本直接运行新的 Release Setup，指向同一个程序目录。安装程序先检查占用端口和网关任务，仅停止属于该安装的后台服务；仍有网关承载任务或未完成请求时会拒绝更新。共享 Codex 后端独立运行，更新网关不会停止它。

- 旧程序备份到 `%LOCALAPPDATA%\CodexControl\backups`。
- 程序目录更新，数据目录不随发行包替换。已存在的网关配置、密码、证书、配对设备和会话保持原样。
- 手机覆盖安装同签名 APK。换电脑时建议将两台电脑分别绑定，避免复制设备 Token 后混淆来源。
- 本版新加的定时任务执行会话选择需要配套更新 Gateway 与 Android；只升级 APK、仍运行旧网关时，新的目标搜索接口不可用。完整包已配好对应组件，协议版本仍为 1。

覆盖升级时取消勾选“与已安装的 Codex 桌面版共享会话”，会恢复此前的 CLI 配置；用户自行设置的其他路径会保留。原有桌面任务继续运行，设置对新启动的桌面程序生效。

旧程序来自其他路径、不同后台守护或同端口的其他服务时，不强制接管。先按原安装方法停止那个服务，再选一个明确目录安装。本安装器只覆盖识别出的 Local Console/Gateway 目录。

## 七、迁移到新电脑

通常重新登录和扫码即可，无需复制旧电脑所有数据。

| 内容 | 建议迁移方式 |
| --- | --- |
| Codex 账号 | 在新电脑重新登录；不把 auth.json 放进安装包 |
| 项目与 Git 仓库 | 用 Git 或自己的文件备份迁移，并在后台重新授权新路径 |
| Codex 本地历史 | 确有需要时在服务停止后备份自己的 `.codex` 会话与状态库；路径和版本必须另行核对 |
| 网关配置与设备 | 新电脑优先生成证书并重新扫码；复制旧配置时需要同时迁移对应证书、状态库并改正绝对路径 |
| 公网隧道 | 新建或明确迁移自己的隧道连接器；凭据不放入通用发行包 |
| 25819 中转密钥/账号配置 | 在新电脑重新配置；Windows DPAPI 凭据绑定原用户/机器，不能直接拷贝后宣称可用 |
| 自启动与桌面共享 | 由目标电脑安装器重新生成，不复制旧机器任务或 CODEX_CLI_PATH |

没有自动运行会话恢复、线程目录替换、账号迁移、项目删除或清理步骤。按实际需要手动迁移自己的资料，保留原始备份。

## 八、目录、服务和日志

| 路径/端口 | 用途 |
| --- | --- |
| `%USERPROFILE%\.codex\tools\local-console` | Web 管理后台、Gateway、Node、依赖、安装组件、APK和文档 |
| `%USERPROFILE%\.codex-mobile-control` | 网关配置、证书、设备状态、公网配置与本安装日志 |
| `%USERPROFILE%\.codex\codexmate\local-console` | 25819 账号/统计数据与守护日志 |
| `127.0.0.1:25819` | 本机管理工作台 |
| `0.0.0.0:38457` | 局域网 HTTPS 网关 |
| `127.0.0.1:48763` | 配置公网后使用的内部转发入口 |
| `127.0.0.1:20242` | 配置公网后使用的 cloudflared 就绪检查 |
| `%TEMP%\CodexControl-last-install.log` / `CodexControl-last-error.log` | 安装结果及错误 |

数据目录中的 `installer-logs`、`console-logs` 和 `.codex\codexmate\local-console\logs` 用于启动与运行检查。后台守护按现有逻辑约每 10 秒核对服务并恢复；未配置自己的隧道时不启动公网服务。

## 九、诊断、停止与卸载

```powershell
$program = Join-Path $env:USERPROFILE '.codex\tools\local-console'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$program\installer\Check.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$program\installer\Stop-Services.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$program\installer\Start-Services.ps1"
```

| 现象 | 先检查 |
| --- | --- |
| 安装找不到 Codex | 是否已安装并正常打开桌面版；不要复制旧机器 Codex 可执行路径 |
| 端口被占用 | 确认占用者和旧安装目录；安装器不会随意结束其他程序 |
| Web 后台没有二维码 | 检查25819管理服务与38457网关，查看installer-logs；重新启动本安装的后台 |
| 聊天正常、账号或统计不可用 | 检查本机25819管理服务，确认使用配套的Windows整包 |
| 新版会话选择提示接口不存在 | 电脑Gateway仍是旧版本；升级Windows配套包后重新打开任务编辑器 |
| Codex 尚未连接 | 正常退出并重开桌面版，让 CODEX_CLI_PATH 共享设置生效 |
| 手机局域网超时 | 实际网卡地址、专用网络防火墙、VPN/TUN、电脑休眠 |
| 公网 401 | 手机密码、设备绑定与证书；匿名 /health 的 401 本身正常 |
| 公网 502 / 1033 / 超时 | 本机网关、48763 入口、cloudflared 就绪状态和出网代理 |
| Token 累计很大 | 累计消耗与当前上下文分开；压缩不会清零历史消耗 |
| 切会话短暂等待 | 首次无缓存会读取；后续命中有界缓存再后台更新 |

卸载自启动和桌面共享设置：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$program\installer\Uninstall.ps1"
```

卸载脚本默认先核对并停止本安装后台，恢复本安装之前的用户 CLI 覆盖设置，并通知 Windows 更新环境变量。已运行的桌面任务不会被结束；恢复后的设置用于新启动的桌面程序。用户在安装后自行修改的 CLI 路径会保留，不被卸载脚本覆盖。程序、账号、证书和历史不自动删除。确认不再需要后可手动删除程序目录；数据目录单独保留。若公网隧道仍作为其他用途使用，先明确其归属再停止或移除。

## 十、验证范围与高级安装

发行包随附构建日志和组件清单。安装后确认 Web 后台正常、二维码可以刷新，手机能读取已有会话；覆盖升级会保留原密码、证书和绑定。

需要企业分发或测试时，Setup 支持静默安装，参数传入内部安装脚本：

```powershell
$setup = Start-Process '.\Codex-Control-0.6.505-Setup-x64.exe' -ArgumentList '/silent' -WindowStyle Hidden -PassThru
$setup.WaitForExit()
if ($setup.ExitCode -ne 0) { throw "安装失败，退出码 $($setup.ExitCode)" }
```

高级参数：`-InstallDirectory`、`-CodexHome`、`-DataDirectory`、`-GatewayPort`、`-ConsolePort`，以及 `-NoAutostart`、`-NoStart`、`-SkipDesktopBridge`、`-NoShortcuts`。它们主要供隔离验证和明确的既有部署使用；正常桌面直装无需输入参数。安装器使用现代 .NET 路径处理，避免较长临时路径触发旧的 260 字符限制，依据见 [微软长路径支持说明](https://learn.microsoft.com/en-us/dotnet/framework/migration-guide/retargeting/4.6.x#long-path-support)。安装成功或失败后会清理本次临时解包目录；显式 `/extract` 导出的目录保留。文件被占用或权限不足导致无法清理时，原因记录到临时目录下的 `CodexControl-last-cleanup.log`。数据目录必须与程序目录分开。EXE 目前未做商业代码签名，Windows 下载保护可能要求按本地策略确认来源；受管设备遵守组织的软件安装策略。
