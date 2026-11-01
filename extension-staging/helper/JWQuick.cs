// JW Quick: tiny invisible helper started by the JW Preset Applicator panel.
//
//  - Watches for Ctrl+Space while After Effects is the active window (any other app is left alone)
//    and swallows it, so FX Console's popup doesn't open on top.
//  - Shows the "JW Quick Search" window right at the mouse: borderless, rounded corners, no taskbar entry.
//  - Hides it again as soon as it loses focus, and gives focus back to After Effects.
//  - Exits by itself when After Effects closes.
//
// Talks to the panel through stdin/stdout, one word per line:
//   out: ready | open (window missing: please open it) | shown | hidden
//   in : hide | quit | prepare (find + style the window without showing it) | size <height px>
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class JWQuick
{
    const string TITLE = "JW Quick Search";
    const int WH_MOUSE_LL = 14, WM_LBUTTONDOWN = 0x201, WM_RBUTTONDOWN = 0x204, WM_MBUTTONDOWN = 0x207;
    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
    const int VK_SPACE = 0x20, VK_CONTROL = 0x11, VK_SHIFT = 0x10, VK_MENU = 0x12, VK_LWIN = 0x5B, VK_RWIN = 0x5C;
    const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
    const uint WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000, WS_SYSMENU = 0x00080000, WS_MINIMIZEBOX = 0x00020000, WS_MAXIMIZEBOX = 0x00010000;
    const uint WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
    const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOZORDER = 4, SWP_FRAMECHANGED = 0x20, SWP_SHOWWINDOW = 0x40, SWP_NOACTIVATE = 0x10;
    const int SW_HIDE = 0, SW_SHOW = 5;

    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    delegate bool EnumProc(IntPtr hwnd, IntPtr lp);
    [StructLayout(LayoutKind.Sequential)] struct MSLL { public POINT pt; public int data, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KBDLL { public int vk, scan, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int size; public RECT mon, work; public int flags; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr h; public uint m; public IntPtr w, l; public uint t; public POINT p; }

    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc fn, IntPtr lp);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc fn, IntPtr lp);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy, data, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public int type; public MOUSEINPUT mi; }
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SetTimer(IntPtr h, IntPtr id, uint ms, IntPtr fn);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);

    static IntPtr hook, mouseHook, popup = IntPtr.Zero, returnTo = IntPtr.Zero;
    static HookProc hookRef, mouseRef;
    static uint popupPid;
    static int aePid;
    static volatile bool shown, swallowSpaceUp, busy;
    static readonly object outLock = new object();

    static void Say(string s) { lock (outLock) { try { Console.Out.WriteLine(s); Console.Out.Flush(); } catch { } } }

    static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

    static uint PidOf(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return pid; }

    static bool IsAfterEffects(IntPtr h)
    {
        if (h == IntPtr.Zero) return false;
        IntPtr root = GetAncestor(h, 3); // GA_ROOTOWNER
        uint pid = PidOf(root != IntPtr.Zero ? root : h);
        if (aePid > 0) return pid == (uint)aePid;
        bool known;
        lock (aeCache) { if (aeCache.TryGetValue(pid, out known)) return known; }
        try { known = Process.GetProcessById((int)pid).ProcessName.Equals("AfterFX", StringComparison.OrdinalIgnoreCase); } catch { known = false; }
        lock (aeCache) { if (aeCache.Count > 200) aeCache.Clear(); aeCache[pid] = known; }
        return known;
    }
    static readonly System.Collections.Generic.Dictionary<uint, bool> aeCache = new System.Collections.Generic.Dictionary<uint, bool>();

    static bool ProcessIs(uint pid, string name)
    {
        try { return Process.GetProcessById((int)pid).ProcessName.Equals(name, StringComparison.OrdinalIgnoreCase); } catch { return false; }
    }

    static IntPtr FindPopup()
    {
        if (popup != IntPtr.Zero && IsWindow(popup)) return popup;
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr lp) {
            var sb = new StringBuilder(128);
            GetWindowText(h, sb, 128);
            if (sb.ToString() == TITLE) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        popup = found;
        if (found != IntPtr.Zero) popupPid = PidOf(found);
        return found;
    }

    // borderless, rounded, no taskbar button
    static void Style(IntPtr h)
    {
        long st = GetWindowLongPtr(h, GWL_STYLE).ToInt64();
        long ns = st & ~(long)(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
        if (ns != st) SetWindowLongPtr(h, GWL_STYLE, new IntPtr(ns));
        long ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
        long nx = (ex | WS_EX_TOOLWINDOW) & ~(long)WS_EX_APPWINDOW;
        if (nx != ex) SetWindowLongPtr(h, GWL_EXSTYLE, new IntPtr(nx));
        int round = 2; // DWMWCP_ROUND (Windows 11)
        try { DwmSetWindowAttribute(h, 33, ref round, 4); } catch { }
        SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }

    static void ForceForeground(IntPtr h)
    {
        IntPtr fg = GetForegroundWindow();
        uint fgThread = GetWindowThreadProcessId(fg, out _unused), me = GetCurrentThreadId();
        if (fgThread != me) AttachThreadInput(me, fgThread, true);
        BringWindowToTop(h);
        SetForegroundWindow(h);
        if (fgThread != me) AttachThreadInput(me, fgThread, false);
    }
    static uint _unused;

    // Bringing the window forward doesn't put the keyboard inside the web view; do that directly,
    // so you can type into the search box straight away.
    static void FocusWebView(IntPtr top)
    {
        IntPtr target = IntPtr.Zero, any = IntPtr.Zero;
        EnumChildWindows(top, delegate (IntPtr h, IntPtr lp) {
            var sb = new StringBuilder(64);
            GetClassName(h, sb, 64);
            string c = sb.ToString();
            if (any == IntPtr.Zero && IsWindowVisible(h)) any = h;
            if (c == "Chrome_RenderWidgetHostHWND" || c.StartsWith("CefBrowserWindow")) { target = h; if (c == "Chrome_RenderWidgetHostHWND") return false; }
            return true;
        }, IntPtr.Zero);
        if (target == IntPtr.Zero) target = any;
        if (target == IntPtr.Zero) return;
        uint me = GetCurrentThreadId(), th = GetWindowThreadProcessId(target, out _unused);
        if (th != me) AttachThreadInput(me, th, true);
        SetFocus(target);
        if (th != me) AttachThreadInput(me, th, false);
    }

    // Windows won't always hand the keyboard to a window this helper brings up, so do what a
    // person would: one click in the search box (the cursor goes straight back where it was).
    static void ClickSearchBox(IntPtr h)
    {
        RECT r;
        if (!GetWindowRect(h, out r)) return;
        uint dpi = 96;
        try { dpi = GetDpiForWindow(h); if (dpi == 0) dpi = 96; } catch { }
        int x = r.l + (r.r - r.l) / 2, y = r.t + (int)(22 * dpi / 96.0);   // middle of the search box
        POINT back; GetCursorPos(out back);
        clicking = true;
        SetCursorPos(x, y);
        var down = new INPUT { type = 0 }; down.mi.flags = 0x0002;   // MOUSEEVENTF_LEFTDOWN
        var up = new INPUT { type = 0 }; up.mi.flags = 0x0004;       // MOUSEEVENTF_LEFTUP
        SendInput(2, new[] { down, up }, Marshal.SizeOf(typeof(INPUT)));
        Thread.Sleep(15);
        SetCursorPos(back.x, back.y);
        clicking = false;
    }
    static volatile bool clicking;

    // For the first second after opening, something can pull the keyboard back to After Effects.
    // Take it back (at most a few times) and note what took it, for troubleshooting.
    static void GuardFocus(IntPtr h)
    {
        int retakes = 0;
        for (int i = 0; i < 20 && shown; i++)
        {
            Thread.Sleep(50);
            IntPtr fg = GetForegroundWindow();
            if (fg == h || GetAncestor(fg, 3) == h) continue;
            Log("focus taken by " + Describe(fg) + " after " + ((i + 1) * 50) + " ms");
            if (retakes++ >= 3 || !shown) break;
            ForceForeground(h);
            ClickSearchBox(h);
            FocusWebView(h);
        }
    }

    static string Describe(IntPtr h)
    {
        if (h == IntPtr.Zero) return "(nothing)";
        var t = new StringBuilder(128); GetWindowText(h, t, 128);
        var c = new StringBuilder(64); GetClassName(h, c, 64);
        string proc = "?";
        try { proc = Process.GetProcessById((int)PidOf(h)).ProcessName; } catch { }
        return proc + " \"" + t + "\" [" + c + "]";
    }

    static void Log(string s)
    {
        try { System.IO.File.AppendAllText(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "jwquick.log"), DateTime.Now.ToString("HH:mm:ss.fff") + "  " + s + Environment.NewLine); } catch { }
    }

    static void Show()
    {
        if (busy) return;
        busy = true;
        try
        {
            returnTo = GetForegroundWindow();
            IntPtr h = FindPopup();
            if (h == IntPtr.Zero)
            {
                Say("open");
                for (int i = 0; i < 60 && h == IntPtr.Zero; i++) { Thread.Sleep(50); h = FindPopup(); }
                if (h == IntPtr.Zero) return;
                Thread.Sleep(120);
            }
            Style(h);
            POINT c; GetCursorPos(out c);
            RECT r; GetWindowRect(h, out r);
            int w = r.r - r.l, hh = r.b - r.t;
            var mi = new MONITORINFO(); mi.size = Marshal.SizeOf(mi);
            GetMonitorInfo(MonitorFromPoint(c, 2), ref mi);
            int x = Math.Max(mi.work.l + 8, Math.Min(c.x - w / 2, mi.work.r - w - 8));
            // bottom edge at the mouse (it grows upward from there as results appear)
            anchorBottom = Math.Min(c.y, mi.work.b - 8);
            int y = Math.Max(mi.work.t + 8, anchorBottom - hh);
            shown = true; // set first, so the keep-hidden check below never fights it
            SetWindowPos(h, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_SHOWWINDOW);
            ShowWindow(h, SW_SHOW);
            // After Effects activates the window itself (the panel asks it to on "shown"),
            // which keeps the keyboard in the search box
            Say("shown");
        }
        finally { busy = false; }
    }

    static void Hide(bool giveBack)
    {
        IntPtr h = FindPopup();
        if (h != IntPtr.Zero && IsWindowVisible(h)) ShowWindow(h, SW_HIDE);
        bool was = shown;
        shown = false;
        if (giveBack && returnTo != IntPtr.Zero && IsWindow(returnTo)) ForceForeground(returnTo);
        if (was) Say("hidden");
    }

    // a click anywhere outside the popup closes it (clicks inside never do)
    static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && shown && !busy && !clicking)
        {
            int msg = wParam.ToInt32();
            if (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN)
            {
                var m = (MSLL)Marshal.PtrToStructure(lParam, typeof(MSLL));
                RECT r;
                if (popup != IntPtr.Zero && GetWindowRect(popup, out r) && (m.pt.x < r.l || m.pt.x >= r.r || m.pt.y < r.t || m.pt.y >= r.b))
                    ThreadPool.QueueUserWorkItem(delegate { Hide(false); });
            }
        }
        return CallNextHookEx(mouseHook, code, wParam, lParam);
    }

    static void Prepare()
    {
        IntPtr h = IntPtr.Zero;
        for (int i = 0; i < 100 && h == IntPtr.Zero; i++) { h = FindPopup(); if (h == IntPtr.Zero) Thread.Sleep(50); }
        if (h == IntPtr.Zero) return;
        Thread.Sleep(150);
        Style(h);
        if (!shown) ShowWindow(h, SW_HIDE);
        Say("prepared");
    }

    // new height (physical pixels) from the popup; stays on screen
    static int anchorBottom;

    static void Resize(int height)
    {
        IntPtr h = FindPopup();
        if (h == IntPtr.Zero || height < 40) return;
        RECT r; GetWindowRect(h, out r);
        var mi = new MONITORINFO(); mi.size = Marshal.SizeOf(mi);
        POINT tl; tl.x = r.l; tl.y = r.t;
        GetMonitorInfo(MonitorFromPoint(tl, 2), ref mi);
        // keep the bottom where the mouse was; grow upward (but stay on screen)
        int bottom = anchorBottom > 0 ? anchorBottom : r.b;
        int y = Math.Max(mi.work.t + 8, bottom - height);
        SetWindowPos(h, IntPtr.Zero, r.l, y, r.r - r.l, height, SWP_NOZORDER | SWP_NOACTIVATE);
    }

    static IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            var k = (KBDLL)Marshal.PtrToStructure(lParam, typeof(KBDLL));
            int msg = wParam.ToInt32();
            if (k.vk == VK_SPACE)
            {
                if ((msg == WM_KEYUP || msg == WM_SYSKEYUP) && swallowSpaceUp) { swallowSpaceUp = false; return new IntPtr(1); }
                if ((msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) && Down(VK_CONTROL) && !Down(VK_SHIFT) && !Down(VK_MENU) && !Down(VK_LWIN) && !Down(VK_RWIN))
                {
                    IntPtr fg = GetForegroundWindow();
                    bool onPopup = fg != IntPtr.Zero && fg == popup;
                    if (onPopup || IsAfterEffects(fg))
                    {
                        swallowSpaceUp = true;
                        if (onPopup) ThreadPool.QueueUserWorkItem(delegate { Hide(true); });
                        else ThreadPool.QueueUserWorkItem(delegate { Show(); });
                        return new IntPtr(1); // AE (and FX Console) never see it
                    }
                }
            }
        }
        return CallNextHookEx(hook, code, wParam, lParam);
    }

    static int Main(string[] args)
    {
        if (args.Length > 0) int.TryParse(args[0], out aePid);
        try { SetProcessDPIAware(); } catch { }
        Console.OutputEncoding = Encoding.UTF8;

        // stdin: commands from the panel; end of stdin = the panel is gone
        new Thread(delegate () {
            string line;
            try { while ((line = Console.In.ReadLine()) != null) { line = line.Trim(); if (line == "hide") Hide(true); else if (line == "quit") break; else if (line == "prepare") Prepare(); else if (line.StartsWith("size ")) { int hh; if (int.TryParse(line.Substring(5), out hh)) Resize(hh); } } } catch { }
            Hide(false);
            Environment.Exit(0);
        }) { IsBackground = true }.Start();

        // hide when the popup loses focus; quit when After Effects closes
        new Thread(delegate () {
            while (true)
            {
                Thread.Sleep(120);
                if (aePid > 0) { try { if (Process.GetProcessById(aePid).HasExited) Environment.Exit(0); } catch { Environment.Exit(0); } }
                // After Effects shows the window by itself when it loads (or restores it at start-up):
                // unless Ctrl+Space asked for it, keep it out of sight
                if (!shown && !busy)
                {
                    IntPtr ph = FindPopup();
                    if (ph != IntPtr.Zero && IsWindowVisible(ph)) { Style(ph); ShowWindow(ph, SW_HIDE); }
                }
                if (shown && !busy)
                {
                    IntPtr fg = GetForegroundWindow();
                    if (fg != IntPtr.Zero && fg != popup && GetAncestor(fg, 3) != popup)
                    {
                        uint pid = PidOf(fg);
                        bool ours = pid == popupPid || IsAfterEffects(fg) || ProcessIs(pid, "CEPHtmlEngine");
                        if (!ours) Hide(false); // you switched to another app
                    }
                }
            }
        }) { IsBackground = true }.Start();

        hookRef = OnKey;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookRef, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { Say("error hook"); return 1; }
        mouseRef = OnMouse;
        mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseRef, GetModuleHandle(null), 0);
        Say("ready");
        SetTimer(IntPtr.Zero, IntPtr.Zero, 20000, IntPtr.Zero);
        MSG m;
        while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0)
        {
            if (m.m == 0x0113 && !shown) // WM_TIMER
            {
                IntPtr fresh = SetWindowsHookEx(WH_KEYBOARD_LL, hookRef, GetModuleHandle(null), 0);
                if (fresh != IntPtr.Zero) { IntPtr old = hook; hook = fresh; UnhookWindowsHookEx(old); }
                IntPtr freshM = SetWindowsHookEx(WH_MOUSE_LL, mouseRef, GetModuleHandle(null), 0);
                if (freshM != IntPtr.Zero) { IntPtr oldM = mouseHook; mouseHook = freshM; UnhookWindowsHookEx(oldM); }
            }
        }
        return 0;
    }
}
