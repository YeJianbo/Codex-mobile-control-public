param([string]$BridgeDirectory = (Join-Path $env:USERPROFILE '.codex-mobile-control\desktop-bridge'))
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$package = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw '未找到桌面 Codex 安装。' }
$executable = @('ChatGPT.exe','Codex.exe') | ForEach-Object { Join-Path $package.InstallLocation "app\$_" } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $executable) { throw '未找到桌面 Codex 启动程序。' }
$running = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $executable } | Select-Object -First 1
if ($running) { throw '桌面 Codex 已运行，但共享连接未就绪。请先完全退出桌面 Codex，再启动共享连接；仅关闭窗口可能仍留在托盘。' }
$shim = [Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User')
if (-not $shim -or -not (Test-Path -LiteralPath $shim) -or (Split-Path $shim -Parent) -ne $BridgeDirectory) {
    $shim = Join-Path $BridgeDirectory 'codex-bridge.exe'
}
if (-not (Test-Path -LiteralPath $shim)) { throw '共享启动组件缺失，请修复电脑控制台安装。' }
# App activation through Explorer can reuse an old environment. Pass the bridge explicitly.
$env:CODEX_CLI_PATH = $shim
Start-Process -FilePath $executable -WindowStyle Hidden
