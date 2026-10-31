# Shared Bubie header-banner template: halo, hoodie bust, CRT head and a screen icon.
# Every pixel is a hard-edged selection fill or an integer-aligned shape in PhotoCraft.
import math
from px import *
from sprites import Grid
W, H = 640, 250
HX, HY = 452, 98
X, Y, WD, HT, R = 388, 40, 128, 106, 20
SX, SY, SW, SH, SR = 400, 52, 104, 74, 12

def merged_sprite(rows, x, y, legend, name):
    """Stamp a sprite and fold its colour layers into the active layer below."""
    for ch, color in legend.items():
        p = runs_path(rows, x, y, ch)
        if p['subpaths']:
            cmd('shape.create', kind='path', name=f'{name} {ch}', fill=color, path=p)
            cmd('shape.rasterize'); cmd('layer.mergeDown')
def merged_pixels(points, color, name):
    pts = list(points)
    for k in range(0, len(pts), 1000):
        subs = [{'closed': True, 'knots': [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]} for x, y in pts[k:k + 1000]]
        cmd('shape.create', kind='path', name=name, fill=color, path={'subpaths': subs})
        cmd('shape.rasterize'); cmd('layer.mergeDown')

def new_doc(name):
    cmd('file.new', width=W, height=H, background='transparent', name=name)

def halo(bands, ray, rim):
    layer('halo')
    for r, c in zip((142, 118, 92), bands):
        sel_ellipse(HX - r, HY - r, 2 * r, 2 * r); fill(c)
    all_ = chan('halo')
    sel_ellipse(HX - 142, HY - 142, 284, 284); cmd('select.saveSelection', name=all_)
    for i in range(20):
        a0 = i / 20 * 2 * math.pi; a1 = a0 + math.pi / 34
        pts = [[HX, HY], [HX + 160 * math.cos(a0), HY + 160 * math.sin(a0)], [HX + 160 * math.cos(a1), HY + 160 * math.sin(a1)]]
        cmd('select.lasso', points=pts, mode='replace' if i == 0 else 'add', antiAlias=False)
    cmd('select.loadSelection', channel=all_, operation='intersect')
    fill(ray)
    cmd('select.deselect')
    d1 = [(x, y) for y in range(0, H) for x in range(HX - 160, HX + 160)
          if (x + y) % 2 == 0 and 142 <= math.hypot(x + 0.5 - HX, y + 0.5 - HY) < 150]
    d2 = [(x, y) for y in range(0, H) for x in range(HX - 170, HX + 170)
          if x % 2 == 0 and y % 2 == 0 and 150 <= math.hypot(x + 0.5 - HX, y + 0.5 - HY) < 158]
    merged_pixels(d1, rim, 'rim'); merged_pixels(d2, rim, 'rim2')
    opacity(0.5)

def outlined(select_fn, body):
    select_fn()
    c = chan('obj')
    cmd('select.saveSelection', name=c)
    cmd('select.modify.expand', radius=1, applyAtCanvasBounds=True)
    fill(CHOC)
    cmd('select.loadSelection', channel=c)
    fill(body)

