"""Temporary, non-activating desktop drawing for the CEP audio pin.

Reads the cursor; never moves it, clicks, or changes After Effects. The window
is layered and mouse-transparent and exits on release, Escape, parent shutdown,
or timeout. Communication is newline-delimited JSON on stdin/stdout.

Releasing over a recognised timeline row sends {"event": "drop", "target": row}
right away (the panel links that layer), plays a short "landed" animation on the
row, then closes with reason "release".
"""
import ctypes
from ctypes import wintypes
import json
import math
import os
import queue
import sys
import threading
import time
import tkinter as tk

DROP_SECONDS = .8


def mix(a, b, t):
    """Blend two #rrggbb colours (the overlay can't do real transparency)."""
    t = max(0., min(1., t))
    a = [int(a[i:i+2], 16) for i in (1, 3, 5)]
    b = [int(b[i:i+2], 16) for i in (1, 3, 5)]
    return '#%02x%02x%02x' % tuple(round(a[i]+(b[i]-a[i])*t) for i in range(3))


def ease_out(t):
    t = max(0., min(1., t))
    return 1-(1-t)**3


def run(config):
    user = ctypes.WinDLL('user32', use_last_error=True)
    user.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    user.GetAncestor.restype = wintypes.HWND
    user.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
    user.GetWindowLongW.restype = wintypes.LONG
    user.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.LONG]
    user.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user.GetAsyncKeyState.restype = ctypes.c_short
    try:
        user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except (AttributeError, OSError):
        pass
    point = wintypes.POINT()
    left, top, width, height = [user.GetSystemMetrics(i) for i in (76, 77, 78, 79)]
    root = tk.Tk()
    root.withdraw()
    root.overrideredirect(True)
    root.title('Sentence Studio audio pin')
    color_key = '#010203'
    root.configure(bg=color_key)
    root.wm_attributes('-transparentcolor', color_key)
    root.geometry(f'{width}x{height}{left:+d}{top:+d}')
    canvas = tk.Canvas(root, width=width, height=height, bg=color_key, highlightthickness=0)
    canvas.pack()
    root.update_idletasks()
    hwnd = user.GetAncestor(root.winfo_id(), 2)
    # Layered + transparent means input passes through to the actual AE window.
    flags = user.GetWindowLongW(hwnd, -20) | 0x80000 | 0x20 | 0x80 | 0x08000000
    user.SetWindowLongW(hwnd, -20, flags)
    user.SetWindowPos(hwnd, wintypes.HWND(-1), left, top, width, height, 0x10 | 0x40)
    user.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
    # Exclude our drawing from OCR capture, leaving the native row text intact.
    try:
        user.SetWindowDisplayAffinity.argtypes = [wintypes.HWND, wintypes.DWORD]
        user.SetWindowDisplayAffinity(hwnd, 0 if config.get('captureOverlay') else 0x11)
    except (AttributeError, OSError):
        pass
    scanner = None
    scanner_error = None
    try:
        from timeline_hover import TimelineScanner
        scanner = TimelineScanner(config.get('timeline'))
    except Exception as exc:
        scanner_error = str(exc)
    commands = queue.Queue()
    def reader():
        for line in sys.stdin:
            try:
                commands.put(json.loads(line))
            except (ValueError, TypeError):
                pass
        commands.put({'stop': True})
    threading.Thread(target=reader, daemon=True).start()
    scale = max(0.5, min(3, float(config.get('scale', 1))))
    ax, ay = float(config['x'])-left, float(config['y'])-top
    x, y, vx, vy = ax, ay, 0., 0.
    MINT, MINT_HI, MINT_DIM, INK = '#92dfc3', '#d9fff0', '#365c4e', '#14211c'

    # drop rings sit under everything else
    rings = [canvas.create_rectangle(0, 0, 0, 0, outline=MINT, width=2*scale, state='hidden') for _ in range(2)]
    row_glow = canvas.create_rectangle(0, 0, 0, 0, outline=MINT_DIM, width=6*scale, state='hidden')
    row_outline = canvas.create_rectangle(0, 0, 0, 0, outline=MINT, width=2*scale, state='hidden')
    accent = canvas.create_rectangle(0, 0, 0, 0, fill=MINT, outline='', state='hidden')
    # scan shimmer: a bright line with a fading trail sweeping along the row
    scan = [canvas.create_line(0, 0, 0, 0, fill=c, width=w*scale, state='hidden')
            for c, w in (('#2e5446', 6), ('#4f8d76', 4), ('#7cc7ab', 2), (MINT_HI, 2))]
    cable_shadow = canvas.create_line(0, 0, 0, 0, fill='#443951', width=5*scale, smooth=True)
    cable = canvas.create_line(0, 0, 0, 0, fill='#baacfa', width=2*scale, smooth=True)
    anchor = canvas.create_oval(ax-3*scale, ay-3*scale, ax+3*scale, ay+3*scale, fill='#bdb4e0', outline='#f6eaff')
    # Rounded floating tile, followed by the dropper symbol.
    tile = canvas.create_polygon(0, 0, 0, 0, fill='#c9b6f2', outline='#efe2ff', width=scale, smooth=True)
    icon = canvas.create_polygon(0, 0, 0, 0, fill='#eadefc', outline='#49335f', width=1.6*scale)
    stripe = canvas.create_line(0, 0, 0, 0, fill='#49335f', width=1.5*scale)
    shine = canvas.create_line(0, 0, 0, 0, fill=MINT, width=2*scale)
    target_bg = canvas.create_rectangle(0, 0, 0, 0, fill='#1d302a', outline='#6da58d', state='hidden')
    target_label = canvas.create_text(0, 0, text='', fill=MINT_HI, font=('Segoe UI Semibold', round(9*scale)), anchor='nw', state='hidden')
    last_hover = None
    last_row = None     # the row under the cursor on the latest frame
    hover_since = 0.
    drop = None         # {'row', 'start', 'label': (x, y)} while the landing animation plays
    started = last = time.monotonic()
    frames = 0
    test_seconds = min(20., max(0., float(config.get('testSeconds', 0))))
    fake_row = config.get('fakeRow')  # tests only: pretend this row is under the cursor

    def finish(reason):
        if scanner:
            scanner.close()
        print(json.dumps({'event': 'closed', 'reason': reason, 'frames': frames,
                          'target': drop['row'] if drop else None}), flush=True)
        root.destroy()

    def local_rect(row, pad=0.):
        l, t, r, b = row['rect']
        return l-left+2-pad, t-top-pad, r-left-2+pad, b-top+pad

    def place_label(text, lx, ly, fg, bg, border):
        canvas.itemconfigure(target_label, text=text, fill=fg, state='normal')
        canvas.coords(target_label, lx+8*scale, ly+5*scale)
        box = canvas.bbox(target_label)
        canvas.itemconfigure(target_bg, fill=bg, outline=border, state='normal')
        canvas.coords(target_bg, box[0]-8*scale, box[1]-5*scale, box[2]+8*scale, box[3]+5*scale)

    def hide(*items):
        for item in items:
            canvas.itemconfigure(item, state='hidden')

    def draw_hover(row, now, tx, ty):
        L, T, R, B = local_rect(row)
        for item in (row_glow, row_outline):
            canvas.itemconfigure(item, state='normal')
            canvas.coords(item, L, T, R, B)
        pulse = .5+.5*math.sin(now*6)
        canvas.itemconfigure(row_outline, outline=mix(MINT, MINT_HI, pulse*.6), width=2*scale)
        canvas.itemconfigure(row_glow, outline=mix(MINT_DIM, '#4f8d76', pulse))
        # accent bar grows in from the left edge when a row is first hovered
        grow = ease_out((now-hover_since)/.25)
        canvas.itemconfigure(accent, state='normal')
        canvas.coords(accent, L, T+(B-T)*(1-grow)/2, L+4*scale, B-(B-T)*(1-grow)/2)
        # shimmer sweeping left to right
        span = max(1., R-L-12*scale)
        sx = L+6*scale+((now-hover_since)*.9 % 1.)*span
        for i, line in enumerate(scan):
            off = (len(scan)-1-i)*5*scale
            canvas.itemconfigure(line, state='normal' if sx-off > L+6*scale else 'hidden')
            canvas.coords(line, sx-off, T+3*scale, sx-off, B-3*scale)
        label_x = max(8, min(width-300*scale, tx+30*scale)); label_y = max(8, min(height-36*scale, ty+30*scale))
        place_label('Drop to use  ' + row['name'][:64], label_x, label_y, MINT_HI, '#1d302a', '#6da58d')

    def draw_drop(now):
        """The pin lands in the row: flash, two rings ripple out, a "Linked" tag."""
        t = (now-drop['start'])/DROP_SECONDS
        row = drop['row']
        L, T, R, B = local_rect(row)
        hide(accent, *scan)
        flash = max(0., 1-t/.35)
        canvas.itemconfigure(row_outline, state='normal', outline=mix(MINT, '#ffffff', flash), width=(2+2*flash)*scale)
        canvas.itemconfigure(row_glow, state='normal', outline=mix(MINT_DIM, MINT, flash*.8))
        canvas.coords(row_outline, L, T, R, B); canvas.coords(row_glow, L, T, R, B)
        for i, ring in enumerate(rings):
            rt = (t-i*.18)/.62
            if rt <= 0 or rt >= 1:
                canvas.itemconfigure(ring, state='hidden'); continue
            g = ease_out(rt)*18*scale
            canvas.itemconfigure(ring, state='normal', outline=mix(MINT_HI, INK, rt), width=max(1, (2.5-1.5*rt)*scale))
            canvas.coords(ring, L-g, T-g, R+g, B+g)
        lx, ly = drop['label']
        place_label('✓  Linked · ' + row['name'][:60], lx, ly, INK, mix(MINT_HI, MINT, min(1, t*2)), MINT_HI)

    def draw_pin(px, py, ps, angle_deg):
        sag = min(90*scale, math.hypot(px-ax, py-ay)*.24)
        points = []
        # Cubic Bezier sampled as a continuous stroke.
        for i in range(25):
            t = i/24; u = 1-t
            points.extend((u*u*u*ax+3*u*u*t*ax+3*u*t*t*px+t*t*t*px,
                           u*u*u*ay+3*u*u*t*(ay+sag)+3*u*t*t*(py+sag)+t*t*t*py))
        canvas.coords(cable_shadow, *points); canvas.coords(cable, *points)
        angle = math.radians(angle_deg)
        s = scale*ps
        def transform(coords):
            result = []
            for qx, qy in coords:
                result.extend((px+s*(qx*math.cos(angle)-qy*math.sin(angle)),
                               py+s*(qx*math.sin(angle)+qy*math.cos(angle))))
            return result
        canvas.coords(tile, *transform([(-12,-22),(12,-22),(22,-12),(22,12),(12,22),(-12,22),(-22,12),(-22,-12)]))
        canvas.coords(icon, *transform([(4,-14),(15,-3),(10,2),(7,-1),(-7,13),(-15,15),(-13,7),(1,-7),(-2,-10)]))
        canvas.coords(stripe, *transform([(-6,5),(1,12)]))
        canvas.coords(shine, *transform([(6,-9),(9,-6)]))
        visible = 'normal' if ps > .03 else 'hidden'
        for item in (tile, icon, stripe, shine):
            canvas.itemconfigure(item, state=visible)

    def tick():
        nonlocal x, y, vx, vy, last, frames, last_hover, last_row, hover_since, drop
        while not commands.empty():
            command = commands.get()
            if command.get('stop'):
                return finish('cancel')
            if 'timeline' in command and scanner:
                scanner.set_snapshot(command['timeline'])
        now = time.monotonic()
        frames += 1

        # --- landing animation (input is no longer read)
        if drop is not None:
            if now-drop['start'] >= DROP_SECONDS:
                return finish('release')
            draw_drop(now)
            # the pin glides into the row's left end and shrinks away
            L, T, R, B = local_rect(drop['row'])
            k = ease_out((now-drop['start'])/.35)
            draw_pin(drop['x']+(L+18*scale-drop['x'])*k, drop['y']+((T+B)/2-drop['y'])*k, max(0., 1-k), 0)
            root.after(16, tick)
            return

        # --- release / cancel
        released = (now-started >= test_seconds) if test_seconds else not (user.GetAsyncKeyState(1) & 0x8000)
        if released:
            if last_row:
                drop = {'row': last_row, 'start': now, 'x': x, 'y': y,
                        'label': canvas.coords(target_label)[:2] if canvas.coords(target_label) else (x, y)}
                if drop['label'] and len(drop['label']) == 2:
                    drop['label'] = (drop['label'][0]-8*scale, drop['label'][1]-5*scale)
                print(json.dumps({'event': 'drop', 'target': last_row}), flush=True)
                root.after(0, tick)
                return
            return finish('test-complete' if test_seconds else 'release')
        if user.GetAsyncKeyState(0x1B) & 0x8000:
            return finish('escape')
        if now-started > 60:
            return finish('timeout')

        # --- hover
        user.GetCursorPos(ctypes.byref(point))
        tx, ty = point.x-left, point.y-top
        if fake_row:
            hovered = dict(fake_row)
            l, t, r, b = hovered['rect']
            tx, ty = l-left+(r-l)*.35, t-top+(b-t)/2
        else:
            hovered = scanner.hit(point.x, point.y) if scanner else None
        key = (hovered['compId'], hovered['layerId']) if hovered else None
        if key != last_hover:
            last_hover = key
            hover_since = now
            print(json.dumps({'event': 'hover', 'target': hovered}), flush=True)
        last_row = hovered
        if hovered:
            draw_hover(hovered, now, tx, ty)
        else:
            hide(row_glow, row_outline, accent, target_bg, target_label, *scan)

        # --- pin follows the cursor on a springy cable
        step = min(2., max(.3, (now-last)*60)); last = now
        vx = (vx+(tx-x)*.18*step)*(.68**step)
        vy = (vy+(ty-y)*.18*step)*(.68**step)
        if config.get('reduced'):
            x, y = tx, ty
        else:
            x += vx*step; y += vy*step
        draw_pin(x, y, 1., max(-22, min(22, vx*1.2)))
        root.after(16, tick)

    print(json.dumps({'event': 'ready', 'hwnd': int(hwnd), 'styles': user.GetWindowLongW(hwnd, -20),
                      'anchor': [ax+left, ay+top], 'desktop': [left, top, width, height],
                      'timelineHover': scanner is not None, 'hoverError': scanner_error}), flush=True)
    root.after(0, tick)
    root.mainloop()


if __name__ == '__main__':
    run(json.loads(sys.argv[1]))
