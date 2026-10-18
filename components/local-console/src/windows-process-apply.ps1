$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = @()
$appId = (Get-StartApps | Where-Object { $_.AppID -match '^OpenAI\.Codex_[^!]+!App$' } | Select-Object -First 1).AppID
if ($request.action -eq 'restart' -and -not $appId) { throw 'Codex 应用入口未注册；未关闭现有进程' }

foreach ($item in $request.targets) {
    $live = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$item.id)
    if (-not $live) { $results += [pscustomobject]@{ id = $item.id; state = 'already-exited' }; continue }
    if ($live.CreationDate.ToUniversalTime().ToString('o') -ne $item.createdAt) {
        $results += [pscustomobject]@{ id = $item.id; state = 'changed' }; continue
    }
    try {
        Stop-Process -Id ([int]$item.id) -Force -ErrorAction Stop
        $results += [pscustomobject]@{ id = $item.id; state = 'stopped' }
    } catch { $results += [pscustomobject]@{ id = $item.id; state = 'failed' } }
}

$started = $false
if ($request.action -eq 'restart' -and -not @($results | Where-Object { $_.state -in @('failed', 'changed') }).Count) {
    $launchError = $null
    $launchAt = Get-Date
    try {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IApplicationActivationManager {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
}
public static class CodexAppActivator {
    [DllImport("ole32.dll", PreserveSig = false)]
    private static extern void CoCreateInstance(ref Guid clsid, IntPtr outer, uint context,
        ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IApplicationActivationManager manager);
    public static uint Activate(string appId) {
        var clsid = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
        var iid = typeof(IApplicationActivationManager).GUID;
        IApplicationActivationManager manager;
        CoCreateInstance(ref clsid, IntPtr.Zero, 23, ref iid, out manager);
        try {
            uint processId;
            Marshal.ThrowExceptionForHR(manager.ActivateApplication(appId, null, 0, out processId));
            return processId;
        } finally { Marshal.ReleaseComObject(manager); }
    }
}
'@
        $launchedPid = [CodexAppActivator]::Activate($appId)
        if ($launchedPid -gt 0) {
            $activated = Get-Process -Id $launchedPid -ErrorAction SilentlyContinue
            if ($activated -and $activated.ProcessName -eq 'ChatGPT') { $started = $true }
        }
    } catch { $launchError = $_.Exception.Message }
    if ($launchError) {
        try { Start-Process -FilePath explorer.exe -ArgumentList ('shell:AppsFolder\' + $appId) -WindowStyle Hidden -ErrorAction Stop }
        catch { $launchError += '；应用入口启动失败：' + $_.Exception.Message }
    }
    for ($i = 0; -not $started -and $i -lt 120; $i++) {
        if ($i -gt 0 -and $i % 20 -eq 0) {
            try {
                if ('CodexAppActivator' -as [type]) {
                    $retryPid = [CodexAppActivator]::Activate($appId)
                    if ($retryPid -gt 0) {
                        $activated = Get-Process -Id $retryPid -ErrorAction SilentlyContinue
                        if ($activated -and $activated.ProcessName -eq 'ChatGPT') { $started = $true; break }
                    }
                } else {
                    Start-Process -FilePath explorer.exe -ArgumentList ('shell:AppsFolder\' + $appId) -WindowStyle Hidden -ErrorAction Stop
                }
            } catch { $launchError = $_.Exception.Message }
        }
        Start-Sleep -Milliseconds 500
        $live = @(Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $launchAt.AddSeconds(-2) })
        if ($live.Count) { $started = $true; break }
    }
    if (-not $started) {
        $suffix = if ($launchError) { '；' + $launchError } else { '' }
        throw ('已请求 Windows 启动 Codex，但未检测到桌面进程' + $suffix)
    }
}
[pscustomobject]@{ results = $results; started = $started } | ConvertTo-Json -Depth 4 -Compress
