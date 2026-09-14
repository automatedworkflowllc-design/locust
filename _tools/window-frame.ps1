# Resize a window to an exact OUTER size and capture it, chrome included.
#
#   powershell -File _tools/window-frame.ps1 -Pid 1234 -Width 1120 -Height 720 -Out frame.png
#   powershell -File _tools/window-frame.ps1 -Pid 1234 -Maximize -Out frame.png
#   powershell -File _tools/window-frame.ps1 -Pid 1234 -Probe
#
# Why this exists rather than `Emulation.setDeviceMetricsOverride`: that
# changes the PAGE and leaves the OS window where it was, which Astra
# correctly called "narrower evidence, not a native-window sizing pass"
# (2026-09-14). A design review measuring pixels needs the window the person
# actually has, so this moves the real window and reads back what Windows
# actually gave it -- a request is not a measurement.
#
# Capture is PrintWindow with PW_RENDERFULLCONTENT, which asks the window to
# draw ITSELF into a bitmap. CopyFromScreen was the obvious choice and it is
# wrong here: it reads the glass, so whatever happens to be in front lands in
# the PNG instead. Windows refuses foreground steals from a background
# process, so the first run of this captured the operator's browser at
# exactly the right rectangle -- a frame that looks like a successful capture
# and is a picture of something else entirely. PrintWindow needs no
# foreground and does not disturb whatever the person is doing.

param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [int]$Width,
  [int]$Height,
  [switch]$Maximize,
  [switch]$Probe,
  [string]$Out
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class LcWin {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

# The app's main window: the visible one with a title. Electron keeps hidden
# helper windows around, and picking one of those would resize nothing a
# person can see.
# STRICTLY the pid given, and nothing else.
#
# This first searched by process NAME as a fallback, which is a way to resize
# and photograph somebody else's window: the operator has their own copy of
# this app open while the harness drives a second one. A test that can reach
# outside its own instance is not a test. If the named process has no visible
# window yet, that is a failure to report, not a reason to go looking.
$proc = Get-Process -Id $ProcessId -ErrorAction Stop
$handle = $proc.MainWindowHandle
if ($handle -eq [IntPtr]::Zero -or -not [LcWin]::IsWindowVisible($handle)) {
  Write-Error "pid $ProcessId has no visible main window"
  exit 2
}

if ($Maximize) {
  [void][LcWin]::ShowWindow($handle, 3)   # SW_MAXIMIZE
  Start-Sleep -Milliseconds 700
} elseif ($Width -gt 0 -and $Height -gt 0) {
  [void][LcWin]::ShowWindow($handle, 1)   # SW_SHOWNORMAL, so a maximised window can shrink
  Start-Sleep -Milliseconds 250
  [void][LcWin]::MoveWindow($handle, 40, 40, $Width, $Height, $true)
  Start-Sleep -Milliseconds 700
}

# Deliberately NOT raised. PrintWindow draws the window's own content, and
# stealing focus from whoever is at the keyboard is both rude and unreliable.
Start-Sleep -Milliseconds 400

# Read back what Windows ACTUALLY gave us. A window with a minimum size will
# silently refuse to go smaller, and a frame reported as 1120 when it is 1180
# sends a pixel review the wrong way.
$rect = New-Object LcWin+RECT
[void][LcWin]::GetWindowRect($handle, [ref]$rect)
$client = New-Object LcWin+RECT
[void][LcWin]::GetClientRect($handle, [ref]$client)
$outerW = $rect.Right - $rect.Left
$outerH = $rect.Bottom - $rect.Top

if ($Probe) {
  "outer=${outerW}x${outerH} client=$($client.Right)x$($client.Bottom) at=$($rect.Left),$($rect.Top)"
  exit 0
}
if (-not $Out) { Write-Error 'pass -Out'; exit 2 }

$bitmap = New-Object System.Drawing.Bitmap $outerW, $outerH
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$dc = $graphics.GetHdc()
# 2 = PW_RENDERFULLCONTENT, which is what makes this work for a
# GPU-composited window like Electron's. Without it the bitmap comes back
# blank or missing the web contents.
$ok = [LcWin]::PrintWindow($handle, $dc, 2)
$graphics.ReleaseHdc($dc)
$graphics.Dispose()
if (-not $ok) { $bitmap.Dispose(); Write-Error 'PrintWindow refused'; exit 3 }
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Force $dir) }
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

"saved=$Out outer=${outerW}x${outerH} client=$($client.Right)x$($client.Bottom)"
