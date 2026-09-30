# 捕获指定进程所有可见窗口的截图（开发辅助）。
# 通过 EnumWindows 找出该进程的窗口，挑选面积最大者作为主窗口截屏。
param(
  [string]$ProcessName = 'mtk-porttool-studio',
  [string]$OutFile = 'D:\worker\mtk-porttool-master-ui\.shots\window.png'
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int n);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static List<string> List(uint target) {
    var res = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != target) return true;
      RECT r; GetWindowRect(h, out r);
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      res.Add(h.ToInt64() + "|" + (r.Right - r.Left) + "x" + (r.Bottom - r.Top) + "|" + (IsWindowVisible(h) ? "vis" : "hid") + "|" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output 'NO_PROCESS'; exit 1 }

$wins = [WinEnum]::List([uint32]$proc.Id)
$wins | ForEach-Object { Write-Output $_ }

$best = $null; $bestArea = 0
foreach ($w in $wins) {
  $parts = $w.Split('|')
  if ($parts[2] -ne 'vis') { continue }
  $dims = $parts[1].Split('x')
  $area = [int]$dims[0] * [int]$dims[1]
  if ($area -gt $bestArea) { $bestArea = $area; $best = $parts }
}
if (-not $best -or $bestArea -lt 50000) { Write-Output "NO_LARGE_WINDOW area=$bestArea"; exit 1 }

$hWnd = [IntPtr][int64]$best[0]
[void][WinEnum]::ShowWindow($hWnd, 9)
[void][WinEnum]::SetForegroundWindow($hWnd)
Start-Sleep -Milliseconds 1000

$r = New-Object WinEnum+RECT
[void][WinEnum]::GetWindowRect($hWnd, [ref]$r)
$w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
Write-Output ("CAPTURING=" + $best[3] + " " + $w + "x" + $hgt)

$dir = Split-Path $OutFile -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("SAVED=" + $OutFile)
