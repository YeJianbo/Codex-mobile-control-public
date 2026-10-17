param([Parameter(Mandatory=$true)][string]$Domain,[Parameter(Mandatory=$true)][Guid]$TunnelId,[Parameter(Mandatory=$true)][string]$CredentialsFile,[string]$CloudflaredPath,[int]$ProxyPort=0)
. "$PSScriptRoot\Common.ps1"
$installation=Read-Installation;$home=$installation.Info.dataDirectory
if($Domain -notmatch '^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$'){throw '请输入不带 https:// 和路径的域名'}
if(-not $CloudflaredPath){$found=Get-Command cloudflared.exe -ErrorAction SilentlyContinue;if($found){$CloudflaredPath=$found.Source}else{$CloudflaredPath=Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'}}
if(-not (Test-Path -LiteralPath $CloudflaredPath)){throw '请先安装 cloudflared'}
$credentials=Get-Content -LiteralPath $CredentialsFile -Raw|ConvertFrom-Json
if($credentials.TunnelID -ne $TunnelId.ToString() -or -not $credentials.TunnelSecret){throw '凭据与 Tunnel ID 不匹配'}
$target=Join-Path $home 'tunnel-credentials.json';Copy-Item -LiteralPath $CredentialsFile -Destination $target -Force
$configFile=Join-Path $home 'public-access.json';$config=Get-Content -LiteralPath $configFile -Raw|ConvertFrom-Json
$config.publicUrl='https://'+$Domain
if($ProxyPort -gt 0){if($ProxyPort -lt 1024 -or $ProxyPort -gt 65535){throw '代理端口无效'};$config.tunnelRelay=@{enabled=$true;proxyPort=$ProxyPort;ports=@(18985,18986)}}else{$config.tunnelRelay=@{enabled=$false}}
[IO.File]::WriteAllText($configFile,($config|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$credentialPath=$target.Replace('\','/').Replace("'","''")
$yaml="tunnel: $TunnelId`ncredentials-file: '$credentialPath'`ningress:`n  - hostname: $Domain`n    service: http://127.0.0.1:$($config.port)`n  - service: http_status:404`n"
[IO.File]::WriteAllText((Join-Path $home 'cloudflared.yml'),$yaml,[Text.UTF8Encoding]::new($false))
$installation.Info|Add-Member -NotePropertyName cloudflaredPath -NotePropertyValue ([IO.Path]::GetFullPath($CloudflaredPath)) -Force
[IO.File]::WriteAllText((Join-Path $installation.Root 'installation.json'),($installation.Info|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$guard=Join-Path $installation.Root 'installer\guard.mjs'
Get-OwnedProcesses $installation|Where-Object{$_.CommandLine.Contains($guard)}|ForEach-Object{Stop-Process -Id $_.ProcessId}
& "$PSScriptRoot\Start-Services.ps1"
Write-Output '公网配置已保存。请完成 Cloudflare DNS 路由，再在管理界面刷新二维码并填写授权密码。'
