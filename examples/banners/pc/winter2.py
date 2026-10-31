import json, math, random, sys
from scene import *
from sprites import Grid, in_rrect
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
for l in (1699, 1730, 2454): cmd('layer.delete', layer=l)
cmd('layer.select', layer=1692)
layer('aurora')
for (y0, amp, ph, c1, c2) in [(30, 10, 0.0, '#7ee0c1', '#4fbfa9'), (46, 8, 1.3, '#a6f0d8', '#6fd1b8')]:
    pts1, pts2 = [], []
    for x in range(150, 640):
        fade = min(1.0, (x - 150) / 140)
        yc = y0 + amp * math.sin(x / 38 + ph) + 4 * math.sin(x / 13 + ph * 2)
        for dy in range(0, 16):
            y = int(yc + dy)
            if (x * 7 + y * 13) % 100 >= fade * 100: continue
            if dy < 3: pts1.append((x, y))
            elif (x + y) % 2 == 0 and dy < 9: pts2.append((x, y))
            elif (x % 2 == 0 and y % 2 == 0) and dy < 15: pts2.append((x, y))
    merged_pixels(pts2, c2, 'aurora'); merged_pixels(pts1, c1, 'aurora')
cmd('layer.setProps', opacity=0.75)
layer('mountains')
peaks = [(-20, 190), (60, 120), (130, 168), (210, 110), (300, 160), (380, 104), (470, 150), (560, 112), (660, 170)]
pts = [[-20, 250]] + [[x, y] for x, y in peaks] + [[660, 250]]
cmd('select.lasso', points=pts, antiAlias=False); fill('#7a7bb0')
for (x, y) in [p for p in peaks[1:-1] if p[1] < 130]:
    cmd('select.lasso', points=[[x, y], [x + 14, y + 12], [x + 6, y + 10], [x, y + 15], [x - 7, y + 10], [x - 14, y + 12]], antiAlias=False); fill('#eef1ff')
cmd('select.deselect')
cmd('layer.select', layer=2453)
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
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
