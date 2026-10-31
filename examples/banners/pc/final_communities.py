import json, math, random, sys
from scene import *
from sprites import Grid, in_rrect
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
rng = random.Random(21)
new_scene('banner-communities-winter')
sky([(0, '#232e5c'), (34, '#2f3c72'), (70, '#43508a'), (104, '#5e67a2'), (134, '#8784b8'), (160, '#b79dc4'), (184, '#e2b9cb')])
layer('stars')
stars(rng, 190, (0, 0, W, 120), ['#ffffff', '#d6dcff'])
# aurora: wavy dithered ribbons
layer('aurora')
for (y0, amp, ph, c1, c2) in [(30, 10, 0.0, '#7ee0c1', '#4fbfa9'), (46, 8, 1.3, '#a6f0d8', '#6fd1b8')]:
    pts1, pts2 = [], []
    for x in range(150, 640):
        fade = min(1.0, (x - 150) / 140)
        yc = y0 + amp * math.sin(x / 38 + ph) + 4 * math.sin(x / 13 + ph * 2)
        for dy in range(0, 16):
            y = int(yc + dy)
            if BAYER[y % 4][x % 4] / 16 >= fade: continue
            if dy < 3: pts1.append((x, y))
            elif (x + y) % 2 == 0 and dy < 9: pts2.append((x, y))
            elif (x % 2 == 0 and y % 2 == 0) and dy < 15: pts2.append((x, y))
    merged_pixels(pts2, c2, 'aurora'); merged_pixels(pts1, c1, 'aurora')
cmd('layer.setProps', opacity=0.75)
# far snowy mountains
layer('mountains')
OXs = OX[0]; OX[0] = 0
peaks = [(-20, 190)] + [(x, 106 + (i % 2) * 54 + (i * 17) % 14) for i, x in enumerate(range(60, W + 80, 85))] + [(W + 40, 180)]
pts = [[-20, 250]] + [[x, y] for x, y in peaks] + [[W + 40, 250]]
cmd('select.lasso', points=pts, antiAlias=False); fill('#7a7bb0')
for (x, y) in [p for p in peaks[1:-1] if p[1] < 130]:
    cmd('select.lasso', points=[[x, y], [x + 14, y + 12], [x + 6, y + 10], [x, y + 15], [x - 7, y + 10], [x - 14, y + 12]], antiAlias=False); fill('#eef1ff')
cmd('select.deselect')
OX[0] = OXs
# pine forest rows, far to near
def pine(h, light, base, dark, snow=None):
    w = h * 2 // 3 + 2
    g = Grid(w + 2, h + 4)
    cx = w // 2
    tiers = 4
    for t in range(tiers):
        top = round(t * h / (tiers + 1)); bot = round((t + 2) * h / (tiers + 1))
        for y in range(top, bot):
            half = (y - top) / max(1, bot - top) * (w / 2) * (0.55 + 0.45 * (t + 1) / tiers)
            for x in range(w):
                if abs(x + 0.5 - cx) <= half:
                    k = 'l' if x < cx - 1 else 'd' if x > cx + half / 2 else 'b'
                    if snow and y - top < 2 + (t == 0): k = 's'
                    g.set(x + 1, y, k)
    for y in range(h - 2, h + 3): g.set(cx + 1, y, 't')
    return g
OXs = OX[0]; OX[0] = 0
for (row, count, hmin, hmax, ybase, cols) in [
        ('far pines', 70, 18, 28, 214, ('#6a6ea6', '#585c95', '#474b82', '#e6ebff')),
        ('mid pines', 44, 30, 44, 232, ('#4a5089', '#3b4078', '#2e3366', '#f4f6ff'))]:
    layer(row)
    for i in range(count):
        x = rng.randrange(-10, W); h = rng.randrange(hmin, hmax)
        if W - ART + 250 < x < W - ART + 400 and row == 'mid pines': continue          # leave the clearing for the camp
        merged_sprite(pine(h, *cols[:3], snow=True).rows(), x, ybase - h, {'l': cols[0], 'b': cols[1], 'd': cols[2], 's': cols[3], 't': '#3a2f4a'}, 'pine')
