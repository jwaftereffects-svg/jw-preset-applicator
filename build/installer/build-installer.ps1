# Builds dist\JW-Preset-Applicator-Pro-Setup.exe
#  1. node build.js release   (clean extension + payload.zip)
#  2. icon
#  3. compile Installer.cs with the C# compiler that ships with Windows, embedding the payload + UI
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Resolve-Path "$here\..\.."
$dist = Join-Path $root "dist"

node (Join-Path $here "..\build.js") release
if ($LASTEXITCODE -ne 0) { throw "release build failed" }

& "$here\make-icon.ps1" -Out "$here\icon.ico" | Out-Null

# Auto captions: engine setup scripts (build/captions) + local assets listed in build/captions-assets.json
# (portable Python, NLTK data, animated-caption template, TikTok Sans). Without that file the installer
# simply doesn't offer auto captions.
$captionsZip = Join-Path $dist "captions.zip"
Remove-Item $captionsZip -Force -ErrorAction SilentlyContinue
$assetsFile = Join-Path $here "..\captions-assets.json"
if (Test-Path $assetsFile) {
    $a = Get-Content $assetsFile -Raw | ConvertFrom-Json
    $stage = Join-Path $dist "captions-stage"
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force "$stage\engine-setup", "$stage\styles", "$stage\fonts" | Out-Null
    Copy-Item (Join-Path $here "..\captions\engine-setup\*") "$stage\engine-setup\" -Recurse
    robocopy $a.python "$stage\engine-setup\python" /E /XD __pycache__ /XF *.pyc *.pyo /NFL /NDL /NJH /NJS | Out-Null
    robocopy $a.nltk "$stage\engine-setup\nltk_data" /E /NFL /NDL /NJH /NJS | Out-Null
    Copy-Item -LiteralPath $a.template "$stage\styles\animation-template.aep"
    Copy-Item -LiteralPath $a.font "$stage\fonts\"
    $ofl = [IO.File]::ReadAllText($a.ofl, [Text.Encoding]::GetEncoding(1252))
    $ofl = "Copyright 2024 TikTok Inc. (https://github.com/tiktok/TikTokSans)`r`n`r`nThis Font Software is licensed under the SIL Open Font License, Version 1.1.`r`n`r`n" + $ofl.Substring($ofl.IndexOf("SIL OPEN FONT LICENSE Version 1.1"))
    [IO.File]::WriteAllText("$stage\fonts\TikTokSans-OFL.txt", $ofl)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $captionsZip, [IO.Compression.CompressionLevel]::Optimal, $false)
    Remove-Item $stage -Recurse -Force
    "captions: $captionsZip $([math]::Round((Get-Item $captionsZip).Length / 1MB, 1)) MB"
} else { "captions: skipped (no build/captions-assets.json)" }
$global:LASTEXITCODE = 0

$fw = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
$csc = Join-Path $fw "csc.exe"
$out = Join-Path $dist "JW-Preset-Applicator-Pro-Setup.exe"
$refs = @("$fw\WPF\PresentationFramework.dll", "$fw\WPF\PresentationCore.dll", "$fw\WPF\WindowsBase.dll",
          "$fw\System.Xaml.dll", "$fw\System.IO.Compression.dll", "$fw\System.Drawing.dll", "$fw\System.dll", "$fw\System.Core.dll")
$args = @("/nologo", "/codepage:65001", "/target:winexe", "/optimize+", "/platform:anycpu", "/out:$out",
          "/win32icon:$here\icon.ico", "/win32manifest:$here\app.manifest",
          "/resource:$dist\payload.zip,payload.zip", "/resource:$here\ui.xaml,ui.xaml") +
        $(if (Test-Path $captionsZip) { @("/resource:$captionsZip,captions.zip") } else { @() }) +
        ($refs | ForEach-Object { "/reference:$_" }) + @("$here\Installer.cs")
& $csc @args
if ($LASTEXITCODE -ne 0) { throw "compile failed" }
"built: $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"

# also keep the latest installer right in Documents (replaces the previous one)
$docs = [Environment]::GetFolderPath("MyDocuments")
Copy-Item -LiteralPath $out -Destination (Join-Path $docs "JW-Preset-Applicator-Pro-Setup.exe") -Force
"copied to: $(Join-Path $docs 'JW-Preset-Applicator-Pro-Setup.exe')"
