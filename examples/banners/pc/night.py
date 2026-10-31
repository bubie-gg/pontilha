import json, math, random, sys
from scene import *
from sprites import Grid, in_rrect
rng = random.Random(11)
new_scene('banner-news-night')
sky([(0, '#16142f'), (40, '#1d1a3d'), (80, '#26214c'), (116, '#30285b'), (150, '#3d2f69'), (178, '#523976'), (204, '#6d4482')])
layer('stars')
stars(rng, 170, (0, 0, 640, 170), ['#ffffff', '#cfd6ff', '#ffe9a8'])
for (x, y) in [(120, 30), (300, 18), (410, 62), (230, 92), (36, 70)]:
    merged_sprite(TWINKLE, x, y, {'a': '#9aa6e8', 'b': '#ffffff'}, 'twinkle')
# moon with a dithered glow
layer('moon')
MX, MY, MR = 566, 50, 21
glow = [(x, y) for y in range(MY - 34, MY + 34) for x in range(MX - 34, MX + 34)
        if MR + 2 <= math.hypot(x + 0.5 - MX, y + 0.5 - MY) <= MR + 10 and (x + y) % 2 == 0]
merged_pixels(glow, '#3b3570', 'moon glow')
sel_ellipse(MX - MR, MY - MR, 2 * MR, 2 * MR); fill('#fff4d6')
sel_ellipse(MX - MR + 5, MY - MR - 3, 2 * MR, 2 * MR); sel_ellipse(MX - MR, MY - MR, 2 * MR, 2 * MR, 'intersect'); fill('#f1dfb5')
for (x, y, r) in [(556, 42, 4), (570, 58, 3), (562, 60, 2), (552, 54, 2)]:
    sel_ellipse(x, y, 2 * r, 2 * r); fill('#e8d1a1')
cmd('select.deselect')
# far skyline
layer('far city')
x = 0
while x < W:
    w = rng.randrange(18, 40); h = rng.randrange(36, 86)
    sel_rect(x, 250 - h, w, h); fill('#352a5e')
    if rng.random() < 0.3: sel_rect(x + w // 2, 250 - h - 8, 1, 8); fill('#352a5e')
    x += w + rng.randrange(0, 4)
cmd('select.deselect')
win = [(x, y) for x in range(0, W) for y in range(160, 248) if x % 6 == 2 and y % 7 == 3 and rng.random() < 0.18]
merged_pixels(win, '#6f5ca8', 'far windows')
# near skyline: denser and taller toward the right, lit amber windows
layer('near city')
x = 250; bldgs = []
while x < W:
    w = rng.randrange(26, 52); h = rng.randrange(40, 70) + (x - 250) // 6
    bldgs.append((x, w, h)); x += w + rng.randrange(2, 6)
for (bx, w, h) in [(0, 40, 34), (44, 30, 22), (78, 48, 40), (130, 36, 28), (170, 52, 46), (226, 30, 30)] + bldgs:
    sel_rect(bx, 250 - h, w, h); fill('#1b1730')
    sel_rect(bx, 250 - h, 2, h); fill('#25203f')                       # moonlit edge
cmd('select.deselect')
lit, warm = [], []
for (bx, w, h) in bldgs:
    for wx in range(bx + 4, bx + w - 4, 6):
        for wy in range(250 - h + 6, 246, 8):
            r = rng.random()
            if r < 0.35: lit += [(wx, wy), (wx + 1, wy), (wx, wy + 1), (wx + 1, wy + 1), (wx, wy + 2), (wx + 1, wy + 2)]
            elif r < 0.45: warm += [(wx, wy), (wx + 1, wy), (wx, wy + 1), (wx + 1, wy + 1), (wx, wy + 2), (wx + 1, wy + 2)]
merged_pixels(lit, '#ffbd52', 'windows'); merged_pixels(warm, '#ff8fa3', 'windows pink')
# rooftop billboard with a tiny Bubie face
def billboard():
    g = Grid(40, 34)
    for y in range(2, 24):
        for x in range(2, 38):
            g.set(x, y, 'f' if 4 <= x <= 35 and 4 <= y <= 21 else 'r')
    for y in range(7, 19):
        for x in range(12, 28):
            if in_rrect(x - 12, y - 7, 16, 12, 3): g.set(x, y, 'h')
    for y in range(9, 16):
        for x in range(14, 26): g.set(x, y, 's')
    g.set(17, 12, 'e'); g.set(22, 12, 'e'); g.set(18, 14, 'e'); g.set(19, 14, 'e'); g.set(20, 14, 'e'); g.set(21, 14, 'e')
    for y in range(24, 34): g.set(8, y, 'p'); g.set(31, y, 'p')
    g.outline()
    return g
tall = max(bldgs, key=lambda b: b[2] if b[0] < 560 else 0)
merged_sprite(billboard().rows(), tall[0] + tall[1] // 2 - 20, 250 - tall[2] - 33,
              {'k': '#0f0c1c', 'f': '#ff8fa3', 'r': '#d95a76', 'h': '#f4e6cc', 's': '#2b2029', 'e': '#ffbd52', 'p': '#3a3358'}, 'billboard')
# rocket launch: curved dithered smoke trail and the rocket
layer('launch')
trail = []
for i in range(0, 120):
    t = i / 120; x = 360 + 70 * t + 18 * math.sin(t * 3); y = 236 - 190 * t
    for dx in range(-3 + i // 40, 4 - i // 40):
        if (int(x) + dx + int(y)) % 2 == 0 or abs(dx) < 2: trail.append((int(x) + dx, int(y)))
merged_pixels(trail[: len(trail) // 2], '#e9e1f5', 'smoke'); merged_pixels(trail[len(trail) // 2:], '#bfb3dc', 'smoke')
ROCKET = ['....kk....', '...kwwk...', '..kwwwwk..', '..kwbbwk..', '..kwbbwk..', '..kwwwwk..', '.kkwwwwkk.', 'kpkwwwwkpk', 'kpkkwwkkpk', 'kk.kffk.kk', '...kffk...', '....ff....']
merged_sprite(ROCKET, 426, 30, {'k': '#0f0c1c', 'w': '#fff8ea', 'b': '#5fbdb7', 'p': '#ff8fa3', 'f': '#ffbd52'}, 'rocket')
# fireworks
def burst(cx, cy, r, colors):
    pts = {c: [] for c in colors}
    for i in range(16):
        a = i / 16 * 2 * math.pi
        for d in range(r // 3, r + 1):
            if d % 3 == 0: continue
            c = colors[0] if d < r * 0.6 else colors[1]
            pts[c].append((round(cx + d * math.cos(a)), round(cy + d * math.sin(a))))
    for c, p in pts.items(): merged_pixels(p, c, 'firework')
burst(330, 60, 18, ['#ffd66b', '#ff8fa3'])
burst(510, 100, 14, ['#bff3ea', '#5fbdb7'])
burst(612, 128, 11, ['#ffb3c0', '#ff8fa3'])
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
