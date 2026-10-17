param([switch]$KeepServices)
. "$PSScriptRoot\Common.ps1"
$installation=Read-Installation
if(-not $KeepServices){& "$PSScriptRoot\Stop-Services.ps1";if($LASTEXITCODE -ne 0){throw '后台尚未安全停止，未移除启动项'}}
$run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$old=(Get-ItemProperty -LiteralPath $run -ErrorAction SilentlyContinue).LocalCodexConsole
if($old -and $old.Contains($installation.Root+'\')){Remove-ItemProperty -LiteralPath $run -Name LocalCodexConsole}
$shim=if($installation.Info.desktopBridgeShim){$installation.Info.desktopBridgeShim}else{Join-Path $installation.Info.dataDirectory 'desktop-bridge\codex-bridge.exe'}
if([Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User') -eq $shim){$file=Join-Path $installation.Info.dataDirectory 'desktop-bridge\previous-cli-override.json';$previous=if(Test-Path -LiteralPath $file){(Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json).value}else{$null};Set-CodexCliOverride $previous}
Write-Output '已移除本安装的自启动与共享设置。会话、凭据和程序文件保留；确认不再使用后可手动删除程序目录。'
