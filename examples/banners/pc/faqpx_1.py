import json, math, sys
from px import *
W, H = 640, 250
HX, HY = 452, 98
cmd('file.new', width=W, height=H, background='transparent', name='banner-faq-pixel')
# ---- halo: banded discs, sunburst, dithered rim ---------------------------
layer('halo')
for r, c in [(142, '#f8e3b9'), (118, '#f6d79d'), (92, '#f4cb84')]:
    sel_ellipse(HX - r, HY - r, 2 * r, 2 * r); fill(c)
cmd('select.saveSelection', name='halo_disc')
sel_ellipse(HX - 142, HY - 142, 284, 284)
cmd('select.saveSelection', name='halo_all', operation='replace')
wedges = []
for i in range(20):
    a0 = i / 20 * 2 * math.pi; a1 = a0 + math.pi / 34
    pts = [[HX, HY], [HX + 160 * math.cos(a0), HY + 160 * math.sin(a0)], [HX + 160 * math.cos(a1), HY + 160 * math.sin(a1)]]
    cmd('select.lasso', points=pts, mode='replace' if i == 0 else 'add', antiAlias=False)
cmd('select.loadSelection', channel='halo_all', operation='intersect')
fill('#fbecc9')
dots = [(x, y) for y in range(0, H) for x in range(HX - 160, HX + 160)
        if (x + y) % 2 == 0 and 142 <= math.hypot(x + 0.5 - HX, y + 0.5 - HY) < 150]
pixels_path(dots, '#f8e3b9', 'halo dither')
dots2 = [(x, y) for y in range(0, H) for x in range(HX - 170, HX + 170)
         if (x % 2 == 0 and y % 2 == 0) and 150 <= math.hypot(x + 0.5 - HX, y + 0.5 - HY) < 158]
pixels_path(dots2, '#f8e3b9', 'halo dither 2')
cmd('select.deselect')
# ---- floor shadow ------------------------------------------------------------
layer('shadow')
sel_ellipse(398, 196, 116, 12); fill('#c9a26f')
sel_ellipse(412, 198, 88, 8); fill('#b98f5c')
# ---- head ---------------------------------------------------------------------
layer('head')
X, Y, Wd, Ht, R = 388, 40, 128, 106, 20
rrect(X + 7, Y + 5, Wd + 2, Ht + 2, R + 1, CHOC)          # side outline
rrect(X - 1, Y - 1, Wd + 2, Ht + 2, R + 1, CHOC)          # shell outline
rrect(X + 8, Y + 6, Wd, Ht, R, '#c9ad85')                  # side / back of the monitor
rrect(X, Y, Wd, Ht, R, '#f4e6cc')                          # shell
# light from the top-left: lit cap and left edge, shaded bottom band
sel_rrect(X, Y, Wd, Ht, R); sel_rect(X, Y, Wd, 14, 'intersect'); fill('#fffaf0')
sel_rrect(X, Y, Wd, Ht, R); sel_rect(X, Y + 14, 5, Ht - 30, 'intersect'); fill('#fbf3e3')
sel_rrect(X, Y, Wd, Ht, R); sel_rect(X, Y + Ht - 10, Wd, 10, 'intersect'); fill('#e6d3b2')
sel_rrect(X, Y, Wd, Ht, R); sel_rect(X + Wd - 5, Y + 16, 5, Ht - 26, 'intersect'); fill('#ecdcbf')
# screen recess: light lower-right lip, dark upper-left lip, then the glass
SX, SY, SW, SH, SR = X + 12, Y + 12, Wd - 24, Ht - 32, 12
rrect(SX - 1, SY - 1, SW + 3, SH + 3, SR + 1, '#fffaf0')
rrect(SX - 2, SY - 2, SW + 3, SH + 3, SR + 1, '#c4a77e')
rrect(SX - 1, SY - 1, SW + 2, SH + 2, SR + 1, CHOC)
rrect(SX, SY, SW, SH, SR, '#2b2029')
sel_rrect(SX, SY, SW, SH, SR); sel_rect(SX, SY, SW, 22, 'intersect'); fill('#33283a')
sel_rrect(SX, SY, SW, SH, SR); sel_rect(SX, SY + SH - 12, SW, 12, 'intersect'); fill('#241b23')
cmd('select.deselect')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
