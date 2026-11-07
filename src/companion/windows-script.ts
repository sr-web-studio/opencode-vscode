/**
 * The PowerShell program behind the Windows taskbar flash. It is started once, compiles a small C# class once
 * (`Add-Type`: P/Invoke into user32.dll, no binary is shipped) and then answers one JSON line per request on stdin with
 * one JSON line on stdout. See `src/core/attention.ts` for the line protocol.
 *
 * Rules for this text: ASCII only (it travels as -EncodedCommand), C# 5 syntax (Windows PowerShell 5.1 compiler), no
 * backticks or `${` (it lives in a template string).
 *
 * Signatures, from Microsoft Learn (FlashWindowEx / FLASHWINFO, checked 2026-11-06):
 *   struct FLASHWINFO { UINT cbSize; HWND hwnd; DWORD dwFlags; UINT uCount; DWORD dwTimeout; }
 *   BOOL FlashWindowEx(PFLASHWINFO pfwi)
 *   FLASHW_TRAY = 0x2, FLASHW_TIMERNOFG = 0xC: flash the taskbar button until the window comes to the foreground.
 */

export const WINDOWS_HELPER_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class OcWin {
  public long H;
  public uint P;
  public string T;
}

public static class OcAttention {
  [StructLayout(LayoutKind.Sequential)]
  struct FLASHWINFO {
    public uint cbSize;
    public IntPtr hwnd;
    public uint dwFlags;
    public uint uCount;
    public uint dwTimeout;
  }

  delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool FlashWindowEx(ref FLASHWINFO f);

  // Visible top-level windows of class Chrome_WidgetWin_1 (Electron) that have a title, of every process.
  public static List<OcWin> Windows() {
    List<OcWin> found = new List<OcWin>();
    EnumProc proc = delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      StringBuilder cls = new StringBuilder(256);
      GetClassName(h, cls, cls.Capacity);
      if (cls.ToString() != "Chrome_WidgetWin_1") return true;
      StringBuilder title = new StringBuilder(1024);
      GetWindowText(h, title, title.Capacity);
      if (title.Length == 0) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      OcWin w = new OcWin();
      w.H = h.ToInt64();
      w.P = pid;
      w.T = title.ToString();
      found.Add(w);
      return true;
    };
    EnumWindows(proc, IntPtr.Zero);
    GC.KeepAlive(proc);
    return found;
  }

  public static long Foreground() {
    return GetForegroundWindow().ToInt64();
  }

  // Flash the taskbar button until the window comes to the foreground. Never activates or raises anything.
  public static void Flash(long h) {
    FLASHWINFO f = new FLASHWINFO();
    f.cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
    f.hwnd = new IntPtr(h);
    f.dwFlags = 0x2 | 0xC;
    f.uCount = 0;
    f.dwTimeout = 0;
    FlashWindowEx(ref f);
  }
}
'@

function Write-Line($o) {
  $s = $o | ConvertTo-Json -Compress -Depth 6
  $s = [regex]::Replace($s, '[^\x00-\x7F]', { param($m) ([string][char]92) + 'u' + ('{0:x4}' -f [int][char]$m.Value.ToString()[0]) })
  [Console]::Out.WriteLine($s)
  [Console]::Out.Flush()
}

function Get-ParentPid([int]$p) {
  try {
    $x = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p) -Property ParentProcessId
    if ($x) { return [int]$x.ParentProcessId }
  } catch {}
  return 0
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = [int]$req.id
    if ($req.op -eq 'quit') { exit 0 }
    elseif ($req.op -eq 'windows') {
      $all = @([OcAttention]::Windows())
      $p = [int]$req.pid
      $owner = 0
      $mine = @()
      for ($i = 0; $i -lt 12 -and $p -gt 0; $i++) {
        $here = @($all | Where-Object { $_.P -eq $p })
        if ($here.Count -gt 0) { $owner = $p; $mine = $here; break }
        $p = Get-ParentPid $p
      }
      $list = @($mine | ForEach-Object { [pscustomobject]@{ h = $_.H; p = [int]$_.P; t = $_.T } })
      Write-Line @{ id = $id; ok = $true; pid = $owner; windows = $list }
    }
    elseif ($req.op -eq 'flash') {
      $fg = [OcAttention]::Foreground()
      $flashed = @()
      $skipped = @()
      foreach ($h in @($req.hwnds)) {
        if ([long]$h -eq $fg) { $skipped += [long]$h }
        else { [OcAttention]::Flash([long]$h); $flashed += [long]$h }
      }
      Write-Line @{ id = $id; ok = $true; flashed = $flashed; skipped = $skipped }
    }
    else { Write-Line @{ id = $id; ok = $false; error = 'unknown op' } }
  } catch {
    Write-Line @{ id = $id; ok = $false; error = [string]$_.Exception.Message }
  }
}
`

/** The argument list that runs the script (persistent, reads requests from stdin). */
export function helperArgs(script: string = WINDOWS_HELPER_SCRIPT): string[] {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]
}
