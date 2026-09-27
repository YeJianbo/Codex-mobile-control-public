$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'server'
$installed = Join-Path $env:USERPROFILE '.codex\tools\local-console\gateway'
if (-not (Test-Path -LiteralPath "$installed\dist\index.js")) { throw '未找到电脑控制台安装目录。' }
$config = Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.codex-mobile-control\server.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$probe = Join-Path $source 'scripts\local-gateway-check.mjs'
$status = & node.exe $probe state | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw '网关状态读取失败，未更新。' }
$threads = $status.threads
$runtime = $status.runtime
# Shared desktop Codex owns its process and turns; reconnecting the gateway does
# not stop them. Managed CLI turns and other harnesses depend on this gateway.
$blockingThreads = @($threads | Where-Object {
    $_.status -eq 'running' -and ($runtime.transport -ne 'desktop' -or $_.id -match '^(claude|antigravity|grok)-')
})
if ($blockingThreads.Count -gt 0) { throw ('网关承载的任务仍在执行：' + (($blockingThreads | ForEach-Object title) -join '、')) }
if ($runtime.pendingRequests -gt 0) { throw '网关有尚未完成的请求，请稍后再更新。' }
$listener = Get-NetTCPConnection -LocalPort $config.port -State Listen | Select-Object -First 1
$target = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
if ($target.CommandLine -notlike "*$installed\dist\index.js*") { throw '端口上的服务不是此安装目录，未做修改。' }
Push-Location $source
try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw '构建失败，未更新。' } } finally { Pop-Location }
$backup = Join-Path $PSScriptRoot 'artifacts\installed-gateway-before-0.4.0.zip'
if (-not (Test-Path -LiteralPath $backup)) { Compress-Archive -Path "$installed\dist","$installed\public" -DestinationPath $backup }
Copy-Item -Path "$source\dist\*" -Destination "$installed\dist" -Recurse -Force
Copy-Item -Path "$source\public\*" -Destination "$installed\public" -Recurse -Force
New-Item -ItemType Directory -Path "$installed\scripts" -Force | Out-Null
Copy-Item -LiteralPath "$source\scripts\public-entry.mjs","$source\scripts\public-routes.mjs" -Destination "$installed\scripts" -Force
Copy-Item -LiteralPath "$source\scripts\background-service.vbs" -Destination "$installed\scripts" -Force
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Install-DesktopBridge.ps1')
if ($LASTEXITCODE -ne 0) { throw '默认共享组件安装失败，未重启网关。' }
Stop-Process -Id $listener.OwningProcess
$node = (Get-Command node.exe).Source
Start-Process -FilePath $node -ArgumentList "$installed\dist\index.js" -WorkingDirectory $installed -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'artifacts\installed-gateway.log') -RedirectStandardError (Join-Path $PSScriptRoot 'artifacts\installed-gateway.err.log')
for ($i=0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = & node.exe $probe health | ConvertFrom-Json
        if ($LASTEXITCODE -eq 0 -and $health.ok) {
            $desktop = $null
            try { $desktop = & node.exe $probe start | ConvertFrom-Json } catch { }
            if ($LASTEXITCODE -eq 0 -and $desktop.codex.running) { Write-Host '更新完成，桌面共享连接已恢复；请刷新手机网页。' }
            else { Write-Host '网关更新完成；桌面 Codex 未连接，打开桌面软件后再连接手机。' }
            exit 0
        }
    } catch { }
}
throw '更新后启动超时，请查看 artifacts\installed-gateway.err.log。'
