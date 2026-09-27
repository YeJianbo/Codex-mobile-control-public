param(
    [string]$AvdName = "codexApi31",
    [string]$AndroidSdkRoot = $env:ANDROID_SDK_ROOT,
    [switch]$KeepEmulator
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AndroidSdkRoot)) {
    $AndroidSdkRoot = $env:ANDROID_HOME
}

if ([string]::IsNullOrWhiteSpace($AndroidSdkRoot)) {
    $AndroidSdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}

if (-not (Test-Path $AndroidSdkRoot)) {
    throw "Android SDK 不存在：$AndroidSdkRoot"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot "android"
$platformTools = Join-Path $AndroidSdkRoot "platform-tools"
$emulatorDir = Join-Path $AndroidSdkRoot "emulator"
$cmdlineTools = Join-Path $AndroidSdkRoot "cmdline-tools\latest\bin"
$adb = Join-Path $platformTools "adb.exe"
$emulator = Join-Path $emulatorDir "emulator.exe"
$avdmanager = Join-Path $cmdlineTools "avdmanager.bat"
$systemImage = Join-Path $AndroidSdkRoot "system-images\android-31\google_apis\x86_64"
$avdDir = Join-Path $env:USERPROFILE ".android\avd"
$avdIni = Join-Path $avdDir "$AvdName.ini"

foreach ($path in @($adb, $emulator, $avdmanager)) {
    if (-not (Test-Path $path)) {
        throw "缺少必需文件：$path"
    }
}

if (-not (Test-Path $systemImage)) {
    throw "缺少 system image：$systemImage"
}

$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:SKIP_JDK_VERSION_CHECK = "1"

if (-not (Test-Path $avdDir)) {
    New-Item -Path $avdDir -ItemType Directory | Out-Null
}

if (-not (Test-Path $avdIni)) {
    $answers = 1..5 | ForEach-Object { "no" }
    $answers | & $avdmanager create avd --force --name $AvdName --package "system-images;android-31;google_apis;x86_64" --device "pixel_5" | Out-Host
}

& $adb start-server | Out-Null
$existingDevice = (& $adb devices) | Select-String "emulator-"
$emulatorProcess = $null

if (-not $existingDevice) {
    $emulatorProcess = Start-Process -FilePath $emulator -ArgumentList "@$AvdName", "-no-snapshot", "-no-boot-anim", "-no-audio", "-no-window", "-gpu", "swiftshader_indirect" -WindowStyle Hidden -PassThru
    & $adb wait-for-device | Out-Null
    $boot = ""
    $deadline = (Get-Date).AddMinutes(8)
    while ((Get-Date) -lt $deadline) {
        $boot = (& $adb shell getprop sys.boot_completed 2>$null).Trim()
        if ($boot -eq "1") {
            break
        }
        Start-Sleep -Seconds 5
    }
    if ($boot -ne "1") {
        throw "模拟器未在 8 分钟内完成启动。"
    }
}

Push-Location $androidRoot
try {
    $env:ANDROID_SERIAL = "emulator-5554"
    & .\gradlew.bat --no-daemon :app:connectedDebugAndroidTest
}
finally {
    Pop-Location
    if (-not $KeepEmulator) {
        & $adb -s emulator-5554 emu kill 2>$null | Out-Null
        if ($emulatorProcess -ne $null) {
            $emulatorProcess.WaitForExit(10000) | Out-Null
        }
    }
}
