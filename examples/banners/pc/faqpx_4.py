import json, math, sys
from px import *
from qglyph import qmark
for lid in range(28, 38): cmd('layer.delete', layer=lid)
for lid in [20, 21, 22, 23, 24, 25]: cmd('layer.setProps', layer=lid, opacity=0.6)
# ---- hoodie bust, between the halo and the head ---------------------------
cmd('layer.select', layer=26)
layer('hoodie')
cmd('layer.delete', layer=26)
cmd('layer.select', layer=27)
def outlined(select_steps, body):
    for s in select_steps: steps.append(s)
    cmd('select.saveSelection', name='_obj')
    cmd('select.modify.expand', radius=1, applyAtCanvasBounds=True)
    fill(CHOC)
    cmd('select.loadSelection', channel='_obj')
    fill(body)
def lasso(pts, mode='replace'): return {'id': 'select.lasso', 'params': {'points': pts, 'mode': mode, 'antiAlias': False}}
torso = [[364, 251], [372, 204], [386, 182], [410, 166], [494, 166], [518, 182], [532, 204], [540, 251]]
outlined([lasso(torso)], '#34303a')
# light on the left shoulder, shade on the right
cmd('select.lasso', points=torso, antiAlias=False); sel_rect(364, 160, 44, 91, 'intersect'); fill('#423d4a')
cmd('select.lasso', points=torso, antiAlias=False); sel_rect(500, 160, 44, 91, 'intersect'); fill('#28252d')
# hood rolled around the neck
outlined([{'id': 'select.rect', 'params': {'x': 396, 'y': 132, 'width': 112, 'height': 48, 'ellipse': True, 'antiAlias': False}}], '#3d3843')
sel_ellipse(404, 150, 96, 26); fill('#2b2830')                     # neck opening shadow
sel_ellipse(396, 132, 112, 48); sel_rect(396, 132, 112, 10, 'intersect'); fill('#4a4552')
# drawstrings with aglets
for (x0, x1) in [(438, 434), (466, 470)]:
    for y in range(172, 214):
        x = round(x0 + (x1 - x0) * (y - 172) / 42)
        sel_rect(x, y, 2, 1); fill('#f4bf69')
    sel_rect(x1 - 1, 213, 4, 5); fill(CHOC)
    sel_rect(x1, 214, 2, 3); fill('#c98a3a')
# shoulder fold lines
for (x, y, dx) in [(392, 196, -1), (512, 196, 1)]:
    for i in range(14):
        sel_rect(x + dx * (i // 2), y + i, 1, 1); fill('#25222a')
cmd('select.deselect')
# ---- bigger glowing "?" -----------------------------------------------------
cmd('layer.select', layer=27)
SX, SY, SW, SH, SR = 400, 52, 104, 74, 12
Q = qmark(1.25)
blank = [i for i, r in enumerate(Q) if set(r) == {'.'}]
for i in blank[:2]: Q.pop(blank[0])
Q = [r for r in Q]
GX, GY = 452 - len(Q[0]) // 2, SY + (SH - len(Q)) // 2
def inside_screen(x, y, inset=2):
    if not (SX + inset <= x < SX + SW - inset and SY + inset <= y < SY + SH - inset): return False
    for cx, cy in [(SX + SR, SY + SR), (SX + SW - SR - 1, SY + SR), (SX + SR, SY + SH - SR - 1), (SX + SW - SR - 1, SY + SH - SR - 1)]:
        inx = x < SX + SR if cx == SX + SR else x > SX + SW - SR - 1
        iny = y < SY + SR if cy == SY + SR else y > SY + SH - SR - 1
        if inx and iny and math.hypot(x - cx, y - cy) > SR - inset: return False
    return True
glyph = {(GX + i, GY + j) for j, r in enumerate(Q) for i, c in enumerate(r) if c != '.'}
near1, near2 = [], []
for y in range(SY, SY + SH):
    for x in range(SX, SX + SW):
        if (x, y) in glyph or not inside_screen(x, y): continue
        d = min((max(abs(x - a), abs(y - b)) for a, b in glyph if abs(x - a) <= 5 and abs(y - b) <= 5), default=99)
        if d <= 2: near1.append((x, y))
        elif d <= 5 and (x + y) % 2 == 0: near2.append((x, y))
layer('screen glow')
lines = [(x, y) for y in range(SY + 3, SY + SH - 2, 2) for x in range(SX, SX + SW) if inside_screen(x, y) and (x, y) not in glyph]
pixels_path(lines, '#1a1219', 'scanlines'); opacity(0.5)
pixels_path(near2, '#4f3233', 'bloom outer')
pixels_path(near1, '#7a4c2e', 'bloom inner')
sprite(Q, GX, GY, {'o': '#fff0b8', 'a': '#ffbd52', 'd': '#e08f2c'}, 'glyph')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
