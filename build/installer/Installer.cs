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
[assembly: AssemblyVersion("1.3.0.0")]
[assembly: AssemblyFileVersion("1.3.0.0")]

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
        const string Version = "1.3.0";
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
            GoTo(2);
            Txt("ProgressTitle").Text = "Installing";
            var t = new Thread(delegate () { RunInstall(unsigned); });
            t.IsBackground = true;
            t.Start();
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

        void RunInstall(bool unsigned)
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
                        Progress(20 + 40.0 * n / Math.Max(1, total), null);
                        Thread.Sleep(25);
                    }
                }
                Log("Extension copied (" + files + " files)", true);

                // 2. let After Effects load extensions installed outside Adobe Exchange
                Progress(68, "Setting up After Effects…");
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

                // 3. tidy up what older versions of this setup left behind
                Progress(86, "Tidying up…");
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
