$ErrorActionPreference = 'Stop'
$installed = Join-Path $env:USERPROFILE '.codex\tools\local-console\gateway'
$launcher = Join-Path $installed 'scripts\background-service.vbs'
$entry = Join-Path $installed 'scripts\public-entry.mjs'
$config = Join-Path $env:USERPROFILE '.codex-mobile-control\cloudflared.yml'
$node = (Get-Command node.exe).Source
$cloudflared = Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

foreach ($path in @($launcher, $entry, $config, $node, $cloudflared, $wscript)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "缺少后台启动所需文件：$path" }
}

$services = @(
    @{ Name = 'CodexMobilePublicEntry'; Kind = 'public-entry'; Executable = $node; Target = $entry },
    @{ Name = 'CodexMobileTunnel'; Kind = 'tunnel'; Executable = $cloudflared; Target = $config }
)

foreach ($service in $services) {
    $task = Get-ScheduledTask -TaskName $service.Name -ErrorAction Stop
    if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $service.Name }
    if ($service.Kind -eq 'public-entry') {
        $listener = Get-NetTCPConnection -LocalPort 48763 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
            if ($process.CommandLine -notlike "*$entry*") { throw '48763 端口由其他程序占用，未停止它。' }
            Stop-Process -Id $listener.OwningProcess
        }
    } else {
        Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" |
            Where-Object { $_.CommandLine -like "*$config*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId }
    }
    Start-Sleep -Seconds 1
    if ((Get-ScheduledTask -TaskName $service.Name).State -eq 'Running') { throw "$($service.Name) 未能停止，后台任务未更新。" }
    if ($service.Kind -eq 'public-entry' -and (Get-NetTCPConnection -LocalPort 48763 -State Listen -ErrorAction SilentlyContinue)) {
        throw '旧公网 API 进程尚未退出，后台任务未更新。'
    }
    $args = '//B //Nologo "' + $launcher + '" ' + $service.Kind + ' "' + $service.Executable + '" "' + $service.Target + '"'
    $action = New-ScheduledTaskAction -Execute $wscript -Argument $args
    Set-ScheduledTask -TaskName $service.Name -Action $action | Out-Null
    Start-ScheduledTask -TaskName $service.Name
}

for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (Get-NetTCPConnection -LocalPort 48763 -State Listen -ErrorAction SilentlyContinue) { break }
    Start-Sleep -Milliseconds 250
}
if (-not (Get-NetTCPConnection -LocalPort 48763 -State Listen -ErrorAction SilentlyContinue)) {
    throw '公网 API 后台任务未监听 48763 端口。'
}

Get-ScheduledTask -TaskName ($services | ForEach-Object Name) |
    Select-Object TaskName, State, @{Name='Background';Expression={$_.Actions[0].Execute -eq $wscript}}
