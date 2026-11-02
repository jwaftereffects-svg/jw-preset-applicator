// JW Preset Applicator Pro - Setup
// A single-file installer for the After Effects extension. Built with the C# compiler that ships
// with Windows (.NET Framework 4.x), so it runs on any Windows 10/11 PC without extra installs.
//
// What it does (all per-user, no admin needed):
//   - copies the extension into %APPDATA%\Adobe\CEP\extensions\com.jwpresetapplicator.pro
//   - sets PlayerDebugMode for After Effects' extension runtimes (needed for extensions installed
//     outside Adobe Exchange)
// It deliberately does nothing else: no copy of itself, no Apps entry, no shortcuts, no helper
// processes. Those are what antivirus heuristics look for. Run it again to update or remove.
// Run with /uninstall to remove it.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Win32;

[assembly: AssemblyTitle("JW Preset Applicator Pro Setup")]
[assembly: AssemblyProduct("JW Preset Applicator Pro")]
[assembly: AssemblyDescription("Installs the JW Preset Applicator Pro panel for Adobe After Effects")]
[assembly: AssemblyCompany("JW")]
[assembly: AssemblyCopyright("Copyright (c) 2026 JW")]
[assembly: AssemblyTrademark("")]
[assembly: AssemblyCulture("")]
[assembly: System.Runtime.InteropServices.ComVisible(false)]
[assembly: AssemblyVersion("1.4.1.0")]
[assembly: AssemblyFileVersion("1.4.1.0")]

