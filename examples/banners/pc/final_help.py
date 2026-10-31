import json, math, random, sys
from scene import *
from sprites import Grid, in_rrect
rng = random.Random(7)
new_scene('banner-help-day')
sky([(0, '#8ccff5'), (46, '#a5d9f6'), (88, '#c1e3f6'), (124, '#dcebf6'), (156, '#f4e9f1'), (186, '#fde3e4')])
# distant lilac cloud bank along the horizon
layer('far clouds')
with background():
    bank = [(x, 158 + (i % 3) * 5, 110 + (i * 37) % 40, 46 + (i * 13) % 12) for i, x in enumerate(range(-20, W + 20, 100))]
    cloud(bank, '#efe2f4', '#dccdea')
    cloud([(120, 40, 26, 12), (136, 34, 30, 18), (158, 40, 24, 12), (116, 46, 70, 8)], '#ffffff', '#d6e6f7')
    cloud([(430, 86, 22, 10), (444, 80, 26, 16), (462, 86, 20, 10), (426, 92, 60, 7)], '#fdfdff', '#dfe8f6')
# far hills with soft pastel greens
layer('hills')
hill('#b7dcc8', 214, 10, 46, 0.4, 4, 17)
hill('#9fd0b6', 228, 8, 33, 1.9, 3, 11)
hill('#86c3a3', 242, 5, 27, 0.8, 2, 9)
# big drifting clouds: kept to the right and top so the title area stays calm
layer('clouds')
cloud([(330, 26, 46, 26), (356, 14, 52, 36), (396, 22, 46, 28), (322, 34, 112, 20)], '#ffffff', '#d6e6f7', '#ffffff')
cloud([(520, 60, 40, 22), (544, 50, 50, 32), (584, 58, 40, 24), (512, 68, 116, 18)], '#ffffff', '#d6e6f7')
cloud([(60, 96, 30, 16), (80, 88, 36, 24), (106, 94, 30, 18), (54, 102, 88, 12)], '#ffffff', '#d6e6f7')
cloud([(250, 128, 26, 14), (268, 122, 30, 20), (290, 128, 24, 14), (246, 134, 72, 10)], '#fdfdff', '#dfe8f6')
# birds
layer('birds')
for (x, y) in [(214, 40), (226, 34), (238, 46), (470, 110)]:
    merged_pixels([(x, y), (x + 1, y - 1), (x + 2, y - 1), (x + 3, y), (x + 4, y - 1), (x + 5, y - 1), (x + 6, y)], '#5b6e8c', 'bird')

# hot-air balloon carrying a tiny Bubie
def balloon():
    g = Grid(60, 96)
    cx, cy, rx, ry = 29.5, 26.5, 26, 27
    for y in range(60):
        for x in range(60):
            px, py = x + 0.5, y + 0.5
            nx, ny = (px - cx) / rx, (py - cy) / ry
            inside = nx * nx + ny * ny <= 1 if py <= cy else abs(px - cx) <= rx * max(0.0, 1 - ((py - cy) / 30) ** 1.6)
            if inside and py < 58:
                stripe = int((math.atan2(0.0001 + (px - cx), 26) / math.pi + 0.5) * 7) % 2
                k = 'p' if stripe else 'c'
                if nx < -0.45 and py < cy + 8: k = 'P' if stripe else 'C'          # lit left side
                if nx > 0.5 or py > cy + 18: k = 'q' if stripe else 'd'           # shade
                g.set(x, y, k)
    for y in range(58, 72):                                                    # ropes
        g.set(round(21 + (y - 58) * 0.4), y, 'r'); g.set(round(38 - (y - 58) * 0.4), y, 'r')
    for y in range(72, 84):                                                    # wicker basket
        for x in range(22, 38): g.set(x, y, 'b' if (x + y) % 3 else 'B')
    for x in range(21, 39): g.set(x, 72, 'B')
    # Bubie peeking out of the basket: cream monitor head with amber eyes
    for y in range(62, 72):
        for x in range(25, 35):
            if in_rrect(x - 25, y - 62, 10, 10, 3): g.set(x, y, 'h')
    for y in range(64, 69):
        for x in range(27, 33): g.set(x, y, 's')
    g.set(28, 66, 'e'); g.set(31, 66, 'e')
    g.outline()
    return g
