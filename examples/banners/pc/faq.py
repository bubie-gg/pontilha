import json, math, sys
from pcgen import *
W, H = 1280, 500
HX, HY = 904, 228
cmd('file.new', width=W, height=H, background='transparent', name='banner-faq')
# ---- light -----------------------------------------------------------------
shape('ellipse', 'halo', grad('#ffe7b0', '#f4bf69', 0, 'radial'), rect=[HX - 300, HY - 300, 600, 600])
blur(24); opacity(0.55)
wedges = []
for i in range(24):
    a0 = (i / 24) * 2 * math.pi; a1 = a0 + math.pi / 40
    wedges.append([[HX, HY], [HX + 290 * math.cos(a0), HY + 290 * math.sin(a0)], [HX + 290 * math.cos(a1), HY + 290 * math.sin(a1)]])
shape('path', 'rays', '#fff6dc', path=path(wedges)); blur(3); opacity(0.5)
dots = []
for y in range(HY - 320, HY + 320, 8):
    for x in range(HX - 320, HX + 320, 8):
        r = math.hypot(x + 4 - HX, y + 4 - HY)
        if 286 <= r <= 314 and ((x // 8) + (y // 8)) % 2 == 0 and -8 < y < H:
            dots.append([[x, y], [x + 8, y], [x + 8, y + 8], [x, y + 8]])
shape('path', 'dither ring', '#f4bf69', path=path(dots)); opacity(0.45)
shape('ellipse', 'key shadow', CHOC, rect=[784, 382, 240, 40]); blur(10); opacity(0.22)
# ---- keycap ------------------------------------------------------------------
KX, KY, KW, KH = 792, 110, 224, 210
shape('roundedRect', 'key lip', '#c98a3a', ol(), rect=[KX, KY + 22, KW, KH], radii=42)
shape('roundedRect', 'key face', grad('#ffd98f', '#eba64c', -90), ol(), rect=[KX, KY, KW, KH], radii=42)
shape('roundedRect', 'key sheen', '#fff3d1', rect=[KX + 18, KY + 10, KW - 36, 64], radii=30); opacity(0.5)
shape('rect', 'key glint', '#fffaf0', rect=[KX + 28, KY + 22, 14, 14])
shape('rect', 'key glint 2', '#fffaf0', rect=[KX + 48, KY + 22, 9, 9])
Q = ['..XXXXX..',
     '.XXXXXXX.',
     'XXX...XXX',
     'XXX...XXX',
     '......XXX',
     '.....XXX.',
     '...XXXX..',
     '...XXX...',
     '...XXX...',
     '.........',
     '...XXX...',
     '...XXX...']
S = 12; GX = KX + KW // 2 - (9 * S) // 2; GY = KY + KH // 2 - (12 * S) // 2
shape('path', 'glyph drop', '#c98a3a', path=blocks(dilate(Q), GX - S + 8, GY - S + 10, S, 'X'))
shape('path', 'glyph line', CHOC, path=blocks(dilate(Q), GX - S, GY - S, S, 'X'))
shape('path', 'glyph', CREAM, path=blocks(Q, GX, GY, S, 'X'))
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
