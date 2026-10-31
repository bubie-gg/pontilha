import json, math, random, sys
from scene import *
from sprites import Grid
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