layer('balloon')
merged_sprite(balloon().rows(), 428, 58, {'k': CHOC, 'p': '#ff8fa3', 'P': '#ffb3c0', 'q': '#d95a76', 'c': '#fff8ea', 'C': '#ffffff', 'd': '#e8d6b8',
                                           'r': '#8f7c66', 'b': '#d0925a', 'B': '#a86b3f', 'h': '#f4e6cc', 's': '#2b2029', 'e': '#ffbd52'}, 'balloon')
# a smaller far balloon for depth
def small_balloon():
    g = Grid(20, 30)
    for y in range(18):
        for x in range(20):
            if math.hypot((x + 0.5 - 10) / 8.5, (y + 0.5 - 8.5) / 8.5) <= 1 or (y > 8 and abs(x + 0.5 - 10) <= 8.5 * (1 - (y - 8) / 11)):
                g.set(x, y, 't' if x < 12 else 'T')
    for y in range(18, 23): g.set(7, y, 'r'); g.set(12, y, 'r')
    for y in range(23, 27):
        for x in range(7, 13): g.set(x, y, 'b')
    return g
merged_sprite(small_balloon().rows(), 586, 22, {'t': '#9fd8cf', 'T': '#7cc1b8', 'r': '#8f7c66', 'b': '#c08a58'}, 'far balloon')
def tree(r):
    g = Grid(2 * r + 4, 2 * r + 8)
    for y in range(2 * r + 1):
        for x in range(2 * r + 1):
            d = math.hypot(x - r, y - r)
            if d <= r: g.set(x + 1, y + 1, 'l' if (x - r) + (y - r) < -r * 0.6 else 'd' if (x - r) + (y - r) > r * 0.5 else 'm')
    for y in range(2 * r, 2 * r + 5): g.set(r + 1, y, 't'); g.set(r + 2, y, 'T')
    return g
def cottage():
    g = Grid(30, 26)
    for y in range(12, 25):
        for x in range(4, 26): g.set(x, y, 'w' if x < 20 else 'W')
    for y in range(2, 13):
        for x in range(30):
            if abs(x - 15) <= (y - 2) * 1.4 + 1: g.set(x, y, 'r' if x < 16 else 'R')
    for y in range(16, 25): g.set(11, y, 'D'); g.set(12, y, 'D'); g.set(13, y, 'D')
    for (x, y) in [(18, 16), (19, 16), (18, 17), (19, 17)]: g.set(x, y, 'y')
    g.outline()
    return g
layer('scenery')
LEAF = {'l': '#a8dbb8', 'm': '#7fc49a', 'd': '#5fa880', 't': '#a86b3f', 'T': '#7a4a2e'}
for (x, y, r) in [(486, 208, 6), (500, 212, 5), (512, 206, 7), (590, 214, 5), (602, 210, 6), (620, 216, 4), (360, 222, 4), (372, 220, 5)]:
    merged_sprite(tree(r).rows(), x, y - 2 * r, LEAF, 'tree')
merged_sprite(cottage().rows(), 548, 196, {'k': CHOC, 'w': '#fff8ea', 'W': '#ead9bd', 'r': '#ff8fa3', 'R': '#d95a76', 'D': '#a86b3f', 'y': '#ffd66b'}, 'cottage')
# flowers dotted on the front hill
rng = random.Random(3)
flowers = [(rng.randrange(330, 640), rng.randrange(236, 249)) for _ in range(40)]
merged_pixels(flowers[:20], '#fff8ea', 'flowers'); merged_pixels(flowers[20:], '#ffb3c0', 'flowers')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
