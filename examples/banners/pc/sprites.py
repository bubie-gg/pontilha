# Procedural pixel sprites (grid of colour keys) for the banner cast.
import math
class Grid:
    def __init__(self, w, h): self.w, self.h = w, h; self.c = {}
    def set(self, x, y, k):
        if 0 <= x < self.w and 0 <= y < self.h: self.c[(x, y)] = k
    def rows(self): return [''.join(self.c.get((x, y), '.') for x in range(self.w)) for y in range(self.h)]
    def outline(self, k='k', diag=False):
        nb = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (1, -1), (-1, 1), (-1, -1)] if diag else [])
        add = [(x + dx, y + dy) for (x, y) in self.c for dx, dy in nb if (x + dx, y + dy) not in self.c]
        for p in add: self.set(*p, k)
def in_rrect(x, y, w, h, r):
    px, py = x + 0.5, y + 0.5
    cx = min(max(px, r), w - r); cy = min(max(py, r), h - r)
    return math.hypot(px - cx, py - cy) <= r
def bubble(w, h, r, tail, face='f', light='l', shade='s'):
    """Speech bubble with a pixel tail; tail is a list of (x, y, width) rows."""
    g = Grid(w + 16, h + 16)
    for y in range(h):
        for x in range(w):
            if in_rrect(x, y, w, h, r):
                g.set(x + 2, y + 2, light if y < 4 else shade if y >= h - 3 else face)
    for (x, y, wd) in tail:
        for i in range(wd): g.set(x + 2 + i, y + 2, shade if y >= h - 3 else face)
    g.outline()
    return g
def text_bang(g, x, y):
    for j in range(13):
        for i in range(4): g.set(x + i, y + j, 'w' if i < 3 else 'v')
    for j in range(16, 20):
        for i in range(4): g.set(x + i, y + j, 'w' if i < 3 else 'v')
def bulb():
    g = Grid(40, 44)
    cx, cy, r = 19.5, 15.5, 12.5
    for y in range(32):
        for x in range(40):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d <= r or (y >= 22 and 13 <= x <= 26 and y <= 29):
                k = 'g'
                if d <= r and x + 0.5 < cx - 2 and y + 0.5 < cy - 2 and d >= r - 4: k = 'h'
                elif (x + 0.5 - cx) + (y + 0.5 - cy) > 9: k = 'y'
                g.set(x, y, k)
    for x, y in [(13, 9), (14, 8), (13, 10), (15, 8)]: g.set(x, y, 'w')
    for y in range(30, 38):            # metal base with threads
        for x in range(14, 26):
            g.set(x, y, 'm' if y % 2 == 0 else 'n')
    for x in range(16, 24): g.set(x, 38, 'n')
    for x in range(17, 23): g.set(x, 16, 'f'); g.set(x, 22, 'f')     # filament
    for y in range(16, 23): g.set(17, y, 'f'); g.set(22, y, 'f')
    g.outline()
    return g
def book():
    g = Grid(52, 32)
    for x in range(52):
        t = abs(x - 25.5) / 24.0
        top = 4 + round(3 * (1 - t)); bot = 25 + round(3 * (1 - t))
        for y in range(top - 2, bot + 3):
            if 1 <= x <= 50: g.set(x, y, 'c')                         # cover
        for y in range(top, bot):
            if 3 <= x <= 48: g.set(x, y, 'p' if x < 26 else 'q')       # pages
        if x in (25, 26):
            for y in range(top, bot): g.set(x, y, 'r')                # spine
    for row in range(5):
        for x in list(range(6, 22)) + list(range(30, 46)):
            t = abs(x - 25.5) / 24.0
            y = 4 + round(3 * (1 - t)) + 4 + row * 4
            if (x // 3) % 4 != 3: g.set(x, y, 'z')
    g.outline()
    return g
ARROW = ['X............', 'XX...........', 'XWX..........', 'XWWX.........', 'XWWWX........', 'XWWWWX.......',
         'XWWWWWX......', 'XWWWWWWX.....', 'XWWWWWWWX....', 'XWWWWWWWWX...', 'XWWWWWWWWWX..', 'XWWWWWWWWWWX.',
         'XWWWWWWXXXXXX', 'XWWWXWWX.....', 'XWWXXWWWX....', 'XWX..XWWX....', 'XX...XWWWX...', 'X.....XWWX...',
         '......XWWWX..', '.......XWWX..', '.......XXX...']
SPARK7 = ['...a...', '...a...', '..aba..', 'aabcbaa', '..aba..', '...a...', '...a...']
SPARK5 = ['..a..', '.aba.', 'abcba', '.aba.', '..a..']
PLANE = ['..................XX',
         '...............XXWX.',
         '............XXWWWX..',
         '.........XXWWWWWX...',
         '......XXWWWWWWWWX...',
         '...XXWWWWWWWWWWX....',
         'XXWWWWWWWWWWWWWX....',
         '.XXXSSSSWWWWWWX.....',
         '....XSSSSXWWWWX.....',
         '.....XSSSXXWWX......',
         '......XSSX.XWX......',
         '.......XX...XX......']
