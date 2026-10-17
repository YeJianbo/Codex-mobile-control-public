$ErrorActionPreference='Stop'
$root=Join-Path $PSScriptRoot '..\runtime\antigravity-acp'
New-Item -ItemType Directory -Path $root -Force | Out-Null
# Published by Google in the ACP registry; installation does not authenticate.
$url='https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.4.0-windows-x86_64.zip'
$archive=Join-Path $root 'server.zip'
Invoke-WebRequest $url -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $root -Force
Get-Item (Join-Path $root 'agy_acp_server.exe') | Select-Object FullName,Length
