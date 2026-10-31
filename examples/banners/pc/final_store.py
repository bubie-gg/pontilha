import json, math, random, sys
from scene import *
from sprites import Grid, in_rrect
rng = random.Random(5)
new_scene('banner-store-sunset')
sky([(0, '#b97ab8'), (30, '#d585b0'), (60, '#ea93a8'), (92, '#f7a59c'), (124, '#ffb98d'), (152, '#ffcb8c'), (178, '#ffdc9f')])
# retro sun with horizontal cut stripes
layer('sun')
SX_, SY_, SR_ = 392, 172, 50
sel_ellipse(SX_ - SR_, SY_ - SR_, 2 * SR_, 2 * SR_); fill('#ffe27a')
sel_ellipse(SX_ - SR_, SY_ - SR_, 2 * SR_, 2 * SR_); sel_rect(SX_ - SR_, SY_ - 10, 2 * SR_, 70, 'intersect'); fill('#ffc45c')
sel_ellipse(SX_ - SR_, SY_ - SR_, 2 * SR_, 2 * SR_); sel_rect(SX_ - SR_, SY_ + 18, 2 * SR_, 50, 'intersect'); fill('#ffa64d')
cmd('select.deselect')
cuts = [(x, y) for y in range(SY_ - 6, SY_ + SR_) for x in range(SX_ - SR_, SX_ + SR_)
        if math.hypot(x + 0.5 - SX_, y + 0.5 - SY_) <= SR_ and ((y - (SY_ - 6)) % 9) < 1 + (y - (SY_ - 6)) // 12]
merged_pixels(cuts, '#ffcb8c', 'sun cuts')
# long thin streak clouds
layer('clouds')
with background():
    for (x, y, w) in [(40, 44, 170), (150, 58, 120), (330, 34, 150), (520, 74, 130), (300, 100, 110)]:
        cloud([(x, y, w, 9), (x + w // 4, y - 4, w // 2, 10)], '#ffd9cf', '#e98aa4', '#fff0ea')
for (x, y, w) in [(30, 40, 150), (120, 52, 110), (300, 30, 180), (430, 70, 160), (560, 48, 100), (200, 96, 140)]:
    cloud([(x, y, w, 9), (x + w // 4, y - 4, w // 2, 10)], '#ffd9cf', '#e98aa4', '#fff0ea')
# hills
layer('hills')
hill('#c77a9c', 206, 10, 52, 0.3, 4, 19)
hill('#9e5d86', 222, 7, 37, 2.2, 3, 13)
hill('#7a4870', 236, 4, 29, 1.1, 2, 9)
# string lights across the top
layer('lights')
wire = []
for x in range(250, 641):
    t = (x - 250) / 390
    wire.append((x, round(10 + 26 * t + 22 * math.sin(math.pi * t))))
merged_pixels(wire, '#4a2c48', 'wire')
cols = ['#ffe08a', '#ff8fa3', '#8fe0d6', '#ffbd52']
for i, x in enumerate(range(262, 640, 18)):
    y = [p for p in wire if p[0] == x][0][1]
    c = cols[i % 4]
    glow = [(x + dx, y + 2 + dy) for dx in range(-4, 6) for dy in range(-2, 9) if (dx + dy) % 2 == 0 and 3.0 <= math.hypot(dx - 0.5, dy - 3) <= 4.8]
    merged_pixels(glow, '#fff2c9', 'glow')
    merged_sprite(['.kk.', 'kccK', 'kccK', 'kccK', '.kk.'], x - 1, y + 1, {'k': '#4a2c48', 'K': '#4a2c48', 'c': c}, 'bulb')
# market stall with Bubie as the shopkeeper
def stall():
    g = Grid(170, 130)
    for y in range(24, 128):                      # posts
        for x in (12, 13, 14, 154, 155, 156): g.set(x, y, 'w' if x in (12, 154) else 'W')
    for y in range(4, 12):                        # sign board
        for x in range(50, 120): g.set(x, y, 'b' if y > 4 else 'B')
    for y in range(12, 26):
        for x in range(64, 106): g.set(x, y, 'n' if 66 <= x <= 103 and 13 <= y <= 24 else 'N')
    for y in range(26, 50):                       # awning stripes with a scalloped hem
        for x in range(2, 168):
            stripe = ((x - 2) // 12) % 2
            hem = 44 + round(5 * math.sin(((x - 2) % 12) / 12 * math.pi))
            if y <= hem: g.set(x, y, ('p' if y < 30 else 'P' if y > 40 else 'p') if stripe else ('c' if y < 40 else 'C'))
    # coin icon on the sign
    for y in range(14, 24):
        for x in range(80, 90):
            d = math.hypot(x + 0.5 - 85, y + 0.5 - 19)
            if d <= 5: g.set(x, y, 'g' if d < 3.5 else 'G')
    # Bubie behind the counter: shoulders and CRT head
    for y in range(76, 92):
        for x in range(64, 106):
            if in_rrect(x - 64, y - 76, 42, 30, 10): g.set(x, y, 'u')
    for y in range(54, 78):
        for x in range(70, 100):
            if in_rrect(x - 70, y - 54, 30, 24, 6): g.set(x, y, 'h' if y < 74 else 'H')
    for y in range(58, 72):
        for x in range(74, 96):
            if in_rrect(x - 74, y - 58, 22, 14, 3): g.set(x, y, 's')
    for (x, y) in [(79, 63), (80, 63), (89, 63), (90, 63), (82, 67), (83, 68), (84, 68), (85, 68), (86, 68), (87, 67)]: g.set(x, y, 'e')
    # counter
    for y in range(88, 128):
        for x in range(4, 166):
            k = 'r' if y < 93 else ('q' if (x // 14) % 2 else 'Q')
            if y >= 124: k = 'R'
            g.set(x, y, k)
    # goods on the counter: gift box, coin stack, jar of candy
    for y in range(72, 88):
        for x in range(20, 40): g.set(x, y, 't' if x < 34 else 'T')
    for y in range(68, 88):
        for x in range(28, 32): g.set(x, y, 'g')
    for y in range(66, 72):
        for x in range(22, 38):
            if math.hypot((x + 0.5 - 30) / 8, (y + 0.5 - 69) / 3) <= 1: g.set(x, y, 'g')
    for i, y in enumerate(range(80, 88, 3)):
        for x in range(122 - i, 140 + i):
            g.set(x, y, 'g'); g.set(x, y + 1, 'G'); g.set(x, y + 2, 'G')
    for y in range(68, 88):
        for x in range(144, 160):
            if in_rrect(x - 144, y - 68, 16, 20, 4): g.set(x, y, 'j' if (x + y) % 5 else ('p' if (x * y) % 3 else 't'))
    g.outline()
    return g
layer('stall')
merged_sprite(stall().rows(), 456, 116, {'k': CHOC, 'w': '#c8834d', 'W': '#8a5a35', 'b': '#a86b3f', 'B': '#7a4a2e', 'n': '#fff8ea', 'N': '#a86b3f',
    'p': '#ff8fa3', 'P': '#d95a76', 'c': '#fff8ea', 'C': '#ead9bd', 'g': '#ffd66b', 'G': '#d9902f', 'u': '#34303a', 'h': '#f4e6cc', 'H': '#d8c3a0',
    's': '#2b2029', 'e': '#ffbd52', 'r': '#e8b27a', 'q': '#c8834d', 'Q': '#b97a44', 'R': '#8a5a35', 't': '#8fe0d6', 'T': '#4fa9a5', 'j': '#d9f3ec'}, 'stall')
# birds and a few floating coins
layer('birds')
for (x, y) in [(150, 120), (162, 114), (176, 126), (390, 90)]:
    merged_pixels([(x, y), (x + 1, y - 1), (x + 2, y - 1), (x + 3, y), (x + 4, y - 1), (x + 5, y - 1), (x + 6, y)], '#6b3a63', 'bird')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
