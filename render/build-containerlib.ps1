# Build web/swf/containerLib.swf from the decompiled container.swf sources.
#
#   powershell -File render\build-containerlib.ps1
#
# WHY THIS EXISTS
#
# bustHarness.swf loads swf/containerLib.swf as the second step of its boot,
# before environ.xml and the framework, and stops dead if it 404s. The site
# ships container.swf, but that is the container *application*: its document
# class is com.disney.fairies.Container, which calls ExternalInterface and dies
# with Error #2067 outside a browser, taking the boot down with it.
#
# containerLib is the same code without a document class -- a plain library the
# framework's own classes resolve against. It is built here rather than
# committed because it is derived: everything in it comes from
# TheFullScriptDump/container.swf/scripts, which is already in the repo.
#
# WHAT GOES IN IT
#
# Only what framework.swf and standalone.swf actually need from container,
# which is a much smaller set than container defines (12 of 239 classes, plus
# whatever those pull in). The list below was derived by scanning the two
# consumers' imports for names that container defines, then confirmed by
# running the harness: a missing one shows up as
# "Error #1065: Variable com.disney::OS is not defined".
#
# PNGEncoder is not imported by the framework at all -- it is there for
# AvatarRenderer, which resolves it out of this same application domain.

param(
  [string]$AnimateRoot = "C:\Program Files\Adobe\Adobe Animate 2024\Common\Configuration\ActionScript 3.0",
  [string]$Output = (Join-Path $PSScriptRoot "..\web\swf\containerLib.swf")
)

$ErrorActionPreference = "Stop"

$mxmlc = Join-Path $AnimateRoot "bin\mxmlc.jar"
$playerglobal = Join-Path $AnimateRoot "FP11.2\playerglobal.swc"
$scripts = Join-Path $PSScriptRoot "..\TheFullScriptDump\container.swf\scripts"
$stub = Join-Path $PSScriptRoot "src\ContainerLib.as"

if (-not (Test-Path $mxmlc)) {
  Write-Error "No mxmlc.jar at $mxmlc. Pass -AnimateRoot with the path to Animate's 'ActionScript 3.0' folder."
}

$classes = @(
  "com.disney.log.Logger",
  "com.disney.log.Level",
  "com.disney.OS",
  "com.adobe.images.PNGEncoder"
)

# -compiler.strict=false because these sources came out of a decompiler, and it
# loses the return statement on paths where every branch already returned. That
# reads to mxmlc as "Function does not return a value", which is an error in
# strict mode and would fail the build on perfectly good code. Nothing here is
# hand-written, so there is no author to warn.
$arguments = @(
  "-jar", $mxmlc,
  "-load-config=",
  "-external-library-path=$playerglobal",
  "-target-player=11.2",
  "-compiler.theme=",
  "-compiler.strict=false",
  "-source-path=$scripts",
  "-includes"
) + $classes + @("-output=$Output", "--", $stub)

# mxmlc's defaults look for ./localFonts.ser in the working directory and fail
# outright when it is missing. Nothing here embeds a font, so an empty file
# satisfies it.
Push-Location $PSScriptRoot
try {
  if (-not (Test-Path "localFonts.ser")) {
    New-Item -ItemType File -Path "localFonts.ser" | Out-Null
  }

  & java @arguments

  if ($LASTEXITCODE -ne 0) {
    Write-Error "mxmlc failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

Write-Output "built $Output ($((Get-Item $Output).Length) bytes)"
