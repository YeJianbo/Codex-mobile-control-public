$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$gatewayDirectory = Join-Path $projectDirectory 'server'
$configFile = Join-Path $env:USERPROFILE '.codex-mobile-control\server.json'
$gatewayConfig = if (Test-Path -LiteralPath $configFile) { Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json } else { $null }
$gatewayPort = if ($gatewayConfig.port) { $gatewayConfig.port } else { 38457 }
$scheme = if ($gatewayConfig.https.enabled) { 'https' } else { 'http' }
$gatewayUrl = "${scheme}://127.0.0.1:$gatewayPort"
$probe = Join-Path $gatewayDirectory 'scripts\local-gateway-check.mjs'
try { $health = & node.exe $probe health | ConvertFrom-Json } catch { $health = $null }
if (-not $health.ok) {
    $nodeExecutable = (Get-Command node.exe).Source
    $artifactDirectory = Join-Path $projectDirectory 'artifacts'
    New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
    Start-Process -FilePath $nodeExecutable -ArgumentList '--import','tsx','src/index.ts' -WorkingDirectory $gatewayDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $artifactDirectory 'desktop-gateway.log') -RedirectStandardError (Join-Path $artifactDirectory 'desktop-gateway.err.log') | Out-Null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { $health = & node.exe $probe health | ConvertFrom-Json; if ($health.ok) { break } } catch { }
    }
    if (-not $health.ok) { throw '网关启动失败，请查看 artifacts/desktop-gateway.err.log。' }
}
$gatewayConfig = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$pairing = & node.exe $probe pair | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $pairing.code) { throw '无法创建手机配对码。' }
# Only a short-lived, single-use code enters browser history; the page immediately clears it.
$chromeExecutable = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chromeExecutable)) { throw '找不到 Google Chrome，请先安装 Chrome。' }
Start-Process -FilePath $chromeExecutable -ArgumentList "$gatewayUrl/console#desktopPair=$($pairing.code)"

