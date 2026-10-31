import json, math, sys
from template import *
from sprites import Grid

def star_poly(cx, cy, ro, ri, n=5, rot=-90):
    pts = []
    for i in range(2 * n):
        r = ro if i % 2 == 0 else ri
        a = math.radians(rot + i * 180 / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts
def in_poly(px, py, pts):
    inside = False; j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]; xj, yj = pts[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi: inside = not inside
        j = i
    return inside

# screen icon: coin with a hollow ring and a star cut-out
STAR = star_poly(15, 15.5, 7.2, 3.0)
def coin_icon(x, y):
    d = math.hypot(x + 0.5 - 15, y + 0.5 - 15)
    if d > 14.6: return False
    if 10.4 <= d <= 11.6: return False
    if in_poly(x + 0.5, y + 0.5, STAR): return False
    return True
ICON = shade(mask(30, 30, coin_icon))

def bag():
    g = Grid(48, 52)
    for y in range(16, 50):
        for x in range(4, 44):
            rr = 3
            if y > 46 and (x < 4 + rr or x > 43 - rr) and math.hypot(min(x - (4 + rr), (43 - rr) - x), y - 46) > rr and (x < 4 + rr or x > 43 - rr):
                continue
            k = 'f'
            if x < 9: k = 'l'
            if x > 37 or y > 46: k = 's'
            if 16 <= y <= 20: k = 'm' if x <= 37 else 's'
            g.set(x, y, k)
    for y in range(2, 17):           # handle: thick arc
        for x in range(10, 38):
            d = math.hypot((x + 0.5 - 24) / 11.5, (y + 0.5 - 17) / 14.5)
            if 0.80 <= d <= 1.0 and y < 17: g.set(x, y, 'c')
    star = star_poly(24, 33, 7, 3)
    for y in range(24, 42):
        for x in range(14, 34):
            if in_poly(x + 0.5, y + 0.5, star): g.set(x, y, 'w')
    g.outline()
    return g

def gift():
    g = Grid(46, 48)
    for y in range(20, 46):
        for x in range(4, 42):
            g.set(x, y, 'l' if x < 9 else 's' if x > 35 or y > 42 else 'f')
    for y in range(13, 20):
        for x in range(1, 45):
            g.set(x, y, 'g' if y < 18 else 's')
    for y in range(13, 46):
        for x in range(20, 26): g.set(x, y, 'r' if x < 24 else 'R')
    for (cx, cy) in [(15.5, 8.5), (30.5, 8.5)]:      # bow loops
        for y in range(2, 15):
            for x in range(6, 40):
                d = math.hypot((x + 0.5 - cx) / 6.5, (y + 0.5 - cy) / 5.5)
                if d <= 1 and not (d < 0.45): g.set(x, y, 'r' if y < cy else 'R')
    for y in range(9, 14):
        for x in range(20, 26): g.set(x, y, 'R')
    g.outline()
    return g

def coin_stack():
    g = Grid(40, 34)
    def coin(ox, oy):
        for y in range(oy, oy + 12):
            for x in range(ox, ox + 30):
                top = math.hypot((x + 0.5 - (ox + 15)) / 15, (y + 0.5 - (oy + 4.5)) / 4.5) <= 1
                side = (oy + 4.5 <= y + 0.5 <= oy + 8.5) and abs(x + 0.5 - (ox + 15)) <= 15
                bot = math.hypot((x + 0.5 - (ox + 15)) / 15, (y + 0.5 - (oy + 8.5)) / 4.5) <= 1
                if top: g.set(x, y, 't' if math.hypot((x + 0.5 - (ox + 15)) / 11, (y + 0.5 - (oy + 4.5)) / 2.6) > 1 else 'u')
                elif side or bot: g.set(x, y, 'e' if (x - ox) % 4 else 'E')
    for i, (ox, oy) in enumerate([(5, 20), (7, 13), (4, 6)]):
        coin(ox, oy)
    g.outline()
    return g

def float_coin(r=9):
    s = 2 * r + 2
    g = Grid(s + 4, s + 4)
    star = star_poly(r + 2, r + 2.5, r * 0.55, r * 0.24)
    for y in range(s):
        for x in range(s):
            d = math.hypot(x + 0.5 - (r + 2), y + 0.5 - (r + 2))
            if d <= r:
                k = 'u' if d < r - 2 else ('t' if (x + y) < 2 * r + 2 else 'e')
                if in_poly(x + 0.5, y + 0.5, star): k = 'w'
                g.set(x + 1, y + 1, k)
    g.outline()
    return g

def price_tag():
    g = Grid(40, 24)
    pts = [(1, 10), (10, 1), (36, 1), (36, 19), (10, 19)]
    for y in range(22):
        for x in range(40):
            if in_poly(x + 0.5, y + 0.5, pts):
                if math.hypot(x + 0.5 - 9, y + 0.5 - 10) <= 2.2: continue
                g.set(x + 1, y + 1, 'p' if y < 15 else 'q')
    star = star_poly(24, 11, 6, 2.6)
    for y in range(4, 19):
        for x in range(16, 32):
            if in_poly(x + 0.5, y + 0.5, star): g.set(x + 1, y + 1, 'w')
    g.outline()
    return g

new_doc('banner-store')
halo(['#fbdcd8', '#f9c6c6', '#f5abb3'], '#fde9e6', '#fbdcd8')
hoodie()
head()
screen_icon(ICON)
cast_layer()
PINK = {'k': CHOC, 'f': '#ff8fa3', 'l': '#ffb3c0', 's': '#d95a76', 'm': '#e66f89', 'c': '#fff8ea', 'w': '#fff8ea'}
merged_sprite(bag().rows(), 298, 118, PINK, 'bag')
merged_sprite(gift().rows(), 548, 92, {'k': CHOC, 'f': '#8fe0d6', 'l': '#bff3ea', 's': '#4fa9a5', 'g': '#a9ece3', 'r': '#f4bf69', 'R': '#d9902f'}, 'gift')
GOLD = {'k': CHOC, 't': '#ffd66b', 'u': '#ffe8a3', 'e': '#d9902f', 'E': '#b8761f', 'w': '#fff3c4'}
merged_sprite(coin_stack().rows(), 566, 186, GOLD, 'stack')
merged_sprite(price_tag().rows(), 314, 30, {'k': CHOC, 'p': '#fff8ea', 'q': '#ead9bd', 'w': '#ff8fa3'}, 'tag')
for (x, y, r) in [(540, 26, 9), (604, 56, 6), (356, 82, 6), (516, 150, 5)]:
    merged_sprite(float_coin(r).rows(), x, y, GOLD, 'coin')
sparkles([(372, 6, True), (288, 92, True), (606, 128, False), (588, 4, True), (338, 178, False)])
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
