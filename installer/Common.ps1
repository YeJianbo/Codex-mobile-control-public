$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Set-CodexCliOverride($value) {
    [Environment]::SetEnvironmentVariable('CODEX_CLI_PATH',$value,'User')
    $env:CODEX_CLI_PATH=$value
    if(-not ('CodexInstallEnvironment' -as [type])){
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CodexInstallEnvironment {
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint message,UIntPtr wParam,string lParam,uint flags,uint timeout,out UIntPtr result);
}
'@
    }
    $result=[UIntPtr]::Zero
    [void][CodexInstallEnvironment]::SendMessageTimeout([IntPtr]0xffff,0x001A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$result)
}
function Read-Installation {
    $root=Split-Path $PSScriptRoot -Parent
    $info=Get-Content -LiteralPath (Join-Path $root 'installation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $env:CODEX_HOME=$info.codexHome
    $env:CODEX_MOBILE_CONTROL_HOME=$info.dataDirectory
    $env:LOCAL_CONSOLE_PORT=[string]$info.consolePort
    if($info.cloudflaredPath){$env:CLOUDFLARED_PATH=$info.cloudflaredPath}
    $env:PATH=(Join-Path $root 'runtime')+';'+$env:PATH
    return @{ Root=$root; Info=$info; Node=(Join-Path $root 'runtime\node.exe') }
}
function Get-OwnedProcesses($installation) {
    $root=$installation.Root
    $paths=@((Join-Path $root 'installer\guard.mjs'),(Join-Path $root 'src\supervisor.mjs'),(Join-Path $root 'src\server.mjs'),(Join-Path $root 'gateway\dist\index.js'),(Join-Path $root 'gateway\scripts\public-entry.mjs'))
    @(Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $line=$_.CommandLine; @($paths | Where-Object { $line -and $line.Contains($_) }).Count -gt 0 })
}
