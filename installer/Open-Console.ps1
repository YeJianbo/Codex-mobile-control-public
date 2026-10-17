param([switch]$NoOpen)
. "$PSScriptRoot\Common.ps1"
$installation=Read-Installation
$consolePort=if($installation.Info.consolePort){[int]$installation.Info.consolePort}else{25819}
$consoleUrl="http://127.0.0.1:$consolePort/"
function Test-ConsoleReady {
    try { $response=Invoke-RestMethod -Uri ($consoleUrl+'health') -TimeoutSec 3; return $response.ok -and $response.application -eq 'local-console' }
    catch { return $false }
}
if(-not (Test-ConsoleReady)) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\Start-Services.ps1"
    if($LASTEXITCODE -ne 0){throw '后台启动失败，请检查安装目录下的日志'}
    if(-not (Test-ConsoleReady)){throw '控制台尚未启动，请稍后重试'}
}
if($NoOpen){Write-Output $consoleUrl;exit 0}
$chrome=@(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
if(-not $chrome){throw "请使用浏览器打开 $consoleUrl"}
Start-Process -FilePath $chrome -ArgumentList $consoleUrl
