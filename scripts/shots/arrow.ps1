# Point from one place to another on an image, in Vellum orange: an outline round each box and an arrow along a path.
# -in -out; -boxes "x y w h x y w h …"; -path "x y x y …" (the arrow's corners, the last one is its tip; none: no arrow);
# -label: text in a pill at -lx -ly (optional). All in image pixels, separated by spaces.
param([string]$in, [string]$out, [string]$boxes, [string]$path = "", [string]$label = "", [int]$lx = 0, [int]$ly = 0)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile($in); $c = New-Object System.Drawing.Bitmap $img; $img.Dispose()
$g = [System.Drawing.Graphics]::FromImage($c); $g.SmoothingMode = 'AntiAlias'
$col = [System.Drawing.Color]::FromArgb(255, 255, 92, 56)
$pen = New-Object System.Drawing.Pen $col, 5; $pen.LineJoin = 'Round'
$n = $boxes.Split(' ', [StringSplitOptions]::RemoveEmptyEntries) | % { [int]$_ }
for ($i = 0; $i -lt $n.Count; $i += 4) { $g.DrawRectangle($pen, $n[$i], $n[$i+1], $n[$i+2], $n[$i+3]) }
if ($path) {
$p = $path.Split(' ', [StringSplitOptions]::RemoveEmptyEntries) | % { [single]$_ }
$pts = @(); for ($i = 0; $i -lt $p.Count; $i += 2) { $pts += [System.Drawing.PointF]::new($p[$i], $p[$i+1]) }
# stop the line short of the tip, then a filled head pointing along the last segment
$e = $pts[$pts.Count - 1]; $s = $pts[$pts.Count - 2]; $dx = $e.X - $s.X; $dy = $e.Y - $s.Y; $len = [Math]::Sqrt($dx*$dx + $dy*$dy); $ux = $dx / $len; $uy = $dy / $len
$line = $pts.Clone(); $line[$line.Count - 1] = [System.Drawing.PointF]::new($e.X - $ux * 24, $e.Y - $uy * 24)
$g.DrawLines((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150, 0, 0, 0)), 11), $line)
$g.DrawLines($pen, $line)
$head = @($e, [System.Drawing.PointF]::new($e.X - $ux * 30 - $uy * 16, $e.Y - $uy * 30 + $ux * 16), [System.Drawing.PointF]::new($e.X - $ux * 30 + $uy * 16, $e.Y - $uy * 30 - $ux * 16))
$g.FillPolygon((New-Object System.Drawing.SolidBrush $col), $head)
}
if ($label) {
  $f = New-Object System.Drawing.Font 'Segoe UI', 24, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $sz = $g.MeasureString($label, $f)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $col), $lx, $ly, $sz.Width + 18, $sz.Height + 8)
  $g.DrawString($label, $f, [System.Drawing.Brushes]::White, $lx + 9, $ly + 4)
}
$g.Dispose(); $c.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); "ok"
