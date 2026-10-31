# Generates the Pontilha recipe for the FAQ header banner (320x125 native, shown at 2x).
import json, sys
W, H = 320, 125
CX, TOP, BASE = 236, 22, 58   # back room corner: x, wall top y, wall bottom y
OUT = '#231a24'
steps = []
def cmd(i, **p): steps.append({'id': i, 'params': p})
def poly(pts, color, **kw): cmd('draw.polygon', points=pts, color=color, **kw)
def line(x0, y0, x1, y1, color, **kw): cmd('draw.line', x0=x0, y0=y0, x1=x1, y1=y1, color=color, **kw)

# ---- room shell ----------------------------------------------------------
cmd('doc.new', width=W, height=H, name='banner-faq')
cmd('palette.set', colors=[OUT, '#3d2a3a', '#fffaf0', '#f3e6cf', '#dcc6a3', '#b39575',
    '#fff3b0', '#ffd66b', '#f4bf69', '#d9902f', '#a65a26',
    '#bff3ea', '#8fe0d6', '#5fbdb7', '#3f8f93', '#2a5f6b',
    '#e8b27a', '#d0925a', '#a86b3f', '#7a4a2e', '#ff8fa3', '#e3566f', '#a83252'])
cmd('layer.setProps', name='floor')
# floor: everything below the two wall bases
poly([[0, BASE + CX // 2], [CX, BASE], [W, BASE + (W - CX) // 2], [W, H], [0, H]], '#d0925a')
# planks run along the right wall direction (2:1, rising to the right)
for k in range(-40, 200, 7):
    line(0, BASE + CX // 2 + k, W, BASE + CX // 2 + k - W // 2, '#b97c45', onlyOn='#d0925a')
# plank end seams, staggered
for i, (x, y) in enumerate([(150, 101), (190, 92), (230, 84), (262, 94), (210, 112), (280, 108), (120, 117), (300, 80)]):
    line(x, y, x + 1, y + 2, '#a86b3f', onlyOn='#d0925a')
# light from the window side: lighter boards near the back
poly([[CX - 60, BASE + 30], [CX, BASE], [CX + 70, BASE + 35], [CX + 10, BASE + 65]], '#dfa56b', onlyOn='#d0925a')

cmd('layer.new', name='walls')
# left wall (lit) and right wall (shade)
poly([[0, TOP + CX // 2], [CX, TOP], [CX, BASE], [0, BASE + CX // 2]], '#5fbdb7')
poly([[CX, TOP], [W, TOP + (W - CX) // 2], [W, BASE + (W - CX) // 2], [CX, BASE]], '#3f8f93')
# wallpaper: vertical pinstripes with a small diamond every other stripe
for x in range(CX - 6, 0, -8):
    yt = TOP + (CX - x) // 2 + 3; yb = BASE + (CX - x) // 2 - 3
    line(x, yt, x, yb, '#72cbc4', onlyOn='#5fbdb7')
for x in range(CX + 6, W, 8):
    yt = TOP + (x - CX) // 2 + 3; yb = BASE + (x - CX) // 2 - 3
    line(x, yt, x, yb, '#4a9da0', onlyOn='#3f8f93')
# skirting board along both bases
poly([[0, BASE + CX // 2 - 3], [CX, BASE - 3], [CX, BASE], [0, BASE + CX // 2]], '#f3e6cf')
poly([[CX, BASE - 3], [W, BASE + (W - CX) // 2 - 3], [W, BASE + (W - CX) // 2], [CX, BASE]], '#dcc6a3')
# wall caps (thickness seen from above)
poly([[0, TOP + CX // 2 - 3], [CX, TOP - 3], [CX, TOP], [0, TOP + CX // 2]], '#fffaf0')
poly([[CX, TOP - 3], [W, TOP + (W - CX) // 2 - 3], [W, TOP + (W - CX) // 2], [CX, TOP]], '#f3e6cf')
# corner seam
line(CX, TOP - 3, CX, BASE, '#2f7a7e')
json.dump(steps, open(sys.argv[1], 'w'), indent=0)
print(len(steps), 'steps')
