. "$PSScriptRoot\Common.ps1"
$installation=Read-Installation
$log=Join-Path $installation.Info.dataDirectory 'installer-logs'
New-Item -ItemType Directory -Force -Path $log | Out-Null
$guard=Join-Path $installation.Root 'installer\guard.mjs'
$existing=@(Get-OwnedProcesses $installation | Where-Object { $_.CommandLine.Contains($guard) })
if(-not $existing){Start-Process -FilePath $installation.Node -ArgumentList ('"'+$guard+'"') -WorkingDirectory $installation.Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $log 'guard.log') -RedirectStandardError (Join-Path $log 'guard.err.log') | Out-Null}
for($i=0;$i -lt 50;$i++){
    & $installation.Node "$PSScriptRoot\instance.mjs" health | Out-Null
    if($LASTEXITCODE -eq 0){Write-Output '后台已启动';exit 0}
    Start-Sleep -Milliseconds 400
}
throw "后台启动超时，请查看 $log"
