[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string[]]$KeepVersion,
    [switch]$Preview
)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if (-not (Test-Path -LiteralPath (Join-Path $workspace 'server/package.json')) -or
    -not (Test-Path -LiteralPath (Join-Path $workspace 'android/app/build.gradle.kts'))) {
    throw '未找到项目源码，取消清理。'
}

# Gradle daemons remain idle between builds; only wrappers and packaging jobs
# indicate that generated files are currently being written.
$building = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match 'GradleWrapperMain|[b]uild-release\.py|[r]elease-smoke\.mjs'
}
if ($building) { Write-Output '正在构建，跳过本次清理。'; exit 0 }

$keptVersions = @($KeepVersion | ForEach-Object { [version]$_ })
$newestKept = $keptVersions | Sort-Object | Select-Object -Last 1
function Test-OlderRelease([string]$value) {
    $release = [version]$value
    return $release -lt $newestKept -and $release -notin $keptVersions
}

$targets = [Collections.Generic.List[IO.FileSystemInfo]]::new()
$artifacts = Join-Path $workspace 'artifacts'
if (Test-Path -LiteralPath $artifacts) {
    Get-ChildItem -LiteralPath $artifacts -Directory -Force |
        Where-Object { $_.Name -match '^portable-(\d+\.\d+\.\d+)$' -and (Test-OlderRelease $Matches[1]) } |
        ForEach-Object { $targets.Add($_) }
}

# These are versioned build exports, not the live APK in server/public/downloads.
# The installed gateway and the current Android delivery are outside these roots.
$deliverables = Join-Path $workspace 'deliverables'
foreach ($directory in @($artifacts, $deliverables)) {
    if (-not (Test-Path -LiteralPath $directory)) { continue }
    Get-ChildItem -LiteralPath $directory -File -Force |
        Where-Object {
            if ($_.Name -match '^Codex-Control-(\d+\.\d+\.\d+)(?:[-.].*)?\.(apk|exe|zip)$' -or
                $_.Name -match '^windows-release-manifest-(\d+\.\d+\.\d+)\.json$') {
                Test-OlderRelease $Matches[1]
            }
        } | ForEach-Object { $targets.Add($_) }
}

$removed = 0
foreach ($target in $targets) {
    $path = [IO.Path]::GetFullPath($target.FullName)
    if (-not $path.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "清理路径超出项目：$path"
    }
    if (($target.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "清理路径是链接，取消：$path"
    }
    if ($Preview) { Write-Output $path; continue }
    if ($PSCmdlet.ShouldProcess($path, '删除项目生成产物')) {
        Remove-Item -LiteralPath $path -Recurse -Force
        $removed++
    }
}
if (-not $Preview) { Write-Output "已清理 $removed 项生成产物。" }
