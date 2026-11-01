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

$fw = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
$csc = Join-Path $fw "csc.exe"
$out = Join-Path $dist "JW-Preset-Applicator-Pro-Setup.exe"
$refs = @("$fw\WPF\PresentationFramework.dll", "$fw\WPF\PresentationCore.dll", "$fw\WPF\WindowsBase.dll",
          "$fw\System.Xaml.dll", "$fw\System.IO.Compression.dll", "$fw\System.Drawing.dll", "$fw\System.dll", "$fw\System.Core.dll")
$args = @("/nologo", "/codepage:65001", "/target:winexe", "/optimize+", "/platform:anycpu", "/out:$out",
          "/win32icon:$here\icon.ico", "/win32manifest:$here\app.manifest",
          "/resource:$dist\payload.zip,payload.zip", "/resource:$here\ui.xaml,ui.xaml") +
        ($refs | ForEach-Object { "/reference:$_" }) + @("$here\Installer.cs")
& $csc @args
if ($LASTEXITCODE -ne 0) { throw "compile failed" }
"built: $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"

# also keep the latest installer right in Documents (replaces the previous one)
$docs = [Environment]::GetFolderPath("MyDocuments")
Copy-Item -LiteralPath $out -Destination (Join-Path $docs "JW-Preset-Applicator-Pro-Setup.exe") -Force
"copied to: $(Join-Path $docs 'JW-Preset-Applicator-Pro-Setup.exe')"
