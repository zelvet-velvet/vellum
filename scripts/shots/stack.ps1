# Stack two PNGs, top above bottom, centred, on the bottom image's background: -top -bottom -out
param([string]$top, [string]$bottom, [string]$out)
Add-Type -AssemblyName System.Drawing
$a = [System.Drawing.Image]::FromFile($top); $b = [System.Drawing.Bitmap]::FromFile($bottom)
$W = [Math]::Max($a.Width, $b.Width); $H = $a.Height + $b.Height + 24
$c = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($c); $g.Clear($b.GetPixel(4, $b.Height - 4))
$g.DrawImage($a, [int](($W - $a.Width) / 2), 0, $a.Width, $a.Height)
$g.DrawImage($b, [int](($W - $b.Width) / 2), $a.Height + 24, $b.Width, $b.Height)
$g.Dispose(); $c.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); "$W x $H"