OX[0] = OXs
# snowy ground
layer('snow')
hill('#dfe6f7', 222, 3, 60, 0.5, 2, 21)
hill('#eef2fc', 232, 2, 40, 1.5, 1, 13)
# campfire glow on the snow
layer('camp')
FX, FY = 470, 224
glow = [(x, y) for y in range(FY - 30, FY + 26) for x in range(FX - 60, FX + 60)
        if math.hypot((x - FX) / 2.2, y - FY) <= 14 and (x % 2 == 0 and y % 2 == 0) and y > 212]
merged_pixels(glow, '#f9dcc0', 'glow')
# tent
def tent():
    g = Grid(56, 40)
    for y in range(4, 38):
        for x in range(56):
            half = (y - 4) * 0.8
            if abs(x + 0.5 - 28) <= half:
                k = 'a' if x < 28 else 'A'
                if abs(x + 0.5 - 28) <= (y - 16) * 0.35 and y > 16: k = 'o'
                g.set(x, y, k)
    g.outline()
    return g
merged_sprite(tent().rows(), 520, 192, {'k': '#1f2346', 'a': '#5fbdb7', 'A': '#3f8f93', 'o': '#2b2029'}, 'tent')
# logs and flame
merged_sprite(['....kkkkkk......',
               '..kkLLLLLLkk....',
               '.kLLllllllLLkk..',
               'kLLkkkkkkkkLLLk.',
               '.kk.......kkkk..'], FX - 8, FY + 2, {'k': '#3a2620', 'L': '#8a5a35', 'l': '#c8834d'}, 'logs')
FLAME = ['......y.....',
         '.....yy.....',
         '....yoy..y..',
         '...yoooy.y..',
         '..yooroyyy..',
         '..yorrrooy..',
         '.yorrRrrooy.',
         '.yorRRRrroy.',
         '..yorRRroy..',
         '...yooooy...']
merged_sprite(FLAME, FX - 6, FY - 9, {'y': '#ffe08a', 'o': '#ffbd52', 'r': '#ff8a3d', 'R': '#fff3c4'}, 'flame')
merged_pixels([(FX - 3, FY - 16), (FX + 4, FY - 20), (FX - 1, FY - 25), (FX + 2, FY - 30)], '#ffbd52', 'sparks')
# friends around the fire: little Bubies in different hoodies
def buddy(hood, flip=False):
    g = Grid(16, 22)
    for y in range(0, 11):
        for x in range(1, 15):
            if in_rrect(x - 1, y, 14, 11, 3): g.set(x, y, 'h' if y < 9 else 'H')
    for y in range(2, 8):
        for x in range(3, 13): g.set(x, y, 's')
    ex = (5, 9) if not flip else (6, 10)
    g.set(ex[0], 4, 'e'); g.set(ex[1], 4, 'e')
    for y in range(11, 20):
        for x in range(2, 14):
            if in_rrect(x - 2, y - 11, 12, 9, 3): g.set(x, y, 'c' if x < 9 else 'C')
    g.set(6, 12, 'g'); g.set(6, 13, 'g'); g.set(9, 12, 'g'); g.set(9, 13, 'g')
    g.outline()
    return g
HOODS = [('#ff8fa3', '#d95a76'), ('#8fe0d6', '#4fa9a5'), ('#ffd66b', '#d9a04a'), ('#b9a3e8', '#8a74c0')]
for (x, y, hood, flip) in [(424, 204, HOODS[0], False), (444, 212, HOODS[1], False), (494, 212, HOODS[2], True), (512, 204, HOODS[3], True)]:
    merged_sprite(buddy(hood, flip).rows(), x, y, {'k': '#1f2346', 'h': '#f4e6cc', 'H': '#d8c3a0', 's': '#2b2029', 'e': '#ffbd52',
                                                  'c': hood[0], 'C': hood[1], 'g': '#fff8ea'}, 'buddy')
# near pines framing the right edge
layer('near pines')
for (x, h) in [(600, 70), (622, 58), (566, 50)]:
    merged_sprite(pine(h, None, None, None, snow=True).rows(), x, 250 - h, {'l': '#2b3062', 'b': '#232855', 'd': '#1b1f46', 's': '#dfe6f7', 't': '#191a33'}, 'near pine')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
