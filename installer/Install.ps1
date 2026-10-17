param(
 [string]$InstallDirectory=(Join-Path $env:USERPROFILE '.codex\tools\local-console'),
 [string]$CodexHome=(Join-Path $env:USERPROFILE '.codex'),
 [string]$DataDirectory=(Join-Path $env:USERPROFILE '.codex-mobile-control'),
 [int]$GatewayPort=38457,[int]$ConsolePort=25819,
 [switch]$NoAutostart,[switch]$NoStart,[switch]$SkipDesktopBridge,[switch]$NoShortcuts
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
. "$PSScriptRoot\Common.ps1"
function Get-RuntimeDigest([string]$path){$stream=[IO.File]::OpenRead($path);$hash=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($hash.ComputeHash($stream))}finally{$stream.Dispose();$hash.Dispose()}}
$source=Split-Path $PSScriptRoot -Parent
$node=Join-Path $source 'runtime\node.exe'
$InstallDirectory=[IO.Path]::GetFullPath($InstallDirectory)
$CodexHome=[IO.Path]::GetFullPath($CodexHome)
$DataDirectory=[IO.Path]::GetFullPath($DataDirectory)
if(-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){throw '此安装包用于 Windows x64'}
if($InstallDirectory -eq [IO.Path]::GetPathRoot($InstallDirectory) -or $InstallDirectory -eq $CodexHome -or $DataDirectory.StartsWith($InstallDirectory+'\',[StringComparison]::OrdinalIgnoreCase)){throw '程序目录与数据目录需要分开'}
if($GatewayPort -lt 1024 -or $GatewayPort -gt 65535 -or $ConsolePort -lt 1024 -or $ConsolePort -gt 65535 -or $GatewayPort -eq $ConsolePort){throw '端口无效'}
& $node --version
if($LASTEXITCODE -ne 0){throw '包内 Node 运行时无法启动'}
$realCli=$null
if(-not $SkipDesktopBridge){
 $realCli=& $node "$source\gateway\scripts\desktop-cli-resolver.mjs"
 if($LASTEXITCODE -ne 0){throw '请先安装并登录 Codex 桌面版，再运行本安装程序'}
}
$existing=Test-Path -LiteralPath (Join-Path $InstallDirectory 'gateway\dist\index.js')
if((Test-Path -LiteralPath $InstallDirectory) -and -not $existing -and @(Get-ChildItem -LiteralPath $InstallDirectory -Force).Count -gt 0){throw '所选程序目录不是本产品安装目录，请选择空目录'}
$previousInfo=if(Test-Path -LiteralPath (Join-Path $InstallDirectory 'installation.json')){Get-Content -LiteralPath (Join-Path $InstallDirectory 'installation.json') -Raw -Encoding UTF8|ConvertFrom-Json}else{$null}
$overrideBeforeInstall=[Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User')
$previousShim=if($previousInfo.desktopBridgeShim){$previousInfo.desktopBridgeShim}elseif($previousInfo.dataDirectory){Join-Path $previousInfo.dataDirectory 'desktop-bridge\codex-bridge.exe'}else{Join-Path $DataDirectory 'desktop-bridge\codex-bridge.exe'}
$ownedOverride=$overrideBeforeInstall -eq $previousShim
foreach($port in @($GatewayPort,$ConsolePort)){
 $listeners=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
 foreach($listener in $listeners){$process=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)";if(-not $existing -or -not $process.CommandLine.Contains($InstallDirectory+'\')){throw "端口 $port 被其他程序占用，未修改它"}}
}
if($existing){
 $env:CODEX_HOME=$CodexHome;$env:CODEX_MOBILE_CONTROL_HOME=$DataDirectory
 $check=Join-Path $source 'gateway\scripts\local-gateway-check.mjs'
 # A stopped gateway is a valid upgrade state. Capture native stderr directly
 # because Windows PowerShell treats redirected stderr as an error under Stop.
 $probeInfo=New-Object Diagnostics.ProcessStartInfo
 $probeInfo.FileName=$node;$probeInfo.Arguments='"'+$check+'" state'
 $probeInfo.UseShellExecute=$false;$probeInfo.CreateNoWindow=$true
 $probeInfo.RedirectStandardOutput=$true;$probeInfo.RedirectStandardError=$true
 $probe=[Diagnostics.Process]::Start($probeInfo)
 try{$output=$probe.StandardOutput.ReadToEndAsync();$errors=$probe.StandardError.ReadToEndAsync();if(-not $probe.WaitForExit(15000)){$probe.Kill();throw '已有网关状态检查超时，未更新'};$status=$output.GetAwaiter().GetResult();$probeExit=$probe.ExitCode;$null=$errors.GetAwaiter().GetResult()}finally{$probe.Dispose()}
 if($probeExit -eq 0){$s=$status|ConvertFrom-Json;if($s.runtime.pendingRequests -gt 0 -or @($s.threads|Where-Object {$_.status -eq 'running' -and ($s.runtime.transport -ne 'desktop' -or $_.id -match '^(claude|antigravity|grok|deepseek|hermes)-')}).Count){throw '网关仍有活动任务或请求，请稍后再安装'}}
 elseif(Get-NetTCPConnection -LocalPort $GatewayPort -State Listen -ErrorAction SilentlyContinue){throw '已有网关状态无法验证，未更新'}
 # Disable the owned legacy task before stopping its child; otherwise its
 # periodic trigger can restart the old supervisor while files are copied.
 $legacyTask=Get-ScheduledTask -TaskName LocalCodexConsoleGuard -ErrorAction SilentlyContinue
 if($legacyTask -and @($legacyTask.Actions|Where-Object{$_.Arguments -and $_.Arguments.Contains($InstallDirectory+'\')}).Count){Disable-ScheduledTask -TaskName LocalCodexConsoleGuard|Out-Null;Stop-ScheduledTask -TaskName LocalCodexConsoleGuard}
 $paths=@('installer\guard.mjs','src\supervisor.mjs','src\server.mjs','gateway\dist\index.js','gateway\scripts\public-entry.mjs')|ForEach-Object{Join-Path $InstallDirectory $_}
 Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object {$line=$_.CommandLine;@($paths|Where-Object{$line -and $line.Contains($_)}).Count -gt 0} | ForEach-Object{Stop-Process -Id $_.ProcessId}
 $manager=Join-Path $InstallDirectory 'CodexControl.exe'
 Get-CimInstance Win32_Process -Filter "name='CodexControl.exe'" | Where-Object {$_.ExecutablePath -eq $manager} | ForEach-Object{Stop-Process -Id $_.ProcessId}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $backupDir=Join-Path $env:LOCALAPPDATA 'CodexControl\backups';New-Item -ItemType Directory -Force -Path $backupDir|Out-Null
 $backup=Join-Path $backupDir ((Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)+'.zip')
 [IO.Compression.ZipFile]::CreateFromDirectory($InstallDirectory,$backup)
 Write-Output "旧程序备份：$backup"
}
New-Item -ItemType Directory -Force -Path $InstallDirectory,$DataDirectory,$CodexHome | Out-Null
Get-ChildItem -LiteralPath $source -Force | ForEach-Object{
 if($_.Name -eq 'runtime'){
  $runtime=Join-Path $InstallDirectory 'runtime';New-Item -ItemType Directory -Force -Path $runtime|Out-Null
  Get-ChildItem -LiteralPath $_.FullName -Force | ForEach-Object{
   $target=Join-Path $runtime $_.Name
   # A running desktop bridge can hold this same Node executable open. Keep
   # an identical runtime rather than attempting to overwrite the locked EXE.
   if($_.Name -ne 'node.exe' -or -not (Test-Path -LiteralPath $target) -or (Get-RuntimeDigest $_.FullName) -ne (Get-RuntimeDigest $target)){Copy-Item -LiteralPath $_.FullName -Destination $runtime -Recurse -Force}
  }
 }else{Copy-Item -LiteralPath $_.FullName -Destination $InstallDirectory -Recurse -Force}
}
$release=Get-Content (Join-Path $source 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest=@{version=$release.version;gatewayVersion=$release.gatewayVersion;consoleVersion=$release.consoleVersion;nodeVersion=$release.nodeVersion;codexHome=$CodexHome;dataDirectory=$DataDirectory;gatewayPort=$GatewayPort;consolePort=$ConsolePort;installedAt=(Get-Date).ToUniversalTime().ToString('o')}
[IO.File]::WriteAllText((Join-Path $InstallDirectory 'installation.json'),($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $DataDirectory /inheritance:r /grant:r "*${sid}:(OI)(CI)F" | Out-Null
if($LASTEXITCODE -ne 0){throw '数据目录权限设置失败'}
$installedNode=Join-Path $InstallDirectory 'runtime\node.exe'
& $installedNode "$InstallDirectory\installer\instance.mjs" initialize
if($LASTEXITCODE -ne 0){throw '首次配置生成失败'}
if(-not $SkipDesktopBridge){
 $directory=Join-Path $DataDirectory 'desktop-bridge';New-Item -ItemType Directory -Force -Path $directory|Out-Null
 Copy-Item -LiteralPath "$InstallDirectory\gateway\scripts\desktop-bridge.mjs","$InstallDirectory\gateway\scripts\desktop-cli-resolver.mjs","$InstallDirectory\gateway\scripts\shared-backend.mjs" -Destination $directory -Force
 # Existing desktop processes may still hold the old EXE open. A new shim
 # takes effect for future launches without replacing that running file.
 $shim=Join-Path $directory ('codex-bridge-'+[Guid]::NewGuid().ToString('N').Substring(0,12)+'.exe')
 & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /r:System.Web.Extensions.dll "/out:$shim" "$InstallDirectory\gateway\scripts\DesktopCliShim.cs"
 if($LASTEXITCODE -ne 0){throw '桌面共享组件编译失败'}
 $settings=@{realCli=$realCli;node=$installedNode;bridgeScript=(Join-Path $directory 'desktop-bridge.mjs');gatewayRoot=(Join-Path $InstallDirectory 'gateway')}
 [IO.File]::WriteAllText((Join-Path $directory 'config.json'),($settings|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText((Join-Path $directory 'enabled.json'),'{}',[Text.UTF8Encoding]::new($false))
 $backup=Join-Path $directory 'previous-cli-override.json'
 if(-not (Test-Path -LiteralPath $backup) -or -not $ownedOverride){[IO.File]::WriteAllText($backup,(@{value=$overrideBeforeInstall}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))}
 $manifest.desktopBridgeShim=$shim
 [IO.File]::WriteAllText((Join-Path $InstallDirectory 'installation.json'),($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 Set-CodexCliOverride $shim
}elseif($ownedOverride){
 $oldData=if($previousInfo.dataDirectory){$previousInfo.dataDirectory}else{$DataDirectory}
 $backup=Join-Path $oldData 'desktop-bridge\previous-cli-override.json'
 $previous=if(Test-Path -LiteralPath $backup){(Get-Content -LiteralPath $backup -Raw -Encoding UTF8|ConvertFrom-Json).value}else{$null}
 Set-CodexCliOverride $previous
}
if(-not $NoAutostart){
 $run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
 $value='"'+(Join-Path $env:WINDIR 'System32\wscript.exe')+'" //B //Nologo "'+(Join-Path $InstallDirectory 'installer\Start-Hidden.vbs')+'"'
 $old=(Get-ItemProperty -LiteralPath $run -ErrorAction SilentlyContinue).LocalCodexConsole
 if($old -and -not $old.Contains($InstallDirectory+'\')){throw '已有其他目录的启动项，未覆盖'}
 New-ItemProperty -LiteralPath $run -Name LocalCodexConsole -Value $value -PropertyType String -Force|Out-Null
}
if(-not $NoShortcuts){
 $shell=New-Object -ComObject WScript.Shell
 foreach($folder in @([Environment]::GetFolderPath('Desktop'),(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Codex Control'))){New-Item -ItemType Directory -Force -Path $folder|Out-Null;$shortcut=$shell.CreateShortcut((Join-Path $folder 'Codex Control.lnk'));$shortcut.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe';$shortcut.Arguments='//B //Nologo "'+(Join-Path $InstallDirectory 'installer\Open-Console.vbs')+'"';$shortcut.WorkingDirectory=$InstallDirectory;$shortcut.Description='打开本地控制台';$shortcut.Save()}
}
if(-not $NoStart){& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$InstallDirectory\installer\Start-Services.ps1";if($LASTEXITCODE -ne 0){throw '程序已安装，但后台启动失败，请打开日志检查'}}
Write-Output "安装完成：$InstallDirectory"
