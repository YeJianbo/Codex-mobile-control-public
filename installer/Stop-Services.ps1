. "$PSScriptRoot\Common.ps1"
$installation=Read-Installation
& $installation.Node "$PSScriptRoot\instance.mjs" update-check
if($LASTEXITCODE -ne 0){throw '活动任务检查失败，未停止后台'}
Get-OwnedProcesses $installation | ForEach-Object { Stop-Process -Id $_.ProcessId }
Write-Output '后台已停止；Codex 桌面进程未关闭'
