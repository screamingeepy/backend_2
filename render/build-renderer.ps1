# Build web/swf/avatarRenderer.swf from render/src/AvatarRenderer.as.
#
# The compiler is the one Adobe Animate installs; there is no separate Flex or
# AIR SDK on this machine. Animate ships mxmlc.jar and playerglobal.swc but no
# flex-config.xml, so src/ph-config.xml supplies the whole configuration.
#
#   powershell -File render\build-renderer.ps1
#
# Override the compiler location with -AnimateRoot if Animate lives elsewhere.

param(
  [string]$AnimateRoot = "C:\Program Files\Adobe\Adobe Animate 2024\Common\Configuration\ActionScript 3.0",
  [string]$Output = (Join-Path $PSScriptRoot "..\web\swf\avatarRenderer.swf")
)

$ErrorActionPreference = "Stop"

$mxmlc = Join-Path $AnimateRoot "bin\mxmlc.jar"
$src = Join-Path $PSScriptRoot "src\AvatarRenderer.as"
$config = Join-Path $PSScriptRoot "src\ph-config.xml"

if (-not (Test-Path $mxmlc)) {
  Write-Error "No mxmlc.jar at $mxmlc. Pass -AnimateRoot with the path to Animate's 'ActionScript 3.0' folder."
}

# mxmlc's own defaults look for ./localFonts.ser relative to the working
# directory and fail outright when it is missing. Nothing here embeds a font,
# so an empty file is enough to satisfy it.
Push-Location $PSScriptRoot
try {
  if (-not (Test-Path "localFonts.ser")) {
    New-Item -ItemType File -Path "localFonts.ser" | Out-Null
  }

  & java -jar $mxmlc "-load-config=$config" "-output=$Output" "--" $src

  if ($LASTEXITCODE -ne 0) {
    Write-Error "mxmlc failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

Write-Output "built $Output ($((Get-Item $Output).Length) bytes)"
