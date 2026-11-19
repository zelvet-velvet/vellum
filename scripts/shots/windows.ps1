# List Windows Terminal windows: handle | title | visible | position and size
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  public struct R { public int L, T, Ri, B; }
}
"@
$out = New-Object System.Collections.ArrayList
[W]::EnumWindows({ param($h, $l)
  $c = New-Object System.Text.StringBuilder 256; [W]::GetClassName($h, $c, 256) | Out-Null
  if ($c.ToString() -eq "CASCADIA_HOSTING_WINDOW_CLASS") {
    $t = New-Object System.Text.StringBuilder 256; [W]::GetWindowText($h, $t, 256) | Out-Null
    $r = New-Object W+R; [W]::GetWindowRect($h, [ref]$r) | Out-Null
    [void]$out.Add(("{0} | {1} | vis={2} | {3},{4} {5}x{6}" -f $h, $t, [W]::IsWindowVisible($h), $r.L, $r.T, ($r.Ri-$r.L), ($r.B-$r.T)))
  }
  $true }, [IntPtr]::Zero) | Out-Null

$out