def hoodie(color='#34303a', light='#403b48', rim='#4b4654', shade='#29262e', strings='#f4bf69'):
    layer('hoodie')
    torso = [[338, 251], [344, 214], [358, 192], [384, 178], [412, 172], [492, 172], [520, 178], [546, 192], [560, 214], [566, 251]]
    ts = lambda: cmd('select.lasso', points=torso, antiAlias=False)
    outlined(ts, color)
    ts(); sel_rect(338, 170, 46, 81, 'intersect'); fill(light)
    cmd('select.lasso', points=[[346, 212], [358, 193], [384, 179], [412, 173], [412, 176], [386, 182], [361, 196], [349, 214]], antiAlias=False); fill(rim)
    ts(); sel_rect(522, 170, 46, 81, 'intersect'); fill(shade)
    cmd('select.lasso', points=[[394, 251], [400, 236], [504, 236], [510, 251]], antiAlias=False)
    pk = chan('pk'); cmd('select.saveSelection', name=pk); cmd('select.modify.expand', radius=1); fill('#25222a')
    cmd('select.loadSelection', channel=pk); fill('#383340')
    sel_rect(402, 237, 100, 1); fill('#46414e')
    hs = lambda: sel_rrect(392, 150, 120, 30, 15)
    outlined(hs, '#3e3945')
    hs(); sel_rect(392, 150, 120, 7, 'intersect'); fill('#4d4857')
    hs(); sel_rect(392, 172, 120, 8, 'intersect'); fill('#302c36')
    for x in (414, 452, 490):
        for i in range(6): sel_rect(x + (i // 3), 160 + i, 1, 1); fill('#2a2730')
    for (x0, x1) in [(438, 432), (466, 472)]:
        for y in range(178, 222):
            x = round(x0 + (x1 - x0) * (y - 178) / 44)
            sel_rect(x, y, 2, 1); fill(strings)
            sel_rect(x + 1, y, 1, 1); fill('#d9a04a')
        sel_rect(x1 - 1, 221, 4, 6); fill(CHOC)
        sel_rect(x1, 222, 2, 4); fill('#c98a3a')
    cmd('select.deselect')

def head():
    layer('head')
    rrect(X + 7, Y + 5, WD + 2, HT + 2, R + 1, CHOC)
    rrect(X - 1, Y - 1, WD + 2, HT + 2, R + 1, CHOC)
    rrect(X + 8, Y + 6, WD, HT, R, '#c9ad85')
    rrect(X, Y, WD, HT, R, '#f4e6cc')
    sel_rrect(X, Y, WD, HT, R); sel_rect(X, Y, WD, 14, 'intersect'); fill('#fffaf0')
    sel_rrect(X, Y, WD, HT, R); sel_rect(X, Y + 14, 5, HT - 30, 'intersect'); fill('#fbf3e3')
    sel_rrect(X, Y, WD, HT, R); sel_rect(X, Y + HT - 10, WD, 10, 'intersect'); fill('#e6d3b2')
    sel_rrect(X, Y, WD, HT, R); sel_rect(X + WD - 5, Y + 16, 5, HT - 26, 'intersect'); fill('#ecdcbf')
    rrect(SX - 1, SY - 1, SW + 3, SH + 3, SR + 1, '#fffaf0')
    rrect(SX - 2, SY - 2, SW + 3, SH + 3, SR + 1, '#c4a77e')
    rrect(SX - 1, SY - 1, SW + 2, SH + 2, SR + 1, CHOC)
    rrect(SX, SY, SW, SH, SR, '#2b2029')
    sel_rrect(SX, SY, SW, SH, SR); sel_rect(SX, SY, SW, 22, 'intersect'); fill('#33283a')
    sel_rrect(SX, SY, SW, SH, SR); sel_rect(SX, SY + SH - 12, SW, 12, 'intersect'); fill('#241b23')
    # LED and vents
    sel_rect(X + WD - 16, Y + HT - 12, 4, 3); fill('#ffb547')
    sel_rect(X + WD - 16, Y + HT - 12, 2, 1); fill('#fff3b0')
    for i in range(3):
        sel_rect(X + 12 + i * 6, Y + HT - 11, 4, 1); fill('#c9ad85')
        sel_rect(X + 12 + i * 6, Y + HT - 10, 4, 1); fill('#fffaf0')
    cmd('select.deselect')

def inside_screen(x, y, inset=2):
    if not (SX + inset <= x < SX + SW - inset and SY + inset <= y < SY + SH - inset): return False
    for cx, cy in [(SX + SR, SY + SR), (SX + SW - SR - 1, SY + SR), (SX + SR, SY + SH - SR - 1), (SX + SW - SR - 1, SY + SH - SR - 1)]:
        inx = x < SX + SR if cx == SX + SR else x > SX + SW - SR - 1
        iny = y < SY + SR if cy == SY + SR else y > SY + SH - SR - 1
        if inx and iny and math.hypot(x - cx, y - cy) > SR - inset: return False
    return True

def shade(mask):
    """Mask rows ('#' filled) to o/a/d: light on top-left edges, shade on bottom-right."""
    h, w = len(mask), len(mask[0])
    on = lambda x, y: 0 <= x < w and 0 <= y < h and mask[y][x] != '.'
    out = []
    for y in range(h):
        row = ''
        for x in range(w):
            if not on(x, y): row += '.'
            elif not on(x, y - 1) or not on(x - 1, y): row += 'o'
            elif not on(x, y + 1) or not on(x + 1, y): row += 'd'
            else: row += 'a'
        out.append(row)
    return out

def screen_icon(rows, dy=0):
    """Amber phosphor icon centred on the CRT, with dithered bloom, scanlines and glare."""
    gw, gh = len(rows[0]), len(rows)
    gx, gy = 452 - gw // 2, SY + (SH - gh) // 2 + dy
    glyph = {(gx + i, gy + j) for j, r in enumerate(rows) for i, c in enumerate(r) if c != '.'}
    near1, near2 = [], []
    for y in range(SY, SY + SH):
        for x in range(SX, SX + SW):
            if (x, y) in glyph or not inside_screen(x, y): continue
            d = min((max(abs(x - a), abs(y - b)) for a, b in glyph if abs(x - a) <= 5 and abs(y - b) <= 5), default=99)
            if d <= 2: near1.append((x, y))
            elif d <= 5 and (x + y) % 2 == 0: near2.append((x, y))
    layer('screen')
    lines = [(x, y) for y in range(SY + 3, SY + SH - 2, 2) for x in range(SX, SX + SW) if inside_screen(x, y) and (x, y) not in glyph]
    merged_pixels(near2, '#4f3233', 'bloom outer')
    merged_pixels(near1, '#7a4c2e', 'bloom inner')
    merged_sprite(rows, gx, gy, {'o': '#fff0b8', 'a': '#ffbd52', 'd': '#e08f2c'}, 'icon')
    layer('scanlines')
    merged_pixels(lines, '#1a1219', 'scan')
    opacity(0.5)
    layer('glare')
    cmd('select.lasso', points=[[SX + 5, SY + 20], [SX + 20, SY + 3], [SX + 27, SY + 3], [SX + 9, SY + 23]], antiAlias=False)
    fill('#ffffff'); opacity(0.10)
    cmd('select.deselect')

def cast_layer(): layer('cast')

def bubble_grid(w, h, r, tail, light_rows=4):
    from sprites import in_rrect
    g = Grid(w + 16, h + 16)
    for y in range(h):
        for x in range(w):
            if in_rrect(x, y, w, h, r):
                g.set(x + 2, y + 2, 'l' if y < light_rows else 's' if y >= h - 3 else 'f')
    for (x, y, wd) in tail:
        for i in range(wd): g.set(x + 2 + i, y + 2, 's' if y >= h - 3 else 'f')
    return g

SPARK7 = ['...a...', '...a...', '..aba..', 'aabcbaa', '..aba..', '...a...', '...a...']
SPARK5 = ['..a..', '.aba.', 'abcba', '.aba.', '..a..']
def sparkles(points, gold=('#f0b04c', '#ffe08a', '#ffffff')):
    for (x, y, big) in points:
        merged_sprite(SPARK7 if big else SPARK5, x, y, {'a': gold[0], 'b': gold[1], 'c': gold[2]}, 'spark')

def disc(cx, cy, r):
    return lambda x, y: math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r
def mask(w, h, inside):
    return [''.join('#' if inside(x, y) else '.' for x in range(w)) for y in range(h)]
