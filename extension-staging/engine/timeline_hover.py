"""Read-only AE timeline discovery for the desktop pin. No mouse injection."""
import ctypes
from ctypes import wintypes
import json
import asyncio
import re
import statistics
from difflib import SequenceMatcher
import threading
import time
from PIL import ImageGrab, ImageOps
from winrt.windows.media.ocr import OcrEngine
from winrt.windows.graphics.imaging import SoftwareBitmap, BitmapPixelFormat, BitmapAlphaMode
from winrt.windows.storage.streams import DataWriter

user = ctypes.WinDLL('user32', use_last_error=True)
user.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
user.GetAncestor.restype = wintypes.HWND
user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user.IsWindowVisible.argtypes = [wintypes.HWND]
CALLBACK = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user.EnumWindows.argtypes = [CALLBACK, wintypes.LPARAM]
user.EnumChildWindows.argtypes = [wintypes.HWND, CALLBACK, wintypes.LPARAM]
user.GetForegroundWindow.restype = wintypes.HWND
user.GetWindowThreadProcessId.argtypes = [wintypes.HWND,ctypes.POINTER(wintypes.DWORD)]

def pid(hwnd):
    value = wintypes.DWORD()
    user.GetWindowThreadProcessId(hwnd,ctypes.byref(value))
    return value.value

def info(hwnd):
    if not hwnd:
        return {'hwnd':0,'title':'','class':'','rect':[0,0,0,0],'visible':False,'pid':0}
    title, cls = ctypes.create_unicode_buffer(512), ctypes.create_unicode_buffer(256)
    user.GetWindowTextW(hwnd, title, 512)
    user.GetClassNameW(hwnd, cls, 256)
    r = wintypes.RECT()
    user.GetWindowRect(hwnd, ctypes.byref(r))
    return {'hwnd': int(hwnd), 'title': title.value, 'class': cls.value,
            'rect': [r.left, r.top, r.right, r.bottom], 'visible': bool(user.IsWindowVisible(hwnd)), 'pid':pid(hwnd)}

def windows():
    top_windows = []
    @CALLBACK
    def visit(hwnd, _):
        v = info(hwnd)
        if v['visible']:
            top_windows.append(v)
        return True
    user.EnumWindows(visit, 0)
    ae_pids = {v['pid'] for v in top_windows if v['class'].startswith('AE_CApplication_')}
    roots = [v for v in top_windows if v['pid'] in ae_pids and
             (v['class'].startswith('AE_CApplication_') or v['class']=='DroverLord - Window Class')]
    result = []
    for root in roots:
        result.append(root)
        @CALLBACK
        def child(hwnd, _):
            v = info(hwnd)
            if v['visible']:
                v['root'] = root['hwnd']
                result.append(v)
            return True
        user.EnumChildWindows(root['hwnd'], child, 0)
    return result

async def recognize(image):
    # Scale up AE's small UI text; this stays entirely on the local machine.
    factor = min(3, 4000/max(image.width,image.height))
    rgb = image.convert('RGB').resize((round(image.width*factor), round(image.height*factor)))
    writer = DataWriter()
    writer.write_bytes(rgb.tobytes('raw', 'BGRX'))
    bitmap = SoftwareBitmap.create_copy_with_alpha_from_buffer(writer.detach_buffer(), BitmapPixelFormat.BGRA8,
                                                    rgb.width, rgb.height, BitmapAlphaMode.IGNORE)
    engine = OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        raise RuntimeError('Windows OCR language unavailable')
    result = await engine.recognize_async(bitmap)
    lines = []
    for line in result.lines:
        words = []
        for word in line.words:
            r = word.bounding_rect
            words.append({'text': word.text, 'rect': [r.x/factor, r.y/factor,
                                                    (r.x+r.width)/factor, (r.y+r.height)/factor]})
        lines.append({'text': line.text, 'words': words})
    bitmap.close()
    writer.close()
    return lines

def normal(text):
    return ''.join(c for c in text.casefold() if c.isalnum())

def center(word):
    r = word['rect']
    return (r[1]+r[3])/2

