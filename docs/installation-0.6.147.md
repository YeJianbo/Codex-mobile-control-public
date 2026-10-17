# Codex Control Release 安装与使用说明

适用版本：桌面管理程序 / Android 0.6.147，Gateway 0.6.60，Local Console 0.12.0，包内 Node 24.14.0。适用系统：Windows 10 / 11 x64；手机 Android 8.0 及以上。

## 一、第一次安装

1. 在目标电脑安装 Codex 桌面版，完成账号登录，并打开过一次项目。安装程序会寻找完整的 Windows Codex 执行组件；没有找到时会说明原因，不复制其他人的账号。OpenAI 当前安装和登录说明见 [Windows 桌面版](https://learn.chatgpt.com/docs/windows/windows-app) 与 [登录方式](https://learn.chatgpt.com/docs/auth)。
2. 双击 `Codex-Control-0.6.147-Setup-x64.exe`，选择安装目录，点击“安装”。默认目录是 `%USERPROFILE%\.codex\tools\local-console`；不需要先安装 Node、npm、Python或编译网关。
3. 默认勾选登录 Windows 后后台启动、与 Codex 桌面版共享会话。安装不会替换 Codex 本体，不关闭桌面任务。安装完成后正常退出并重新打开 Codex，让新的共享设置生效。
4. 桌面会出现 `Codex Control` 快捷方式。安装结束自动打开独立管理窗口，直接显示绑定二维码、配对码、电脑地址和授权密码设置。关闭这个窗口不停止后台。
5. 将包中的 `Codex-Control-0.6.147.apk` 安装到手机。已有同签名版本可覆盖安装，手机原有数据保留。

Release EXE、APK 和文档在同一个发行 ZIP 中。首次安装生成本机 HTTPS 证书、随机网关 Token 和独立公网密码；分发包没有账号、会话、项目内容、手机设备授权或 Cloudflare 凭据。

## 二、扫码绑定手机

1. 首次绑定先让手机与电脑处于同一局域网。在桌面管理窗口下方选择手机能访问的实际网卡地址，避开 VMware、WSL、VPN 等虚拟网卡地址。
2. 在 Android 中打开“连接电脑”→“扫描电脑二维码”。系统相机支持深链路时也可以扫描。
3. 二维码带有电脑地址、一次性配对码和本机证书指纹。配对码过期后点“刷新绑定二维码”，不需要重装。
4. 绑定成功后打开已有会话。桌面状态尚未显示 Codex 已连接时，重新打开 Codex 桌面版。新绑定设备独立于其他设备，不会撤销原有手机。

手机连不上局域网时，先检查 Windows 网络是否为“专用”，并允许当前用户的 `runtime\node.exe` 通过专用网络防火墙。网关默认端口为 38457。安装程序不自动修改防火墙；无需把这个端口映射到公网。

## 三、设置授权密码

管理窗口中有“授权密码”输入框，默认遮挡，可勾选“显示”。输入 8–128 个字符后点击“保存密码”。

- 这是公网入口使用的独立密码，不是 Codex 账号密码，也不是设备绑定 Token。
- 同一局域网首次绑定依靠二维码中的一次性配对码；公网连接还需要手机证书、设备 Token 和授权密码。
- 保存后，公网入口的新请求使用新密码。手机“连接电脑”中的公网密码也需要更新；更改密码不撤销手机证书和设备绑定。
- 输入框为空时不会覆盖密码。安装初始生成的密码保存在本机 `%USERPROFILE%\.codex-mobile-control\public-password.txt`；可以用上述界面改成自己的密码。
- 下方“公网地址”可留空。要使用公网时填写自己的 HTTPS 域名，例如 `https://phone.example.com`。填写地址本身不会自动创建 Cloudflare 隧道或 DNS 记录。

## 四、管理后台

独立管理窗口负责显示服务状态、绑定二维码和设置密码；详细管理后台仍保留。

- 点击“打开管理后台”，程序会生成一次性本机授权码，并在 Google Chrome 打开后台及手机配对页；不需要手动找 Token。
- 后台页面接收授权后立即清除地址栏中的一次性码。浏览器使用此安装自己的配置目录，证书例外只针对本机网关公钥，不关闭所有 HTTPS 校验，也不向系统导入根证书。
- 未安装 Chrome 时，原生窗口的二维码和密码设置仍可用；需要打开完整网页后台时再安装 Chrome。
- 完整后台包含项目授权、会话、模型、文件、设备、审批和其他管理能力。25819 控制台负责账号、目录、路由、统计及维护；它只监听回环地址，不直接暴露到互联网。

### 浏览器证书如何处理

首次安装自动生成这台电脑的自签名 HTTPS 证书。点击“打开管理后台”时，程序把该证书的公钥指纹传给独立 Chrome 配置，只为匹配这个公钥的证书设置例外，随后用一次性码自动授权。已验证可以直接进入扫码页；这不等于向 Windows 或其他浏览器安装受信任根证书。

直接把局域网 HTTPS 地址粘贴到普通浏览器，仍可能看到证书警告。日常使用原生管理窗口或上述按钮即可。手机扫描二维码后固定网关证书指纹；覆盖安装保留原证书，主动更换证书后需要重新绑定。公网域名的浏览器连接由 Cloudflare 的正常 HTTPS 证书保护，使用者无需导入本机自签名证书。

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

在原生管理界面刷新二维码，手机填写同一公网地址与新授权密码。未带密码访问公网 `/health` 返回 401 是正常鉴权结果；带正确密码才返回网关健康结果。公网入口只转发已有允许的手机接口，不开放 Web 控制台、任意终端和通用代理。公网执行沿用 Codex / Antigravity 范围；Claude / Grok 的本地可用不代表已开放公网执行。

## 六、升级

新版本直接运行新的 Release Setup，指向同一个程序目录。安装程序先检查占用端口和网关任务，仅停止属于该安装的后台服务；仍有网关承载任务或未完成请求时会拒绝更新。共享桌面的 Codex 任务由桌面进程保留。

- 旧程序备份到 `%LOCALAPPDATA%\CodexControl\backups`。
- 程序目录更新，数据目录不随发行包替换。已存在的网关配置、密码、证书、配对设备和会话保持原样。
- 手机覆盖安装同签名 APK。换电脑时建议将两台电脑分别绑定，避免复制设备 Token 后混淆来源。
- 本版安装包 Gateway 为 0.6.60；手机覆盖安装 0.6.147，以同时取得实时正文保存、历史同步和滚动修复。协议版本仍为 1。

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
| `%USERPROFILE%\.codex\tools\local-console` | 已安装程序、Node、依赖、管理 EXE、APK和文档 |
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
| 管理窗口没有二维码 | 查看网关健康和 installer-logs；重新启动本安装的后台 |
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

卸载脚本默认先核对并停止本安装后台，恢复本安装之前的用户 CLI 覆盖设置，不自动删除程序、账号、证书或历史。确认不再需要后可手动删除程序目录；数据目录单独保留。若公网隧道仍作为其他用途使用，先明确其归属再停止或移除。

## 十、验证范围与高级安装

发行包随附安装验证记录，记录 EXE 解包、离线依赖、隔离首次安装、HTTPS、QR 解码、一次性浏览器授权、密码修改和再次安装的数据保留结果。使用隔离 HOME 和端口，不把这台电脑现有配置复制进测试。

需要企业分发或测试时，Setup 支持静默安装，参数传入内部安装脚本：

```powershell
Start-Process '.\Codex-Control-0.6.147-Setup-x64.exe' -Wait -ArgumentList '/silent'
```

高级参数：`-InstallDirectory`、`-CodexHome`、`-DataDirectory`、`-GatewayPort`、`-ConsolePort`，以及 `-NoAutostart`、`-NoStart`、`-SkipDesktopBridge`、`-NoShortcuts`。它们主要供隔离验证和明确的既有部署使用；正常桌面直装无需输入参数。数据目录必须与程序目录分开。EXE 目前未做商业代码签名，Windows 下载保护可能要求按本地策略确认来源；受管设备遵守组织的软件安装策略。
