import json, math, sys
from px import *
from qglyph import qmark
SX, SY, SW, SH, SR = 400, 52, 104, 74, 12
Q = qmark(); GX, GY = 452 - 11, SY + (SH - len(Q)) // 2
def inside_screen(x, y, inset=2):
    if not (SX + inset <= x < SX + SW - inset and SY + inset <= y < SY + SH - inset): return False
    for cx, cy in [(SX + SR, SY + SR), (SX + SW - SR - 1, SY + SR), (SX + SR, SY + SH - SR - 1), (SX + SW - SR - 1, SY + SH - SR - 1)]:
        if (x < SX + SR and cx == SX + SR or x > SX + SW - SR - 1 and cx != SX + SR) and \
           (y < SY + SR and cy == SY + SR or y > SY + SH - SR - 1 and cy != SY + SR):
            if math.hypot(x - cx, y - cy) > SR - inset: return False
    return True
glyph = {(GX + i, GY + j) for j, r in enumerate(Q) for i, c in enumerate(r) if c != '.'}
near1, near2 = [], []
for y in range(SY, SY + SH):
    for x in range(SX, SX + SW):
        if (x, y) in glyph or not inside_screen(x, y): continue
        d = min(max(abs(x - a), abs(y - b)) for a, b in glyph) if any(abs(x - a) <= 4 and abs(y - b) <= 4 for a, b in glyph) else 99
        if d <= 2: near1.append((x, y))
        elif d <= 4 and (x + y) % 2 == 0: near2.append((x, y))
layer('screen glow')
pixels_path(near2, '#4a3034', 'bloom outer')
pixels_path(near1, '#6e4630', 'bloom inner')
sprite(Q, GX, GY, {'o': '#ffe08a', 'a': '#ffb547', 'd': '#d98a2b'}, 'glyph')
# scanlines over everything on the glass
lines = [(x, y) for y in range(SY + 3, SY + SH - 2, 2) for x in range(SX, SX + SW) if inside_screen(x, y)]
pixels_path(lines, '#120c11', 'scanlines'); opacity(0.35)
# glass glare, upper left
layer('glare')
cmd('select.lasso', points=[[SX + 5, SY + 20], [SX + 20, SY + 3], [SX + 27, SY + 3], [SX + 9, SY + 23]], antiAlias=False)
fill('#ffffff'); opacity(0.10)
cmd('select.deselect')
# LED and vent slits on the shell
layer('head details')
X, Y, Wd, Ht = 388, 40, 128, 106
sel_rect(X + Wd - 16, Y + Ht - 12, 4, 3); fill('#ffb547')
sel_rect(X + Wd - 16, Y + Ht - 12, 2, 1); fill('#fff3b0')
for i in range(3):
    sel_rect(X + 12 + i * 6, Y + Ht - 11, 4, 1); fill('#c9ad85')
    sel_rect(X + 12 + i * 6, Y + Ht - 10, 4, 1); fill('#fffaf0')
cmd('select.deselect')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
