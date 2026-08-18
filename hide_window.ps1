param([string]$launchTime)

# Kill any older hide_window processes except ourselves
$myPid = $PID
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $myPid -and $_.CommandLine -like "*hide_window.ps1*" } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Wait 10 seconds for user to view console window & links
Start-Sleep -Seconds 10

# Check again if a newer hide_window process took over while we slept
$newerProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $myPid -and $_.CommandLine -like "*hide_window.ps1*" }
if ($newerProcess) {
    exit 0
}

$code = @"
using System;
using System.Runtime.InteropServices;
public class WinUtil {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
}
"@
Add-Type -TypeDefinition $code
$hwnd = [WinUtil]::FindWindow($null, "X Tweet Generator Server")
if ($hwnd -eq [IntPtr]::Zero) {
    $p = Get-Process -Name cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*X Tweet Generator Server*" }
    if ($p) { $hwnd = $p.MainWindowHandle }
}
if ($hwnd -and $hwnd -ne [IntPtr]::Zero) {
    [WinUtil]::ShowWindow($hwnd, 0)
}
