# Drives the installer in test mode (installs into a temp folder, no registry changes)
# and screenshots each page of the installer window.
param([string]$Shots = "$env:TEMP\jwsetup-shots")
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
$exe = Resolve-Path "$PSScriptRoot\..\..\dist\JW-Preset-Applicator-Pro-Setup.exe"
$test = Join-Path $env:TEMP "jwsetup-test"
Remove-Item $test -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Shots | Out-Null

$psi = New-Object System.Diagnostics.ProcessStartInfo $exe
$psi.UseShellExecute = $false
$psi.EnvironmentVariables["JWSETUP_TESTDIR"] = $test
$proc = [System.Diagnostics.Process]::Start($psi)

$AE = [System.Windows.Automation.AutomationElement]
function Win {
    for ($i = 0; $i -lt 50; $i++) {
        $c = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $proc.Id)
        $w = $AE::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $c)
        if ($w) { return $w }
        Start-Sleep -Milliseconds 200
    }
    throw "installer window not found"
}
function Shot($name) {
    $w = Win
    try { $w.SetFocus() } catch {}
    Start-Sleep -Milliseconds 700
    $r = $w.Current.BoundingRectangle
    $bmp = New-Object System.Drawing.Bitmap ([int]$r.Width), ([int]$r.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size)
    $bmp.Save("$Shots\$name.png"); $g.Dispose(); $bmp.Dispose()
}
function Click($label) {
    $w = Win
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $label)
    $b = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
    if (-not $b) { throw "button '$label' not found" }
    $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}

Start-Sleep -Milliseconds 800
Shot "1-welcome"
Click "Install";      Shot "2-options"
Click "Install now";  Start-Sleep -Seconds 1; Shot "3-progress"
Start-Sleep -Seconds 3; Shot "4-done"

$files = Get-ChildItem "$test\extensions" -Recurse -File | ForEach-Object { $_.FullName.Substring($test.Length + 1) }
"installed files: $($files.Count)"
$files | Select-Object -First 20
"setup copy: $(Test-Path "$test\setup\Setup.exe")"
Click "Finish"
Start-Sleep -Milliseconds 600
"exited: $($proc.HasExited)"
