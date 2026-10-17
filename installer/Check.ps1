. "$PSScriptRoot\Common.ps1"
$installation=Read-Installation
& $installation.Node "$PSScriptRoot\instance.mjs" health
if($LASTEXITCODE -ne 0){throw '网关健康检查失败'}
try{$r=Invoke-RestMethod -Uri "http://127.0.0.1:$($installation.Info.consolePort)/health" -TimeoutSec 5;[pscustomobject]@{console=$r.application;consolePort=$installation.Info.consolePort;dataDirectory=$installation.Info.dataDirectory}|ConvertTo-Json}catch{throw '25819 管理后台未响应'}
