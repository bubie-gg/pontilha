import json, math, random, sys
from scene import *
cmd('layer.delete', layer=959)
layer('launch')
# smoke column: puffs that swell and drift as they fall behind the rocket
pts = []
t = 0.0
while t <= 1.0:
    x = 368 + 62 * t + 14 * math.sin(t * 3.2); y = 242 - 176 * t
    r = 12 - 9 * t
    pts.append((x, y, r)); t += max(0.035, r * 0.75 / 190)
for (x, y, r) in pts:
    R = max(2, round(r))
    sel_ellipse(round(x - R), round(y - R), 2 * R, 2 * R); fill('#9f92c6')
    sel_ellipse(round(x - R) - 1, round(y - R) - 2, 2 * R, 2 * R)
    sel_ellipse(round(x - R), round(y - R), 2 * R, 2 * R, 'intersect'); fill('#d9d1ec')
    if R >= 4:
        sel_ellipse(round(x - R) + 2, round(y - R) + 1, R, R // 2 + 1); fill('#f4f0fb')
cmd('select.deselect')
# exhaust flame and the rocket
ROCKET = ['......kk......',
          '.....kwwk.....',
          '....kwwwwk....',
          '...kwwwwwwk...',
          '...kwwbbwwk...',
          '...kwbbbbwk...',
          '...kwwbbwwk...',
          '...kwwwwwwk...',
          '...kwwwwwwk...',
          '..kkwwwwwwkk..',
          '.kpkwwwwwwkpk.',
          'kppkwwwwwwkppk',
          'kppkkwwwwkkppk',
          'kkk.kffffk.kkk',
          '....kfyyfk....',
          '.....kffk.....',
          '......kk......']
merged_sprite(ROCKET, 427, 44, {'k': '#0f0c1c', 'w': '#fff8ea', 'b': '#5fbdb7', 'p': '#ff8fa3', 'f': '#ff9f3a', 'y': '#ffe08a'}, 'rocket')
def burst(cx, cy, r, colors):
    pts = {c: [] for c in colors}
    for i in range(16):
        a = i / 16 * 2 * math.pi
        for d in range(r // 3, r + 1):
            if d % 3 == 0: continue
            pts[colors[0] if d < r * 0.6 else colors[1]].append((round(cx + d * math.cos(a)), round(cy + d * math.sin(a))))
    for c, p in pts.items(): merged_pixels(p, c, 'firework')
burst(330, 60, 18, ['#ffd66b', '#ff8fa3'])
burst(510, 100, 14, ['#bff3ea', '#5fbdb7'])
burst(612, 128, 11, ['#ffb3c0', '#ff8fa3'])
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
