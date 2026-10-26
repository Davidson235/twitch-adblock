param(
  [Parameter(Mandatory = $true)][string]$Src,
  [string]$Prefix = "icon",
  [double]$RadiusRatio = 0.18,
  [double]$Zoom = 1.0
)
Add-Type -AssemblyName System.Drawing

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$raw = [System.Drawing.Bitmap]::FromFile($Src)
$side = [Math]::Min($raw.Width, $raw.Height)
$ox = [int](($raw.Width - $side) / 2)
$oy = [int](($raw.Height - $side) / 2)
$bmp = New-Object System.Drawing.Bitmap($side, $side, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gc = [System.Drawing.Graphics]::FromImage($bmp)
$gc.DrawImage($raw, (New-Object System.Drawing.Rectangle(0, 0, $side, $side)), (New-Object System.Drawing.Rectangle($ox, $oy, $side, $side)), [System.Drawing.GraphicsUnit]::Pixel)
$gc.Dispose()
$raw.Dispose()
if ($Zoom -lt 1.0) {
  $z = [int]($side * $Zoom)
  $ox2 = [int](($side - $z) / 2)
  $oy2 = [int](($side - $z) / 2)
  $zoomed = New-Object System.Drawing.Bitmap($z, $z, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gz = [System.Drawing.Graphics]::FromImage($zoomed)
  $gz.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $z, $z)), (New-Object System.Drawing.Rectangle($ox2, $oy2, $z, $z)), [System.Drawing.GraphicsUnit]::Pixel)
  $gz.Dispose()
  $bmp.Dispose()
  $bmp = $zoomed
  $side = $z
}
$w = $bmp.Width; $h = $bmp.Height
Write-Host "source cropped: ${w}x${h}"

$out = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$radius = [int]([Math]::Min($w, $h) * $RadiusRatio)

for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $inside = $true
    if ($x -lt $radius -and $y -lt $radius) {
      $dx = $radius - $x; $dy = $radius - $y
      if (($dx * $dx + $dy * $dy) -gt ($radius * $radius)) { $inside = $false }
    } elseif ($x -gt ($w - 1 - $radius) -and $y -lt $radius) {
      $dx = $x - ($w - 1 - $radius); $dy = $radius - $y
      if (($dx * $dx + $dy * $dy) -gt ($radius * $radius)) { $inside = $false }
    } elseif ($x -lt $radius -and $y -gt ($h - 1 - $radius)) {
      $dx = $radius - $x; $dy = $y - ($h - 1 - $radius)
      if (($dx * $dx + $dy * $dy) -gt ($radius * $radius)) { $inside = $false }
    } elseif ($x -gt ($w - 1 - $radius) -and $y -gt ($h - 1 - $radius)) {
      $dx = $x - ($w - 1 - $radius); $dy = $y - ($h - 1 - $radius)
      if (($dx * $dx + $dy * $dy) -gt ($radius * $radius)) { $inside = $false }
    }
    if ($inside) { $out.SetPixel($x, $y, $bmp.GetPixel($x, $y)) }
  }
}
$bmp.Dispose()

function Resize-Png($source, $size, $path) {
  $nb = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($nb)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($source, 0, 0, $size, $size)
  $g.Dispose()
  $nb.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $nb.Dispose()
}

foreach ($s in 128, 48, 32, 16) {
  Resize-Png $out $s (Join-Path $dir ("{0}{1}.png" -f $Prefix, $s))
}
Resize-Png $out 512 (Join-Path $dir ("{0}512.png" -f $Prefix))
$out.Dispose()

Get-ChildItem $dir -Filter "$Prefix*.png" | Select-Object Name, Length | Format-Table -AutoSize