def match_rows(lines, image, bounds, panel, snapshot):
    """Match names plus visible index glyphs. Never infer a row from its ordinal."""
    words = [w for line in lines for w in line['words']]
    header = next((line for line in lines if normal(line['text']) in ('layername','sourcename')), None)
    if not header or not snapshot or not snapshot.get('layers'):
        return []
    hw = header['words']
    name_x = min(w['rect'][0] for w in hw)
    header_bottom = max(w['rect'][3] for w in hw)
    header_height = max(w['rect'][3]-w['rect'][1] for w in hw)
    row_height = max(12, min(42, round(header_height*1.76)))
    # The timeline's tab must match the comp read from AE. Locked/other viewers
    # must not be mistaken for the comp whose IDs we have.
    comp_name = normal(snapshot.get('compName',''))
    tab_lines = [normal(' '.join(w['text'] for w in line['words'])) for line in lines
                 if line['words'] and max(w['rect'][3] for w in line['words'])<header_bottom-row_height*1.4]
    def comp_matches(text):
        if text==comp_name:
            return True
        # Small, underlined tabs can lose a few letters to OCR. Names still
        # need a matching numeric suffix; short generic titles require exact OCR.
        numbers = re.findall(r'\d+',comp_name)
        return len(comp_name)>=10 and (not numbers or re.findall(r'\d+',text)==numbers) and SequenceMatcher(None,text,comp_name).ratio()>=.75
    if not comp_name or not any(comp_matches(text) for text in tab_lines):
        return []
    header_y = statistics.mean(center(w) for w in hw)
    parent = [w for w in words if normal(w['text']) == 'parent' and abs(center(w)-header_y)<row_height/2]
    name_right = min([w['rect'][0] for w in parent] or [min(image.width,name_x+450)])
    index_words = [w for w in words if re.fullmatch(r'\d{1,4}', w['text'])
                   and name_x-row_height*2.8 < w['rect'][0] < name_x-row_height*.5
                   and w['rect'][1] > header_bottom]
    index_x = statistics.median((w['rect'][0]+w['rect'][2])/2 for w in index_words) if index_words else name_x-row_height*1.7
    # OCR sometimes drops a single "1". A unique full name is accepted only if
    # an actual numeric glyph is present in the index column on that same row.
    def glyph_present(cy):
        box = (max(0,round(index_x-row_height*.42)),max(0,round(cy-row_height*.31)),
               min(image.width,round(index_x+row_height*.42)),min(image.height,round(cy+row_height*.31)))
        gray = image.crop(box).convert('L')
        values = sorted(gray.get_flattened_data())
        if len(values)<20 or values[-1]-values[0]<35:
            return False
        bg = values[len(values)//2]
        ink = sum(abs(v-bg)>30 for v in values)
        return 3 <= ink <= len(values)*.55
    rows = []
    for line in lines:
        name_words = [w for w in line['words'] if name_x+row_height*.65 <= w['rect'][0] < name_right
                      and w['rect'][1] > header_bottom]
        if not name_words:
            continue
        # A clipped name is deliberately not enough to choose a source.
        text = normal(' '.join(w['text'] for w in name_words))
        if len(text)<3:
            continue
        matching = [layer for layer in snapshot['layers'] if text in
                    {normal(layer['name']),normal(layer.get('sourceName',''))}]
        if not matching:
            continue
        cy = min(w['rect'][1] for w in name_words)+header_height/2
        digits = [w for w in index_words if abs(center(w)-cy)<row_height*.4]
        if digits:
            matching = [layer for layer in matching if layer['index']==int(digits[0]['text'])]
            cy = center(digits[0])
        elif not glyph_present(cy):
            continue
        # Compare against ALL layers, including non-audio duplicate names.
        if len(matching)!=1 or not matching[0].get('hasAudio'):
            continue
        l,t,r,b = panel['rect']
        screen_y = bounds[1]+cy
        if screen_y-row_height/2 < t or screen_y+row_height/2 > b-10:
            continue
        rows.append({'rect':[l,round(screen_y-row_height/2),r-16,round(screen_y+row_height/2)],
                     'name':matching[0]['name'],'compId':snapshot['compId'],
                     'layerId':matching[0]['layerId'],'root':panel['root'],'hwnd':panel['hwnd'],
                     'panelRect':panel['rect'],'pid':panel['pid']})
    return rows

class TimelineScanner:
    """Only alive while the pin is dragged. OCR runs off the animation thread."""
    def __init__(self, snapshot=None):
        self.snapshot = snapshot
        self.rows = []
        self.updated = 0
        self.error = None
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def set_snapshot(self, snapshot):
        self.snapshot = snapshot
        self.rows = []
        self.updated = 0

    def scan(self):
        snapshot = self.snapshot
        if not snapshot:
            return []
        out = []
        # Enumerate native docked AND floating panel bounds anew, so resizing,
        # scrolling, different workspaces, and multi-monitor layouts can update.
        for panel in windows():
            l,t,r,b = panel['rect']
            if panel['title']!='DroverLord - TabPanel Window' or r-l<230 or b-t<70:
                continue
            foreground = info(user.GetForegroundWindow())
            if foreground['pid']!=panel['pid'] or not (foreground['class'].startswith('AE_CApplication_') or foreground['class']=='DroverLord - Window Class'):
                continue
            bounds = (l,t-26,min(r,l+900),min(b,t+70))
            image = ImageGrab.grab(bbox=bounds,all_screens=True)
            lines = asyncio.run(recognize(image))
            if not any(normal(line['text']) in ('layername','sourcename') for line in lines):
                continue
            # Full visible layer-name column, including expanded properties.
            bounds = (l,t-26,min(r,l+900),b-16)
            image = ImageGrab.grab(bbox=bounds,all_screens=True)
            lines = asyncio.run(recognize(image))
            out.extend(match_rows(lines,image,bounds,panel,snapshot))
        return out

    def _loop(self):
        while not self.closed.is_set():
            started = time.monotonic()
            try:
                rows = self.scan()
                self.rows = rows
                self.updated = time.monotonic()
            except Exception as exc:
                self.rows = []
                self.error = str(exc)
            self.closed.wait(max(.05,.35-(time.monotonic()-started)))

    def hit(self,x,y):
        if time.monotonic()-self.updated>.8:
            return None
        for row in self.rows:
            l,t,r,b = row['rect']
            if l <= x <= r and t <= y <= b:
                # A different app, modal, or moved panel cancels the hit.
                foreground = info(user.GetForegroundWindow())
                if foreground['pid']!=row['pid'] or not (foreground['class'].startswith('AE_CApplication_') or foreground['class']=='DroverLord - Window Class'):
                    return None
                if info(row['hwnd'])['rect'] != row['panelRect']:
                    return None
                return row
        return None

    def close(self):
        self.closed.set()

if __name__ == '__main__':
    import sys
    try:
        user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except (AttributeError,OSError):
        pass
    scanner = TimelineScanner(json.loads(sys.argv[1]))
    scanner.close()
    print(json.dumps(scanner.scan(), indent=2))
