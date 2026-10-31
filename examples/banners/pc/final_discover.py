import json, math, random, sys
from scene import *
from sprites import Grid, in_rrect
rng = random.Random(9)
new_scene('banner-discover-sea')
sky([(0, '#7fd3e6'), (40, '#9adde8'), (78, '#b8e7ea'), (110, '#d6efe6'), (136, '#f4f0dd'), (154, '#ffe6c4')])
layer('sun')
glow = [(x, y) for y in range(120, 166) for x in range(330, 420) if 21 <= math.hypot(x + 0.5 - 375, y + 0.5 - 160) <= 30 and (x + y) % 2 == 0]
merged_pixels(glow, '#fff6dc', 'sun glow')
sel_ellipse(355, 140, 40, 40); fill('#fff1b8')
sel_ellipse(355, 140, 40, 40); sel_rect(355, 158, 40, 22, 'intersect'); fill('#ffe08a')
cmd('select.deselect')
layer('clouds')
with background():
    cloud([(150, 50, 26, 12), (168, 44, 30, 18), (190, 50, 24, 12), (146, 56, 74, 8)], '#ffffff', '#cde9f0')
    cloud([(420, 30, 34, 14), (440, 24, 40, 22), (470, 30, 30, 14), (414, 36, 90, 10)], '#ffffff', '#cde9f0', '#ffffff')
cloud([(340, 30, 40, 18), (360, 22, 46, 28), (396, 30, 36, 18), (334, 38, 104, 12)], '#ffffff', '#cde9f0', '#ffffff')
cloud([(520, 76, 30, 14), (540, 70, 34, 20), (566, 76, 28, 14), (514, 82, 86, 10)], '#ffffff', '#cde9f0')
cloud([(70, 60, 26, 12), (88, 54, 30, 18), (110, 60, 24, 12), (66, 66, 74, 8)], '#ffffff', '#cde9f0')
# islands on the horizon with palm silhouettes
layer('islands')
for (x, w, h, c) in [(250, 90, 14, '#7cbfae'), (300, 50, 22, '#6aae9f'), (560, 110, 18, '#7cbfae')]:
    sel_ellipse(x, 166 - h, w, 2 * h); sel_rect(x, 166 - h, w, h, 'intersect'); fill(c)
cmd('select.deselect')
def palm(h):
    g = Grid(24, h + 2)
    for y in range(6, h + 2): g.set(11 + round(2 * math.sin(y / h * 2)), y, 't')
    for (dx, dy) in [(-1, 0), (1, 0)]:
        for i in range(10):
            g.set(11 + dx * i, 6 + (i * i) // 14, 'l'); g.set(11 + dx * i, 5 + (i * i) // 14, 'l')
    for i in range(6): g.set(11 - i // 2, 5 - i // 2 if i < 4 else 3, 'l'); g.set(12 + i // 2, 5 - i // 2 if i < 4 else 3, 'l')
    return g
for (x, h) in [(306, 20), (322, 16), (590, 18)]:
    merged_sprite(palm(h).rows(), x, 166 - 20 - h + 4, {'t': '#4f8f84', 'l': '#4f8f84'}, 'palm')
# sea: banded turquoise with sparkling wave dashes
layer('sea')
OXs = OX[0]; OX[0] = 0
for (y0, c) in [(166, '#5ec4c8'), (178, '#4fb7c0'), (194, '#43a8b6'), (214, '#3897aa'), (234, '#2f879d')]:
    sel_rect(0, y0, W, 250 - y0); fill(c)
cmd('select.deselect')
waves = []
for y in range(170, 250, 5):
    off = rng.randrange(0, 40)
    for x in range(off, W, rng.randrange(28, 46)):
        L = 3 + (y - 166) // 14
        waves += [(x + i, y) for i in range(L)]
merged_pixels(waves, '#bff3ea', 'waves')
OX[0] = OXs
glints = [(x, y) for x in range(330, 420) for y in range(168, 200) if rng.random() < 0.05]
merged_pixels(glints, '#ffffff', 'glints')
# sailboat with two Bubies (a duo)
def boat():
    g = Grid(70, 64)
    for y in range(4, 44):                                  # sails
        for x in range(36, 64):
            if x - 36 <= (y - 4) * 0.62: g.set(x, y, 's' if x < 52 else 'S')
        for x in range(14, 34):
            if 34 - x <= (y - 10) * 0.5 and y >= 10: g.set(x, y, 'p' if x > 22 else 'P')
    for y in range(2, 48): g.set(34, y, 'm'); g.set(35, y, 'M')
    for y in range(48, 60):                                 # hull
        for x in range(4, 68):
            inset = (y - 48) * 1.2
            if 4 + inset <= x <= 67 - inset * 0.6: g.set(x, y, 'h' if y < 51 else 'H' if y < 57 else 'b')
    for (bx, hood) in [(16, 'c'), (44, 'd')]:              # two little Bubies on deck
        for y in range(34, 44):
            for x in range(bx, bx + 12):
                if in_rrect(x - bx, y - 34, 12, 10, 3): g.set(x, y, 'w')
        for y in range(36, 41):
            for x in range(bx + 2, bx + 10): g.set(x, y, 'q')
        g.set(bx + 4, 38, 'e'); g.set(bx + 7, 38, 'e')
        for y in range(44, 48):
            for x in range(bx + 1, bx + 11): g.set(x, y, hood)
    g.outline('o')
    return g
B = boat()
layer('boat')
merged_sprite(B.rows(), 440, 140, {'o': '#1f3b4a', 's': '#fff8ea', 'S': '#e6dcc6', 'p': '#ff8fa3', 'P': '#d95a76', 'm': '#a86b3f', 'M': '#7a4a2e',
    'h': '#f4e6cc', 'H': '#d0925a', 'b': '#a86b3f', 'w': '#f4e6cc', 'q': '#2b2029', 'e': '#ffbd52', 'c': '#8fe0d6', 'd': '#ffd66b'}, 'boat')
ripple = [(x, 201) for x in range(436, 512) if x % 3] + [(x, 204) for x in range(444, 504) if x % 4]
merged_pixels(ripple, '#e9fbf7', 'ripple')
layer('gulls')
for (x, y) in [(180, 70), (194, 62), (206, 74), (600, 110)]:
    merged_pixels([(x, y), (x + 1, y - 1), (x + 2, y - 1), (x + 3, y), (x + 4, y - 1), (x + 5, y - 1), (x + 6, y)], '#3d6f7a', 'gull')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
