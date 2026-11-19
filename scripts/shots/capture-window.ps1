# Capture one window (by handle) to a PNG, in physical pixels: -h <handle> -out <C:path.png>
param([long]$h, [string]$out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class C {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct R { public int L, T, Ri, B; }
}
"@
[C]::SetProcessDPIAware() | Out-Null
$hw = [IntPtr]$h; $r = New-Object C+R; [C]::GetWindowRect($hw, [ref]$r) | Out-Null
$w = $r.Ri - $r.L; $ht = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
[C]::PrintWindow($hw, $dc, 2) | Out-Null
$g.ReleaseHdc($dc); $g.Dispose(); $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
"$w x $ht"
