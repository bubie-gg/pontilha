import json, math, sys
from template import *
from sprites import Grid
from geom import in_poly, star_poly
from store import in_poly, star_poly   # geometry helpers only

ROCKET = ["..........##..........",
          ".........####.........",
          "........######........",
          ".......########.......",
          ".......########.......",
          "......##########......",
          "......###....###......",
          "......##......##......",
          "......##......##......",
          "......###....###......",
          "......##########......",
          "......##########......",
          "......##########......",
          "......##########......",
          "..#...##########...#..",
          ".##...##########...##.",
          ".##...##########...##.",
          "###...##########...###",
          "###...##########...###",
          "###....########....###",
          "##.....########.....##",
          "#.......######.......#",
          "......................",
          "........#.##.#........",
          ".........#..#.........",
          "........#.##.#........",
          ".........#..#.........",
          "..........##..........",
          "...........#.........."]
def rocket_icon(): return shade(ROCKET)
ICON = rocket_icon()

def gear():
    g = Grid(34, 34)
    cx = cy = 16.5
    for y in range(34):
        for x in range(34):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.hypot(dx, dy); a = math.atan2(dy, dx)
            tooth = (math.cos(8 * a) > 0.35) and d <= 15
            if (d <= 11.5 or tooth) and d > 4.5:
                g.set(x, y, 'l' if dx + dy < -6 else 's' if dx + dy > 8 else 'f')
    g.outline()
    return g

def wrench():
    g = Grid(36, 36)
    for y in range(36):
        for x in range(36):
            px, py = x + 0.5, y + 0.5
            # handle along the diagonal
            t = (px + py) / 2; off = (px - py) / math.sqrt(2)
            on = abs(off) <= 2.6 and 8 <= t <= 31
            # head: ring with an open jaw toward the top-left
            d = math.hypot(px - 9, py - 9)
            if d <= 7.5 and not (px < 9 and py < 9 and d < 6 + 2): on = True
            if d <= 3.2: on = False
            if px < 7 and py < 7: on = False
            if on: g.set(x, y, 'f' if off < 1 else 's')
    g.outline()
    return g

def calendar():
    g = Grid(40, 42)
    for y in range(6, 40):
        for x in range(2, 38):
            if y < 14: g.set(x, y, 'h' if y < 12 else 'H')
            else: g.set(x, y, 'p' if x < 33 else 'q')
    for rx in (10, 28):
        for y in range(2, 10):
            for x in range(rx, rx + 3): g.set(x, y, 'm' if x == rx else 'M')
    for j in range(3):
        for i in range(5):
            if not (j == 1 and i in (2, 3)):
                g.set(7 + i * 6, 19 + j * 6, 'z'); g.set(8 + i * 6, 19 + j * 6, 'z')
    # check mark
    for i in range(6):
        for w in range(3): g.set(14 + i + w, 26 + i, 'c')
    for i in range(12):
        for w in range(3): g.set(19 + i + w, 31 - i, 'c')
    g.outline()
    return g

def popper():
    g = Grid(40, 40)
    tip = (4.5, 35.5); a = (14.5, 10.5); b = (29.5, 25.5)
    for y in range(40):
        for x in range(40):
            if in_poly(x + 0.5, y + 0.5, [tip, a, b]):
                band = int(((x + 0.5 - tip[0]) + (tip[1] - (y + 0.5))) / 6) % 2
                g.set(x, y, 'p' if band else 'q')
    for y in range(40):                    # rim of the cone
        for x in range(40):
            if abs((x + 0.5 - 22) + (y + 0.5 - 18)) <= 1.4 and math.hypot(x + 0.5 - 22, y + 0.5 - 18) <= 11: g.set(x, y, 'r')
    g.outline()
    return g

def up_chip():
    g = Grid(36, 30)
    from sprites import in_rrect
    for y in range(24):
        for x in range(32):
            if in_rrect(x, y, 32, 24, 8): g.set(x + 2, y + 2, 'l' if y < 4 else 's' if y > 20 else 'f')
    arrow = [(18, 6), (11, 13), (15, 13), (15, 21), (21, 21), (21, 13), (25, 13)]
    for y in range(30):
        for x in range(36):
            if in_poly(x + 0.5, y + 0.5, arrow): g.set(x, y, 'w')
    g.outline()
    return g

new_doc('banner-changelog')
halo(['#d9f3ec', '#c0e9df', '#a3dcd0'], '#ebf8f4', '#d9f3ec')
hoodie()
head()
screen_icon(ICON)
cast_layer()
merged_sprite(gear().rows(), 312, 22, {'k': CHOC, 'f': '#b9b2c6', 'l': '#d9d4e2', 's': '#8a8299'}, 'gear')
merged_sprite(wrench().rows(), 330, 40, {'k': CHOC, 'f': '#f4bf69', 's': '#d9902f'}, 'wrench')
merged_sprite(calendar().rows(), 548, 92, {'k': CHOC, 'h': '#ff8fa3', 'H': '#d95a76', 'p': '#fff8ea', 'q': '#ead9bd',
                                          'm': '#c9b8a0', 'M': '#8f7c66', 'z': '#c9b8a0', 'c': '#3f9a96'}, 'calendar')
merged_sprite(popper().rows(), 300, 136, {'k': CHOC, 'p': '#ffbd52', 'q': '#ff8fa3', 'r': '#fff8ea'}, 'popper')
# streamers out of the popper mouth and confetti everywhere
streamer = [(336 + i, 150 - round(6 * math.sin(i / 4))) for i in range(0, 24)] + [(334 + round(4 * math.sin(i / 3)), 146 - i) for i in range(0, 20)]
merged_pixels(streamer, '#5fbdb7', 'streamer')
conf = [(300, 120, '#ff8fa3'), (352, 126, '#5fbdb7'), (366, 112, '#ffbd52'), (290, 70, '#5fbdb7'), (372, 160, '#ff8fa3'),
        (530, 40, '#ff8fa3'), (600, 30, '#5fbdb7'), (612, 150, '#ffbd52'), (584, 196, '#ff8fa3'), (532, 184, '#5fbdb7'),
        (560, 64, '#ffbd52'), (318, 196, '#5fbdb7'), (626, 96, '#ff8fa3')]
for (x, y, c) in conf:
    merged_pixels([(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1), (x + 2, y + 1)], c, 'confetti')
merged_sprite(up_chip().rows(), 548, 24, {'k': CHOC, 'f': '#8fe0d6', 'l': '#c4f3ec', 's': '#4fa9a5', 'w': '#fff8ea'}, 'levelup')
sparkles([(372, 6, True), (600, 6, True), (290, 104, False), (606, 120, False), (360, 182, False)])
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
