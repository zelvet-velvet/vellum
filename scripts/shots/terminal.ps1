# Move/resize a window and type into it: -h <handle> -w <width> -ht <height> -keys <SendKeys text> (w 0: no resize; % ^ + ( ) { } need escaping as {%} etc.)
param([long]$h, [int]$w, [int]$ht, [string]$keys)
Add-Type @"
using System; using System.Runtime.InteropServices;
public class T {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[T]::SetProcessDPIAware() | Out-Null
$hw = [IntPtr]$h
if ($w -gt 0) { [T]::MoveWindow($hw, 40, 40, $w, $ht, $true) | Out-Null }
if ($keys) {
  [T]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [T]::SetForegroundWindow($hw) | Out-Null; [T]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 400
  if ([T]::GetForegroundWindow() -ne $hw) { "not foreground"; exit 1 }
  $sh = New-Object -ComObject WScript.Shell
  $sh.SendKeys($keys)
  "sent"
}
