# Draws the app icon (gradient diamond) and saves a multi-size .ico (PNG-compressed entries).
param([string]$Out = "$PSScriptRoot\icon.ico")
Add-Type -AssemblyName System.Drawing

function Draw([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size
    # rounded dark tile
    $r = [int]($s * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($s - $r - 1, 0, $r, $r, 270, 90)
    $path.AddArc($s - $r - 1, $s - $r - 1, $r, $r, 0, 90); $path.AddArc(0, $s - $r - 1, $r, $r, 90, 90); $path.CloseFigure()
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0, 0)), ([System.Drawing.Point]::new($s, $s)), ([System.Drawing.Color]::FromArgb(255, 18, 30, 46)), ([System.Drawing.Color]::FromArgb(255, 26, 19, 60))
    $g.FillPath($bg, $path)
    # gradient diamond
    $m = $s * 0.16
    $pts = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($s / 2, $m), [System.Drawing.PointF]::new($s - $m, $s / 2),
        [System.Drawing.PointF]::new($s / 2, $s - $m), [System.Drawing.PointF]::new($m, $s / 2))
    $acc = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0, 0)), ([System.Drawing.Point]::new($s, $s)), ([System.Drawing.Color]::FromArgb(255, 64, 204, 255)), ([System.Drawing.Color]::FromArgb(255, 92, 107, 255))
    $g.FillPolygon($acc, $pts)
    $i = $s * 0.36
    $inner = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($s / 2, $i), [System.Drawing.PointF]::new($s - $i, $s / 2),
        [System.Drawing.PointF]::new($s / 2, $s - $i), [System.Drawing.PointF]::new($i, $s / 2))
    $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 14, 16, 22))), $inner)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return , $ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$images = @(); foreach ($sz in $sizes) { $images += , (Draw $sz) }
$fs = [System.IO.File]::Create($Out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($k = 0; $k -lt $sizes.Count; $k++) {
    $sz = $sizes[$k]; $len = $images[$k].Length
    $w.Write([byte]($(if ($sz -ge 256) { 0 } else { $sz }))); $w.Write([byte]($(if ($sz -ge 256) { 0 } else { $sz })))
    $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$len); $w.Write([uint32]$offset); $offset += $len
}
foreach ($img in $images) { $w.Write($img) }
$w.Close()
"icon: $Out"