namespace JWSetup
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            var app = new Application();
            app.ShutdownMode = ShutdownMode.OnMainWindowClose;
            bool uninstall = false;
            foreach (var a in args) if (a.Equals("/uninstall", StringComparison.OrdinalIgnoreCase)) uninstall = true;
            app.Run(new SetupWindow(uninstall));
        }
    }

    class SetupWindow : Window
    {
        const string AppName = "JW Preset Applicator Pro";
        const string BundleId = "com.jwpresetapplicator.pro";
        const string Version = "1.4.1";
        // Auto captions (formerly the separate Sentence Studio panel)
        const string OldCaptionsBundle = "com.foxbo.sentencestudio";
        const string OldCaptionsUninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\SentenceStudio";
        const string FontFile = "TikTokSans-VariableFont_opsz,slnt,wdth,wght.ttf";
        const string FontRegName = "TikTok Sans (TrueType)";
        static readonly string LocalData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string engineDir = Path.Combine(LocalData, @"SentenceStudio\engine");
        string fontDir = Path.Combine(LocalData, @"Microsoft\Windows\Fonts");
        readonly string oldCaptionsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Adobe\CEP\extensions\" + OldCaptionsBundle);
        // Extension runtimes to unlock: CSXS.8 = After Effects CC 2018 ... CSXS.12 = AE 2023+.
        // Goes past today's newest so future AE releases work without a new installer.
        const int CsxsFirst = 8, CsxsLast = 20;
        const int OldestAeYear = 2018;
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\JWPresetApplicatorPro";

        string extDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Adobe\CEP\extensions\" + BundleId);
        string setupCopy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"JW Preset Applicator\Setup.exe");
        // Test mode (for building/testing only): JWSETUP_TESTDIR installs into that folder
        // and leaves the registry alone.
        readonly string testDir = Environment.GetEnvironmentVariable("JWSETUP_TESTDIR");
        bool TestMode { get { return !string.IsNullOrEmpty(testDir); } }

        FrameworkElement root;
        Grid[] pages;
        int pageIndex = -1;
        bool startInUninstall;
        bool uninstalling;

        public SetupWindow(bool uninstall)
        {
            startInUninstall = uninstall;
            if (TestMode)
            {
                extDir = Path.Combine(testDir, @"extensions\" + BundleId);
                setupCopy = Path.Combine(testDir, @"setup\Setup.exe");
                fontDir = Path.Combine(testDir, "fonts");
            }
            Title = AppName + " Setup";
            Width = 720; Height = 470;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            try { Icon = System.Windows.Interop.Imaging.CreateBitmapSourceFromHIcon(System.Drawing.Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location).Handle, Int32Rect.Empty, System.Windows.Media.Imaging.BitmapSizeOptions.FromEmptyOptions()); } catch { }

            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ui.xaml"))
                root = (FrameworkElement)XamlReader.Load(s);
            Content = root;
            pages = new Grid[] { (Grid)Find("PageWelcome"), (Grid)Find("PageOptions"), (Grid)Find("PageProgress"), (Grid)Find("PageDone") };
            foreach (var p in pages) { p.Visibility = Visibility.Collapsed; p.Opacity = 0; }

            ((UIElement)Find("TitleBar")).MouseLeftButtonDown += delegate { try { DragMove(); } catch { } };
            Btn("CloseBtn").Click += delegate { Close(); };
            Btn("MinBtn").Click += delegate { WindowState = WindowState.Minimized; };

            Btn("InstallBtn").Click += delegate { GoTo(1); };
            Btn("UninstallBtn").Click += delegate { StartUninstall(); };
            Btn("BackBtn").Click += delegate { GoTo(0); };
            Btn("GoBtn").Click += delegate { StartInstall(); };
            Btn("FinishBtn").Click += delegate { Close(); };
            Btn("OpenFolderBtn").Click += delegate { try { Process.Start("explorer.exe", "\"" + extDir + "\""); } catch { } };

            Loaded += delegate { Setup(); };
        }

        object Find(string name) { return root.FindName(name); }
        Button Btn(string name) { return (Button)Find(name); }
        TextBlock Txt(string name) { return (TextBlock)Find(name); }
        CheckBox Chk(string name) { return (CheckBox)Find(name); }

        // ---------------------------------------------------------------- welcome
        void Setup()
        {
            StartLogoAnimation();
            bool installed = Directory.Exists(extDir);
            string oldVer = installed ? ReadInstalledVersion() : "";

            var aes = FindAfterEffects();
            var tooOld = aes.FindAll(IsTooOld);
            bool anyGood = aes.Count > tooOld.Count;
            if (aes.Count == 0)
                Txt("AeInfo").Text = "After Effects wasn't found in Program Files. You can still install; it works with After Effects CC " + OldestAeYear + " or newer.";
            else if (tooOld.Count == 0)
                Txt("AeInfo").Text = "Found " + string.Join(", ", aes.ToArray());
            else
                Txt("AeInfo").Text = "Found " + string.Join(", ", aes.ToArray()) + ". " + string.Join(", ", tooOld.ToArray()) + (tooOld.Count == 1 ? " is" : " are") + " too old for the panel (needs CC " + OldestAeYear + " or newer).";
            ((System.Windows.Shapes.Ellipse)Find("AeDot")).Fill = new SolidColorBrush(anyGood ? Color.FromRgb(77, 224, 140) : Color.FromRgb(255, 191, 77));

            if (installed)
            {
                Txt("WelcomeTitle").Text = "Already installed";
                Txt("WelcomeBody").Text = "Version " + (oldVer == "" ? "unknown" : oldVer) + " is on this PC. Install again to update or repair it (your settings and favorites stay), or remove it.";
                Btn("InstallBtn").Content = oldVer == Version ? "Repair" : "Update to " + Version;
                Btn("UninstallBtn").Visibility = Visibility.Visible;
            }
            // Auto captions: only offered when this setup carries the caption files
            if (!HasCaptions)
            {
                Chk("OptCaptions").IsChecked = false; Chk("OptCaptions").Visibility = Visibility.Collapsed;
                Chk("OptFont").IsChecked = false; Chk("OptFont").Visibility = Visibility.Collapsed;
            }
            else if (FindEngine() != null)
                Txt("CaptionsInfo").Text = "The speech engine is already on this PC, so setup reuses it. Takes about a minute.";
            GoTo(0);
            if (startInUninstall) StartUninstall();
        }

        static List<string> FindAfterEffects()
        {
            var list = new List<string>();
            try
            {
                string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                foreach (var d in Directory.GetDirectories(Path.Combine(pf, "Adobe"), "Adobe After Effects*"))
                    if (File.Exists(Path.Combine(d, @"Support Files\AfterFX.exe"))) list.Add(Path.GetFileName(d).Replace("Adobe ", ""));
            }
            catch { }
            list.Sort(); list.Reverse();
            return list;
        }

        // "After Effects CC 2017", "After Effects CS6" -> too old. Names without a year (Beta) are fine.
        static bool IsTooOld(string name)
        {
            if (name.IndexOf("CS", StringComparison.Ordinal) >= 0 && System.Text.RegularExpressions.Regex.IsMatch(name, @"\bCS\d")) return true;
            var m = System.Text.RegularExpressions.Regex.Match(name, @"\b(20\d\d)\b");
            return m.Success && int.Parse(m.Groups[1].Value) < OldestAeYear;
        }

        string ReadInstalledVersion()
        {
            try
            {
                string m = File.ReadAllText(Path.Combine(extDir, @"CSXS\manifest.xml"));
                int i = m.IndexOf("ExtensionBundleVersion=\"");
                if (i < 0) return "";
                i += 24;
                return m.Substring(i, m.IndexOf('"', i) - i);
            }
            catch { return ""; }
        }

        // ---------------------------------------------------------------- page transitions
        void GoTo(int index)
        {
            if (index == pageIndex) return;
            var dur = TimeSpan.FromMilliseconds(320);
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            int dir = index > pageIndex ? 1 : -1;
            if (pageIndex >= 0)
            {
                var old = pages[pageIndex];
                var fade = new DoubleAnimation(0, TimeSpan.FromMilliseconds(160));
                fade.Completed += delegate { old.Visibility = Visibility.Collapsed; };
                old.BeginAnimation(OpacityProperty, fade);
            }
            var p = pages[index];
            var tt = new TranslateTransform(28 * dir, 0);
            p.RenderTransform = tt;
            p.Visibility = Visibility.Visible;
            var fadeIn = new DoubleAnimation(0, 1, dur) { BeginTime = TimeSpan.FromMilliseconds(pageIndex >= 0 ? 120 : 0), EasingFunction = ease };
            var slide = new DoubleAnimation(28 * dir, 0, dur) { BeginTime = fadeIn.BeginTime, EasingFunction = ease };
            p.BeginAnimation(OpacityProperty, fadeIn);
            tt.BeginAnimation(TranslateTransform.XProperty, slide);
            pageIndex = index;
            if (TestMode) SnapshotSoon(index);
            for (int i = 0; i < 4; i++)
            {
                var dot = (Border)Find("Step" + i);
                dot.Width = i == index ? 22 : 7;
                dot.Opacity = i <= index ? 1 : 0.3;
            }
        }

        // Test mode only: save a PNG of each page (rendered from the window itself).
        void SnapshotSoon(int index)
        {
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(700) };
            timer.Tick += delegate
            {
                timer.Stop();
                try
                {
                    double dpi = 96 * 1.5;
                    Directory.CreateDirectory(testDir);
                    var rtb = new System.Windows.Media.Imaging.RenderTargetBitmap((int)(ActualWidth * 1.5), (int)(ActualHeight * 1.5), dpi, dpi, PixelFormats.Pbgra32);
                    rtb.Render(root);
                    var enc = new System.Windows.Media.Imaging.PngBitmapEncoder();
                    enc.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(rtb));
                    using (var f = File.Create(Path.Combine(testDir, "page" + index + (uninstalling ? "-remove" : "") + ".png"))) enc.Save(f);
                }
                catch { }
            };
            timer.Start();
        }

        void StartLogoAnimation()
        {
            var logo = (FrameworkElement)Find("Logo");
            var tt = new TranslateTransform();
            var rt = new RotateTransform(0, 48, 48);
            var tg = new TransformGroup(); tg.Children.Add(rt); tg.Children.Add(tt);
            logo.RenderTransform = tg;
            var bob = new DoubleAnimation(-5, 5, TimeSpan.FromSeconds(2.2)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            var tilt = new DoubleAnimation(-6, 6, TimeSpan.FromSeconds(3.1)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            tt.BeginAnimation(TranslateTransform.YProperty, bob);
            rt.BeginAnimation(RotateTransform.AngleProperty, tilt);
            var glow = (FrameworkElement)Find("Glow");
            glow.BeginAnimation(OpacityProperty, new DoubleAnimation(0.35, 0.8, TimeSpan.FromSeconds(2.6)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever });
        }

        // ---------------------------------------------------------------- progress helpers
        void Progress(double pct, string status)
        {
            Dispatcher.Invoke(new Action(delegate
            {
                var fill = (FrameworkElement)Find("BarFill");
                var track = (FrameworkElement)Find("BarTrack");
                var anim = new DoubleAnimation(Math.Max(0, Math.Min(1, pct / 100.0)) * track.ActualWidth, TimeSpan.FromMilliseconds(380)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
                fill.BeginAnimation(WidthProperty, anim);
                Txt("Pct").Text = Math.Round(pct) + "%";
                if (status != null) Txt("Status").Text = status;
            }));
        }

        void Log(string line, bool ok)
        {
            Dispatcher.Invoke(new Action(delegate
            {
                var panel = (StackPanel)Find("LogList");
                var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 6), Opacity = 0 };
                row.Children.Add(new TextBlock { Text = ok ? "✓" : "!", Width = 18, FontWeight = FontWeights.Bold, Foreground = new SolidColorBrush(ok ? Color.FromRgb(77, 224, 140) : Color.FromRgb(255, 191, 77)) });
                row.Children.Add(new TextBlock { Text = line, Foreground = new SolidColorBrush(Color.FromRgb(200, 205, 222)), TextWrapping = TextWrapping.Wrap, MaxWidth = 380 });
                panel.Children.Add(row);
                row.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(250)));
            }));
        }

        // ---------------------------------------------------------------- install
        void StartInstall()
        {
            bool unsigned = Chk("OptUnsigned").IsChecked == true;
            bool captions = Chk("OptCaptions").IsChecked == true;
            bool font = Chk("OptFont").IsChecked == true;
            GoTo(2);
            Txt("ProgressTitle").Text = "Installing";
            var t = new Thread(delegate () { RunInstall(unsigned, captions, font); });
            t.IsBackground = true;
            t.Start();
        }

        // ---------------------------------------------------------------- auto captions (speech engine, template, font)
        static bool HasCaptions { get { using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("captions.zip")) return s != null; } }

        // Minimal reader for flat JSON files like {"python": "...", ...}
        static string JsonValue(string json, string key)
        {
            int k = json.IndexOf("\"" + key + "\"");
            if (k < 0) return null;
            int colon = json.IndexOf(':', k);
            int q1 = colon < 0 ? -1 : json.IndexOf('"', colon + 1);
            if (q1 < 0) return null;
            var sb = new StringBuilder();
            for (int i = q1 + 1; i < json.Length; i++)
            {
                char c = json[i];
                if (c == '\\' && i + 1 < json.Length) { i++; char n = json[i]; sb.Append(n == 'n' ? '\n' : n == 't' ? '\t' : n); continue; }
                if (c == '"') break;
                sb.Append(c);
            }
            return sb.ToString();
        }
        static string JsonString(string s) { return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

        // The engine's folder if a working speech engine is already on this PC (ours, or one an older
        // Sentence Studio setup pointed to), else null.
        string FindEngine()
        {
            foreach (var dir in new string[] { extDir, oldCaptionsDir })
            {
                foreach (var name in new string[] { "captions-runtime.json", "runtime.json" })
                {
                    try
                    {
                        string json = File.ReadAllText(Path.Combine(dir, name)).TrimStart('﻿');
                        string py = JsonValue(json, "python"), ff = JsonValue(json, "ffmpeg"), st = JsonValue(json, "state");
                        if (py != null && ff != null && st != null && File.Exists(py) && File.Exists(ff)) return st;
                    }
                    catch { }
                }
            }
            if (File.Exists(Path.Combine(engineDir, @"runtime\Scripts\python.exe")) && File.Exists(Path.Combine(engineDir, @"bin\ffmpeg.exe")) && File.Exists(Path.Combine(engineDir, "engine-ready.json")))
                return engineDir;
            return null;
        }

        // Unpacks the entries of captions.zip under `prefix` into `dest`.
        static int ExtractCaptions(string prefix, string dest, Action<int, int> onFile)
        {
            int files = 0;
            string full = Path.GetFullPath(dest);
            if (!full.EndsWith("\\")) full += "\\";
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("captions.zip"))
            using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                var entries = new List<ZipArchiveEntry>();
                foreach (var e in zip.Entries) if (e.FullName.Replace('\\', '/').StartsWith(prefix) && !e.FullName.EndsWith("/")) entries.Add(e);
                for (int i = 0; i < entries.Count; i++)
                {
                    string rel = entries[i].FullName.Replace('\\', '/').Substring(prefix.Length);
                    string target = Path.GetFullPath(Path.Combine(full, rel.Replace('/', Path.DirectorySeparatorChar)));
                    if (!target.StartsWith(full, StringComparison.OrdinalIgnoreCase)) continue; // never write outside the folder
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (var src = entries[i].Open())
                    using (var dst = File.Create(target)) src.CopyTo(dst);
                    files++;
                    if (onFile != null) onFile(i + 1, entries.Count);
                }
            }
            return files;
        }

        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] static extern int AddFontResource(string file);
        [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

        void InstallFont()
        {
            string target = Path.Combine(fontDir, FontFile);
            if (File.Exists(target)) { Log("TikTok Sans already installed", true); return; }
            Directory.CreateDirectory(fontDir);
            string tmp = Path.Combine(Path.GetTempPath(), "jw-font-" + Guid.NewGuid().ToString("N"));
            ExtractCaptions("fonts/", tmp, null);
            File.Copy(Path.Combine(tmp, FontFile), target);
            if (TestMode) Log("[test] font copied to " + fontDir + " (not registered)", true);
            else
            {
                using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows NT\CurrentVersion\Fonts"))
                    k.SetValue(FontRegName, target, RegistryValueKind.String);
                try { AddFontResource(target); IntPtr r; SendMessageTimeout((IntPtr)0xffff, 0x001D, IntPtr.Zero, IntPtr.Zero, 2, 1000, out r); } catch { }
                try { File.Copy(Path.Combine(tmp, "TikTokSans-OFL.txt"), Path.Combine(fontDir, "TikTokSans-OFL.txt"), true); } catch { }
                Log("TikTok Sans installed for pop-up captions", true);
            }
            try { Directory.Delete(tmp, true); } catch { }
        }

        // Downloads the speech engine with the included Python (prints "@@ <percent> <message>" lines).
        string InstallEngine(double lo, double hi)
        {
            string work = Path.Combine(LocalData, @"SentenceStudio\setup-temp\" + Guid.NewGuid().ToString("N"));
            Progress(lo, "Unpacking the included Python…");
            ExtractCaptions("engine-setup/", work, null);
            var psi = new ProcessStartInfo(Path.Combine(work, @"python\python.exe"), "-I \"" + Path.Combine(work, "setup_engine.py") + "\" --state \"" + engineDir + "\"")
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                WorkingDirectory = work, StandardOutputEncoding = new UTF8Encoding(false), StandardErrorEncoding = new UTF8Encoding(false)
            };
            psi.EnvironmentVariables["PYTHONUTF8"] = "1";
            string error = null, lastStep = null;
            using (var p = new Process { StartInfo = psi })
            {
                p.OutputDataReceived += delegate (object s, DataReceivedEventArgs e)
                {
                    if (e.Data == null) return;
                    if (e.Data.StartsWith("@@ "))
                    {
                        int sp = e.Data.IndexOf(' ', 3), pct;
                        if (sp < 0 || !int.TryParse(e.Data.Substring(3, sp - 3), out pct)) return;
                        string msg = e.Data.Substring(sp + 1);
                        if (lastStep != null) Log(lastStep, true);
                        lastStep = msg;
                        Progress(lo + (hi - lo) * pct / 100.0, msg + "…");
                    }
                    else if (e.Data.StartsWith("ERROR ")) error = e.Data.Substring(6);
                };
                p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null && error == null && e.Data.Contains("Error")) error = e.Data; };
                p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine();
                p.WaitForExit();
                if (p.ExitCode != 0)
                    throw new Exception((error ?? "The speech engine setup stopped.") + " Check your internet connection and free space, then run setup again (finished downloads are reused). Log: " + Path.Combine(engineDir, "setup-log.txt"));
            }
            if (lastStep != null) Log(lastStep, true);
            try { Directory.Delete(work, true); } catch { }
            return engineDir;
        }

        void SetUpCaptions(bool font, double lo, double hi)
        {
            string engine = FindEngine(); // read before the old Sentence Studio panel is removed
            if (font) InstallFont();
            if (engine != null) { Log("Speech engine found, reusing it", true); Progress(hi - 4, null); }
            else if (TestMode) { engine = engineDir; Log("[test] would download the speech engine into " + engine, true); Progress(hi - 4, null); }
            else engine = InstallEngine(lo, hi - 4);
            // the default animated-caption template (never overwrite one that's already there)
            Directory.CreateDirectory(engine);
            string templateTarget = Path.Combine(engine, "animation-template.aep");
            if (File.Exists(templateTarget)) Log("Animated caption template already there, kept yours", true);
            else
            {
                string tmp = Path.Combine(Path.GetTempPath(), "jw-template-" + Guid.NewGuid().ToString("N"));
                ExtractCaptions("styles/", tmp, null);
                File.Copy(Path.Combine(tmp, "animation-template.aep"), templateTarget);
                try { Directory.Delete(tmp, true); } catch { }
                Log("Animated caption template added", true);
            }
            // the panel looks in the default engine folder; point it elsewhere only when needed
            if (!string.Equals(Path.GetFullPath(engine).TrimEnd('\\'), Path.GetFullPath(engineDir).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                File.WriteAllText(Path.Combine(extDir, "captions-runtime.json"),
                    "{\n  \"python\": " + JsonString(Path.Combine(engine, @"runtime\Scripts\python.exe")) + ",\n  \"ffmpeg\": " + JsonString(Path.Combine(engine, @"bin\ffmpeg.exe")) + ",\n  \"state\": " + JsonString(engine) + "\n}\n",
                    new UTF8Encoding(false));
            }
            Log("Auto captions ready in the Audio tab", true);
        }

        // Auto captions used to be the separate Sentence Studio panel. Remove that panel (not its speech
        // engine, which is reused) and what its 1.0 setup left behind, so there's only one extension.
        void RemoveOldCaptionsPanel()
        {
            bool had = Directory.Exists(oldCaptionsDir);
            if (TestMode) { if (had) Log("[test] would remove the separate Sentence Studio panel", true); return; }
            try { if (had) Directory.Delete(oldCaptionsDir, true); } catch { Log("Couldn't remove the old Sentence Studio panel (close After Effects and run setup again)", false); return; }
            try { Registry.CurrentUser.DeleteSubKeyTree(OldCaptionsUninstallKey, false); } catch { }
            try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Sentence Studio Setup.lnk")); } catch { }
            try { File.Delete(Path.Combine(LocalData, @"SentenceStudio\Setup.exe")); } catch { }
            if (had) Log("Removed the separate Sentence Studio panel (it's now in the Audio tab)", true);
        }

        // Older versions (1.2 and before) registered an Apps entry, kept a copy of the setup and
        // could add a Start menu shortcut. Remove those leftovers (only those exact items).
        void RemoveOldLeftovers()
        {
            if (TestMode) return;
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
            try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + " Setup.lnk")); } catch { }
            try
            {
                string me = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
                if (File.Exists(setupCopy) && !string.Equals(me, Path.GetFullPath(setupCopy), StringComparison.OrdinalIgnoreCase)) File.Delete(setupCopy);
            }
            catch { }
        }

        void RunInstall(bool unsigned, bool captions, bool font)
        {
            try
            {
                Thread.Sleep(350);
                Progress(8, "Getting ready…");
                bool aeOpen = Process.GetProcessesByName("AfterFX").Length > 0;

                // 1. copy the extension (replace any older copy, keep nothing stale)
                Progress(20, "Copying the extension…");
                if (Directory.Exists(extDir)) Directory.Delete(extDir, true);
                Directory.CreateDirectory(extDir);
                int files = 0;
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
                {
                    int total = zip.Entries.Count, n = 0;
                    foreach (var entry in zip.Entries)
                    {
                        n++;
                        string rel = entry.FullName.Replace('\\', '/');
                        if (rel.EndsWith("/")) continue;
                        string dest = Path.GetFullPath(Path.Combine(extDir, rel.Replace('/', Path.DirectorySeparatorChar)));
                        if (!dest.StartsWith(extDir, StringComparison.OrdinalIgnoreCase)) continue; // never write outside the folder
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        using (var src = entry.Open())
                        using (var dst = File.Create(dest)) src.CopyTo(dst);
                        files++;
                        Progress(10 + 20.0 * n / Math.Max(1, total), null);
                        Thread.Sleep(15);
                    }
                }
                Log("Extension copied (" + files + " files)", true);

                // 2. auto captions: speech engine, template, font; then retire the separate Sentence Studio panel
                if (captions && HasCaptions) { Progress(32, "Setting up auto captions…"); SetUpCaptions(font, 32, 88); }
                else if (font && HasCaptions) InstallFont();
                RemoveOldCaptionsPanel();

                // 3. let After Effects load extensions installed outside Adobe Exchange
                Progress(90, "Setting up After Effects…");
                Thread.Sleep(250);
                if (unsigned && TestMode) Log("[test] would turn on PlayerDebugMode for CSXS." + CsxsFirst + "-" + CsxsLast, true);
                else if (unsigned)
                {
                    for (int v = CsxsFirst; v <= CsxsLast; v++)
                    {
                        using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Adobe\CSXS." + v))
                            k.SetValue("PlayerDebugMode", "1", RegistryValueKind.String);
                    }
                    Log("After Effects can now load the panel", true);
                }
                else Log("Skipped the extension setting · the panel may not appear", false);

                // 4. tidy up what older versions of this setup left behind
                Progress(96, "Tidying up…");
                RemoveOldLeftovers();
                Log("To update or remove later, just run this setup again", true);

                Progress(100, "Done");
                Thread.Sleep(450);
                Dispatcher.Invoke(new Action(delegate
                {
                    Txt("DoneTitle").Text = "You're all set";
                    Txt("DoneBody").Text = aeOpen
                        ? "After Effects is open, so restart it once. Then open Window › Extensions › JW Preset Applicator Pro."
                        : "Open After Effects, then Window › Extensions › JW Preset Applicator Pro. A quick welcome tour starts the first time.";
                    ((FrameworkElement)Find("OpenFolderBtn")).Visibility = Visibility.Visible;
                    GoTo(3);
                }));
            }
            catch (Exception ex)
            {
                Fail("Install failed: " + ex.Message);
            }
        }

        // ---------------------------------------------------------------- uninstall
        void StartUninstall()
        {
            if (uninstalling) return;
            uninstalling = true;
            GoTo(2);
            Txt("ProgressTitle").Text = "Removing";
            var t = new Thread(delegate ()
            {
                try
                {
                    Progress(15, "Removing the extension…");
                    Thread.Sleep(300);
                    if (Directory.Exists(extDir)) Directory.Delete(extDir, true);
                    Log("Extension removed", true);
                    Progress(55, "Cleaning up…");
                    Thread.Sleep(250);
                    RemoveOldLeftovers();
                    Log("Cleaned up", true);
                    Progress(100, "Done");
                    Thread.Sleep(400);
                    Dispatcher.Invoke(new Action(delegate
                    {
                        Txt("DoneTitle").Text = "Removed";
                        Txt("DoneBody").Text = "JW Preset Applicator Pro has been removed. Restart After Effects if it's open. Thanks for trying it!";
                        ((FrameworkElement)Find("OpenFolderBtn")).Visibility = Visibility.Collapsed;
                        GoTo(3);
                    }));
                }
                catch (Exception ex) { Fail("Couldn't remove it: " + ex.Message + " (close After Effects and try again)"); }
            });
            t.IsBackground = true;
            t.Start();
        }

        void Fail(string msg)
        {
            Dispatcher.Invoke(new Action(delegate
            {
                Log(msg, false);
                Txt("Status").Text = "Something went wrong";
                ((FrameworkElement)Find("ProgressClose")).Visibility = Visibility.Visible;
                Btn("ProgressClose").Click += delegate { Close(); };
            }));
        }
    }
}
