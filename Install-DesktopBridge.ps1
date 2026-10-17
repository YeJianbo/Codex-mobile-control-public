param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:USERPROFILE '.codex-mobile-control\desktop-bridge'
$gateway = Join-Path $env:USERPROFILE '.codex\tools\local-console\gateway'
$resolvedCli = & node.exe "$PSScriptRoot\server\scripts\desktop-cli-resolver.mjs"
if ($LASTEXITCODE -ne 0) { throw '无法找到完整的 Codex 桌面执行组件。' }
$realCli = Get-Item -LiteralPath $resolvedCli
if (-not $realCli -or -not (Test-Path "$gateway\node_modules\ws")) { throw '未找到 Codex CLI 或已安装网关。' }
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
& icacls.exe $directory /inheritance:r /grant:r "*$($sid.Value):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw '无法保护共享连接凭据目录。' }
Copy-Item -LiteralPath "$PSScriptRoot\server\scripts\desktop-bridge.mjs" -Destination $directory -Force
Copy-Item -LiteralPath "$PSScriptRoot\server\scripts\desktop-cli-resolver.mjs" -Destination $directory -Force
Copy-Item -LiteralPath "$PSScriptRoot\server\scripts\shared-backend.mjs" -Destination $directory -Force
$shim = Join-Path $directory 'codex-bridge.exe'
$shimSource = "$PSScriptRoot\server\scripts\DesktopCliShim.cs"
$installedSource = Join-Path $directory 'DesktopCliShim.cs'
if (-not (Test-Path $shim) -or -not (Test-Path $installedSource) -or [IO.File]::ReadAllText($shimSource) -ne [IO.File]::ReadAllText($installedSource)) {
    & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /r:System.Web.Extensions.dll "/out:$shim" $shimSource
    if ($LASTEXITCODE -ne 0) { throw '共享组件编译失败。' }
    Copy-Item -LiteralPath $shimSource -Destination $installedSource -Force
}
$settings = @{ realCli=$realCli.FullName; node=(Get-Command node.exe).Source; bridgeScript=(Join-Path $directory 'desktop-bridge.mjs'); gatewayRoot=$gateway }
[IO.File]::WriteAllText((Join-Path $directory 'config.json'),($settings | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $directory 'enabled.json'),'{}',[Text.UTF8Encoding]::new($false))
if ($PrepareOnly) { Write-Host '共享组件已准备好。'; exit 0 }
$backup = Join-Path $directory 'previous-cli-override.json'
if (-not (Test-Path -LiteralPath $backup)) {
    [IO.File]::WriteAllText($backup,(@{value=[Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User')} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
}
[Environment]::SetEnvironmentVariable('CODEX_CLI_PATH',$shim,'User')
# Notify Explorer so ordinary Start menu and shortcut launches inherit the setting.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CodexEnvironmentBroadcast {
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
$result = [UIntPtr]::Zero
[void][CodexEnvironmentBroadcast]::SendMessageTimeout([IntPtr]0xffff,0x001A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$result)
if ([Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User') -ne $shim) { throw '默认共享连接设置未保存。' }
Write-Host '共享后台已配置；当前已运行的桌面 Codex 重开后接入同一后端。'
