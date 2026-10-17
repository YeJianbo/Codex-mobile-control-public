param([string[]]$Modules = @(), [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$source = Join-Path $PSScriptRoot 'server'
$installed = Join-Path $env:USERPROFILE '.codex\tools\local-console\gateway'
foreach ($module in $Modules) {
    if ($module -notmatch '^[A-Za-z][A-Za-z0-9_-]*$' -or -not (Test-Path -LiteralPath "$source\dist\services\$module.js")) { throw "无效或尚未构建的网关模块：$module" }
}
if (-not (Test-Path -LiteralPath "$installed\dist\index.js")) { throw '未找到电脑控制台安装目录。' }
$config = Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.codex-mobile-control\server.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$probe = Join-Path $source 'scripts\local-gateway-check.mjs'
$publicRoutesChanged = $Modules.Count -eq 0 -and [Convert]::ToBase64String([IO.File]::ReadAllBytes("$source\scripts\public-routes.mjs")) -cne [Convert]::ToBase64String([IO.File]::ReadAllBytes("$installed\scripts\public-routes.mjs"))
$status = & node.exe $probe state | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw '网关状态读取失败，未更新。' }
$threads = $status.threads
$runtime = $status.runtime
# Shared desktop Codex owns its process and turns; reconnecting the gateway does
# not stop them. Managed CLI turns and other harnesses depend on this gateway.
$blockingThreads = @($threads | Where-Object {
    $_.status -eq 'running' -and ($runtime.transport -ne 'desktop' -or $_.id -match '^(claude|antigravity|grok|deepseek|hermes)-')
})
if ($blockingThreads.Count -gt 0) { throw ('网关承载的任务仍在执行：' + (($blockingThreads | ForEach-Object title) -join '、')) }
if ($runtime.pendingRequests -gt 0) { throw '网关有尚未完成的请求，请稍后再更新。' }
$listener = Get-NetTCPConnection -LocalPort $config.port -State Listen | Select-Object -First 1
$target = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
if ($target.CommandLine -notlike "*$installed\dist\index.js*") { throw '端口上的服务不是此安装目录，未做修改。' }
Push-Location $source
try { if (-not $SkipBuild) { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw '构建失败，未更新。' } } } finally { Pop-Location }
$latest = & node.exe $probe state | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $latest.runtime.pendingRequests -gt 0 -or @($latest.threads | Where-Object { $_.status -eq 'running' -and ($latest.runtime.transport -ne 'desktop' -or $_.id -match '^(claude|antigravity|grok|deepseek|hermes)-') }).Count -gt 0) { throw '更新前出现活动请求或网关任务，未替换程序。' }
$releaseVersion=(Get-Content -LiteralPath "$source\package.json" -Raw | ConvertFrom-Json).version
if ($Modules.Count -gt 0) {
    $backup = Join-Path $PSScriptRoot ('artifacts\installed-gateway-modules-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
    $previousModules = @($Modules | ForEach-Object { "$installed\dist\services\$_.js" } | Where-Object { Test-Path -LiteralPath $_ })
    if ($previousModules.Count -gt 0) { Compress-Archive -LiteralPath $previousModules -DestinationPath $backup }
    foreach ($module in $Modules) { Copy-Item -LiteralPath "$source\dist\services\$module.js" -Destination "$installed\dist\services\$module.js" -Force }
} else {
$backup = Join-Path $PSScriptRoot "artifacts\installed-gateway-before-$releaseVersion.zip"
if (-not (Test-Path -LiteralPath $backup)) { Compress-Archive -Path "$installed\dist","$installed\public","$installed\scripts","$installed\package.json","$installed\package-lock.json" -DestinationPath $backup }
$dependencyCode = @'
const fs=require('node:fs');const lock=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log(JSON.stringify(Object.entries(lock.packages).filter(([name,p])=>name.startsWith('node_modules/')&&!p.dev&&!p.link).map(([name,p])=>({name,version:p.version,optional:!!p.optional}))));
'@
$dependencyJson = $dependencyCode | & node.exe - "$source\package-lock.json"
if ($LASTEXITCODE -ne 0) { throw '读取运行依赖失败，未替换程序。' }
foreach ($entry in ($dependencyJson | ConvertFrom-Json)) {
    $original = Join-Path $source $entry.name
    $destination = Join-Path $installed $entry.name
    if (-not (Test-Path -LiteralPath "$original\package.json")) { if ($entry.optional) { continue }; throw "缺少运行依赖：$($entry.name)" }
    if (Test-Path -LiteralPath "$destination\package.json") {
        $existing = Get-Content -LiteralPath "$destination\package.json" -Raw | ConvertFrom-Json
        if ($existing.version -eq $entry.version) { continue }
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -Path "$original\*" -Destination $destination -Recurse -Force
}
Copy-Item -Path "$source\dist\*" -Destination "$installed\dist" -Recurse -Force
Copy-Item -Path "$source\public\*" -Destination "$installed\public" -Recurse -Force
Copy-Item -LiteralPath "$source\package.json","$source\package-lock.json" -Destination $installed -Force
New-Item -ItemType Directory -Path "$installed\scripts" -Force | Out-Null
Copy-Item -LiteralPath "$source\scripts\public-entry.mjs","$source\scripts\public-routes.mjs" -Destination "$installed\scripts" -Force
Copy-Item -LiteralPath "$source\scripts\background-service.vbs" -Destination "$installed\scripts" -Force
Copy-Item -LiteralPath "$source\scripts\start-shared-desktop.ps1" -Destination "$installed\scripts" -Force
Copy-Item -LiteralPath "$source\scripts\deepseek-mobile-policy.mjs" -Destination "$installed\scripts" -Force
Copy-Item -LiteralPath "$source\scripts\hermes-mobile-acp" -Destination "$installed\scripts" -Recurse -Force
$instance = Join-Path (Split-Path $installed -Parent) 'installer\instance.mjs'
if (Test-Path -LiteralPath $instance) {
    $instanceBackup = Join-Path $PSScriptRoot "artifacts\installed-instance-before-$releaseVersion.mjs"
    if (-not (Test-Path -LiteralPath $instanceBackup)) { Copy-Item -LiteralPath $instance -Destination $instanceBackup }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'installer\instance.mjs') -Destination $instance -Force
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Install-DesktopBridge.ps1')
if ($LASTEXITCODE -ne 0) { throw '默认共享组件安装失败，未重启网关。' }
}
Stop-Process -Id $listener.OwningProcess
$node = (Get-Command node.exe).Source
Start-Process -FilePath $node -ArgumentList "$installed\dist\index.js" -WorkingDirectory $installed -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'artifacts\installed-gateway.log') -RedirectStandardError (Join-Path $PSScriptRoot 'artifacts\installed-gateway.err.log')
for ($i=0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = & node.exe $probe health | ConvertFrom-Json
        if ($LASTEXITCODE -eq 0 -and $health.ok) {
            if ($publicRoutesChanged) {
                $publicConfigFile=Join-Path $env:USERPROFILE '.codex-mobile-control\public-access.json'
                if(Test-Path -LiteralPath $publicConfigFile){
                    $publicConfig=Get-Content -LiteralPath $publicConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
                    $entryListener=Get-NetTCPConnection -LocalPort $publicConfig.port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
                    if($entryListener){
                        $entryProcess=Get-CimInstance Win32_Process -Filter "ProcessId = $($entryListener.OwningProcess)"
                        if($entryProcess.CommandLine -notlike "*$installed\scripts\public-entry.mjs*"){throw '公网入口端口由其他程序使用，未重启。'}
                        Stop-Process -Id $entryListener.OwningProcess
                    }
                    'const {PublicServices}=await import(process.argv[2]); await new PublicServices({root:process.argv[3]}).ensureEntry();' | & node.exe --input-type=module - ([System.Uri]::new("$installed\scripts\public-services.mjs").AbsoluteUri) $installed
                    if($LASTEXITCODE -ne 0){throw '现有公网入口恢复失败。'}
                }
                $publicRoutesChanged=$false
            }
            $desktop = $null
            try { $desktop = & node.exe $probe start | ConvertFrom-Json } catch { }
            if ($LASTEXITCODE -eq 0 -and $desktop.codex.running) { Write-Host '更新完成，共享后端已连接；请刷新手机。' }
            else { Write-Host '网关更新完成；共享后端尚未就绪，请查看 shared-backend.log。' }
            exit 0
        }
    } catch { }
}
throw '更新后启动超时，请查看 artifacts\installed-gateway.err.log。'
