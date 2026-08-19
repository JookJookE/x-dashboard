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
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();
}
"@
try {
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
} catch {}

# Method 1: Find by Window Title
$hwnd = [WinUtil]::FindWindow($null, "X Tweet Generator Server")

# Method 2: Find by Process Main Window Handle
if ($hwnd -eq [IntPtr]::Zero) {
    $processes = Get-Process | Where-Object { $_.MainWindowTitle -like "*X Tweet Generator Server*" -or $_.ProcessName -eq "cmd" }
    foreach ($p in $processes) {
        if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
            [WinUtil]::ShowWindow($p.MainWindowHandle, 0)
        }
    }
} else {
    [WinUtil]::ShowWindow($hwnd, 0)
}

# Method 3: Direct Console Window
$consoleHwnd = [WinUtil]::GetConsoleWindow()
if ($consoleHwnd -and $consoleHwnd -ne [IntPtr]::Zero) {
    [WinUtil]::ShowWindow($consoleHwnd, 0)
}
