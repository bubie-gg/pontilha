"""Anime-inspired My Bubie parts, generated from the existing sprites' geometry.

Every part is built from masks of the parts it sits on (casing, screen, jacket)
so it registers in every view and size. Output: one RGBA image per
(part, size, view), saved under OUT and used as the recipe for Pontilha.

    python3 -I gerar.py OUT_DIR [--sheet PREVIEW.png]
"""
import os
import sys
from PIL import Image, ImageDraw

SPRITES = '/home/des1re/www/bubie/frontend/public/my-bubie/v1'
O = (0x3B, 0x2B, 0x27, 255)  # My Bubie outline


def hexc(s):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


C = {k: hexc(v) for k, v in {
    # cube clips
    'bl': '#bfe9ff', 'bb': '#5fb4f0', 'bs': '#3577c4',
    'yl': '#fff5b8', 'yb': '#f6cf3a', 'ys': '#c48f17', 'w': '#ffffff',
    # straw hat
    'sl': '#f9e7a0', 'sb': '#e7c35d', 'ss': '#bb8d37', 'sd': '#8a6326',
    'rb': '#d8433a', 'rs': '#9e2b2d',
    # cloth keys (ninja band recolours)
    'cl': '#4c4547', 'cm': '#38333a', 'cd': '#29252b',
    # steel plate
    'pl': '#eef1f5', 'pb': '#b9c1cd', 'ps': '#7b8698', 'pr': '#566072',
    # fox mask
    'fw': '#fbfaf7', 'fs': '#d7d3df', 'fr': '#e2453c', 'fk': '#a5282b',
    # blindfold
    'kl': '#433c4d', 'kb': '#26222c', 'ks': '#16131a',
    # triangle shades
    'tl': '#ffb27a', 'tb': '#ff5a1f', 'ts': '#b8320f',
    # bamboo
    'gl': '#cde492', 'gb': '#86b552', 'gs': '#567f35', 'gn': '#3d6229', 'cr': '#c73a3a',
    # sailor collar
    'nl': '#4a5f9e', 'nb': '#2d3f7a', 'ns': '#1f2c58', 'nw': '#f4f1ea',
    'rr': '#e04545', 'rd': '#a82e35',
    # haori checks
    'g1': '#4fbf7d', 'g2': '#2c8a55', 'g3': '#1d6640',
    'k1': '#45434c', 'k2': '#2a292f', 'k3': '#18171b',
}.items()}

VIEWS = {'front': '', 'q': '.q', 's': '.s', 'rq': '.rq', 'b': '.b'}
SIZE = {'normal': 96, 'small': 32}


def sprite(name, size, view):
    base = SPRITES if size == 'normal' else f'{SPRITES}/small'
    path = f'{base}/{name}{VIEWS[view]}.png'
    if not os.path.exists(path) and view == 'b':
        path = f'{base}/{name}.png'
    return Image.open(path).convert('RGBA') if os.path.exists(path) else None


def mask(name, size, view):
    im = sprite(name, size, view)
    n = SIZE[size]
    return [[bool(im and im.getpixel((x, y))[3]) for x in range(n)] for y in range(n)]


class Canvas:
    def __init__(self, n):
        self.n = n
        self.im = Image.new('RGBA', (n, n), (0, 0, 0, 0))

    def put(self, x, y, c):
        if 0 <= x < self.n and 0 <= y < self.n and c:
            self.im.putpixel((x, y), c)

    def get(self, x, y):
        return self.im.getpixel((x, y)) if 0 <= x < self.n and 0 <= y < self.n else (0, 0, 0, 0)

    def pattern(self, x0, y0, rows, legend, clip=None):
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch in legend:
                    x, y = x0 + dx, y0 + dy
                    if clip and not clip(x, y):
                        continue
                    self.put(x, y, legend[ch])

    def poly(self, points, c):
        layer = Image.new('L', (self.n, self.n), 0)
        ImageDraw.Draw(layer).polygon(points, fill=255)
        for y in range(self.n):
            for x in range(self.n):
                if layer.getpixel((x, y)):
                    self.put(x, y, c)

    def ellipse(self, box, c):
        layer = Image.new('L', (self.n, self.n), 0)
        ImageDraw.Draw(layer).ellipse(box, fill=255)
        for y in range(self.n):
            for x in range(self.n):
                if layer.getpixel((x, y)):
                    self.put(x, y, c)

    def outline(self):
        """A 1 px outline around everything painted, 4-connected."""
        painted = {(x, y) for y in range(self.n) for x in range(self.n) if self.get(x, y)[3]}
        for x, y in list(painted):
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if (x + dx, y + dy) not in painted:
                    self.put(x + dx, y + dy, O)

    def edges(self):
        """Repaint the outermost painted pixels as outline (for shapes built flush)."""
        painted = {(x, y) for y in range(self.n) for x in range(self.n) if self.get(x, y)[3]}
        for x, y in painted:
            if any((x + dx, y + dy) not in painted for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                self.put(x, y, O)


def bbox(name, size, view):
    im = sprite(name, size, view)
    return im.getbbox() if im else None


# ---------------------------------------------------------------- cube clips
def cube_clips(size, view):
    cv = Canvas(SIZE[size])
    if size == 'normal':
        wide = [".oooooo.", "oLLLBBBo", "oLWBBBBo", "oLBBBBBo", "oBBBBBSo", "oBBBBSSo", "oBSSSSSo", ".oooooo."]
        mid = [".ooooo.", "oLLBBBo", "oLWBBBo", "oLBBBBo", "oBBBBSo", "oBBBSSo", "oBSSSSo", ".ooooo."]
        thin = [".oooo.", "oLLBBo", "oLWBBo", "oLBBBo", "oBBBSo", "oBBSSo", "oBSSSo", ".oooo."]
        place = {'front': (wide, 25, 26), 'q': (mid, 28, 29), 's': (wide, 53, 54),
                 'rq': (thin, 62, 62), 'b': (wide, 63, 62)}
        rows, bx, yx = place[view]
        by, yy = 40, 47
    else:
        rows = ["oooo", "oLBo", "oBSo", "oooo"]
        place = {'front': (5, 5), 'q': (6, 6), 's': (18, 18), 'rq': (22, 22), 'b': (23, 23)}
        bx, yx = place[view]
        by, yy = 3, 6
        if view == 'rq':
            rows = ["ooo", "oBo", "oSo", "ooo"]
    cv.pattern(bx, by, rows, {'o': O, 'L': C['bl'], 'B': C['bb'], 'S': C['bs'], 'W': C['w']})
    cv.pattern(yx, yy, rows, {'o': O, 'L': C['yl'], 'B': C['yb'], 'S': C['ys'], 'W': C['w']})
    return cv.im


# ---------------------------------------------------------------- straw hat
def straw_hat(size, view):
    n = SIZE[size]
    cv = Canvas(n)
    x0, y0, x1, _ = bbox('shell_crt', size, view)
    x1 -= 1
    cx = (x0 + x1) / 2 + (1 if view == 'q' else 0)
    half = (x1 - x0) / 2
    if size == 'normal':
        bw, cw = half + 6, half - 7  # brim and crown half widths
        brim = (round(cx - bw), 35, round(cx + bw), 43)
        crown = (round(cx - cw), 26, round(cx + cw), 40)
        band = (35, 37)
    else:
        bw, cw = half + 2, half - 3
        # the small figure crop ends at x = 27, outline included
        brim = (max(round(cx - bw), 4), 2, min(round(cx + bw), 26), 4)
        crown = (round(cx - cw), 0, round(cx + cw), 2)
        band = (2, 2)
    # brim: a flat ellipse, its far half shadowed by the crown
    cv.ellipse(brim, C['sb'])
    bx0, by0, bx1, by1 = brim
    for y in range(by0, by1 + 1):
        for x in range(bx0, bx1 + 1):
            if cv.get(x, y)[3]:
                if y >= by1 - (1 if size == 'normal' else 0):
                    cv.put(x, y, C['ss'])
                elif y <= by0 + 1 and size == 'normal':
                    cv.put(x, y, C['sl'])
    # crown: a rounded block, lit from the top left
    cx0, cy0, cx1, cy1 = crown
    for y in range(cy0, cy1 + 1):
        for x in range(cx0, cx1 + 1):
            corner = size == 'normal' and y == cy0 and (x - cx0 < 2 or cx1 - x < 2)
            corner = corner or (y == cy0 + 1 and size == 'normal' and (x == cx0 or x == cx1))
            corner = corner or (size == 'small' and y == cy0 and (x == cx0 or x == cx1))
            if corner:
                continue
            c = C['sb']
            if x - cx0 < (2 if size == 'normal' else 1) or y - cy0 < (2 if size == 'normal' else 1):
                c = C['sl']
            if cx1 - x < (2 if size == 'normal' else 1):
                c = C['ss']
            cv.put(x, y, c)
    # weave texture on the straw
    if size == 'normal':
        for y in range(cy0 + 2, cy1 - 2):
            for x in range(cx0 + 2, cx1 - 1):
                if (x + 2 * y) % 5 == 0 and cv.get(x, y) == C['sb']:
                    cv.put(x, y, C['ss'])
        for y in range(by0 + 2, by1 - 1):
            for x in range(bx0, bx1 + 1):
                if (x + y) % 4 == 0 and cv.get(x, y) == C['sb']:
                    cv.put(x, y, C['ss'])
    # the red band around the base of the crown
    for y in range(band[0], band[1] + 1):
        for x in range(cx0, cx1 + 1):
            if cv.get(x, y)[3]:
                cv.put(x, y, C['rs'] if y == band[1] and size == 'normal' else C['rb'])
    cv.outline()
    return cv.im


# ---------------------------------------------------------------- ninja band
def ninja_band(size, view):
    n = SIZE[size]
    cv = Canvas(n)
    shell = mask('shell_crt', size, view)
    x0, y0, x1, _ = bbox('shell_crt', size, view)
    rows = (40, 44) if size == 'normal' else (3, 5)
    top, bot = rows
    for y in range(top, bot + 1):
        for x in range(n):
            if shell[y][x]:
                if y == top or y == bot:
                    c = O
                elif y == top + 1:
                    c = C['cl']
                elif y == bot - 1 and size == 'normal':
                    c = C['cd']
                else:
                    c = C['cm']
                cv.put(x, y, c)
    # the band stands 1 px proud of the casing on both sides
    for y in range(top + 1, bot):
        xs = [x for x in range(n) if shell[y][x]]
        if xs:
            cv.put(xs[0] - 1, y, O)
            cv.put(xs[-1] + 1, y, O)
            cv.put(xs[0], y, C['cm'])
            cv.put(xs[-1], y, C['cd'])
    plate = {'o': O, 'L': C['pl'], 'B': C['pb'], 'S': C['ps'], 'R': C['pr']}
    if size == 'normal':
        wide = ["oooooooooooooooo", "oLLLLLLLLLLLLLLo", "oLRBBBBBBBBBBRSo", "oLBBBBBBBBBBBBSo",
                "oLRBBBBBBBBBBRSo", "oBSSSSSSSSSSSSSo", "oooooooooooooooo"]
        narrow = [r[:7] + r[9:] for r in wide]
        knot = [".oo..", "oCCo.", "oCDCo", ".oCo.", "..oo.", ".oCo.", "oCCo.", "oCo..", "oo..."]
        if view == 'front':
            cv.pattern(40, 39, wide, plate)
        elif view == 'q':
            cv.pattern(46, 39, narrow, plate)
        elif view == 's':
            cv.pattern(61, 39, ["ooo", "oLo", "oBo", "oBo", "oBo", "oSo", "ooo"], plate)
            cv.pattern(x0 - 4, 40, knot, {'o': O, 'C': C['cm'], 'D': C['cd']})
        elif view in ('rq', 'b'):
            kx = 44 if view == 'rq' else 46
            cv.pattern(kx, 40, [".ooo.", "oCDCo", ".oCo."], {'o': O, 'C': C['cm'], 'D': C['cd']})
            tails = ["oCo.oCo", "oCo.oCo", "oCo.oCo", "oCoooCo", ".oCoCo.", "..oo.oo"]
            cv.pattern(kx - 1, 43, tails, {'o': O, 'C': C['cm']})
    else:
        if view == 'front':
            cv.pattern(13, 2, ["oooooo", "oLLLLo", "oBBBBo", "oooooo"], plate)
        elif view == 'q':
            cv.pattern(15, 2, ["ooooo", "oLLLo", "oBBBo", "ooooo"], plate)
        elif view == 's':
            cv.pattern(x0 - 2, 3, ["oo", "oC", ".o"], {'o': O, 'C': C['cm']})
        elif view in ('rq', 'b'):
            kx = 14 if view == 'rq' else 15
            cv.pattern(kx, 5, ["oCo", "oCo", ".o."], {'o': O, 'C': C['cm']})
    return cv.im


# ---------------------------------------------------------------- fox mask
FOX_FACE = [
    "..o.........o..",
    ".oRo.......oRo.",
    ".oWRo.....oRWo.",
    ".oWWRoooooRWWo.",
    "oWWWWWWWWWWWWSo",
    "oWWWWWWWWWWWWSo",
    "oWRRKWWWWWKRRSo",
    "oWWooWWWWWooWSo",
    "oWWWWWWWWWWWWSo",
    "oWWWWWWWWWWWSSo",
    ".oWWWWWRWWWWSo.",
    ".oWWWWWRWWWSSo.",
    "..oWWWWWWWSSo..",
    "...oooSSSooo...",
    "......ooo......",
]
FOX_BACK = [
    "..o.........o..",
    ".oWo.......oWo.",
    ".oWWo.....oWWo.",
    ".oWWWoooooWWSo.",
    "oWWWWWWWWWWWWSo",
    "oWWWWWWWWWWWWSo",
    "oRRRRRRRRRRRRRo",
    "oWWWWWWWWWWWWSo",
    "oWWWWWWWWWWWWSo",
    "oWWWWWWWWWWWSSo",
    ".oWWWWWWWWWWSo.",
    ".oWWWWWWWWWSSo.",
    "..oWWWWWWWSSo..",
    "...oooSSSooo...",
    "......ooo......",
]
FOX_SMALL = ["o.....o", "oRoooRo", "oWWWWSo", "oRoWoRo", "oWWRWSo", ".oWWSo.", "..ooo.."]
FOX_SMALL_BACK = ["o.....o", "oWoooWo", "oWWWWSo", "oRRRRRo", "oWWWWSo", ".oWWSo.", "..ooo.."]


def fox_mask(size, view):
    n = SIZE[size]
    cv = Canvas(n)
    legend = {'o': O, 'W': C['fw'], 'S': C['fs'], 'R': C['fr'], 'K': C['fk']}
    shell = mask('shell_crt', size, view)
    behind = lambda x, y: not shell[y][x]
    if size == 'normal':
        place = {'front': (FOX_FACE, 57, 32, None), 'q': (FOX_FACE, 56, 32, None),
                 's': (FOX_BACK, 43, 29, behind), 'rq': (FOX_BACK, 25, 32, None),
                 'b': (FOX_BACK, 24, 32, None)}
    else:
        place = {'front': (FOX_SMALL, 20, 0, None), 'q': (FOX_SMALL, 20, 0, None),
                 's': (FOX_SMALL_BACK, 13, -1, behind), 'rq': (FOX_SMALL_BACK, 6, 0, None),
                 'b': (FOX_SMALL_BACK, 5, 0, None)}
    rows, x, y, clip = place[view]
    cv.pattern(x, y, rows, legend, clip)
    if clip:
        cv.edges()
    return cv.im


# ---------------------------------------------------------------- blindfold
def blindfold(size, view):
    n = SIZE[size]
    cv = Canvas(n)
    shell = mask('shell_crt', size, view)
    top, bot = (45, 51) if size == 'normal' else (5, 8)
    for y in range(top, bot + 1):
        xs = [x for x in range(n) if shell[y][x]]
        if not xs:
            continue
        for x in range(xs[0] - 1, xs[-1] + 2):
            if y in (top, bot) or x in (xs[0] - 1, xs[-1] + 1):
                c = O
            elif y == top + 1:
                c = C['kl']
            elif y == bot - 1 and size == 'normal':
                c = C['ks']
            else:
                c = C['kb']
            cv.put(x, y, c)
    if view == 'q':
        # the side panel turns away from the light
        sx = bbox('screen_crt', size, 'q')[0] - (2 if size == 'normal' else 1)
        for y in range(top + 1, bot):
            for x in range(n):
                if x < sx and cv.get(x, y) in (C['kl'], C['kb']):
                    cv.put(x, y, C['ks'] if cv.get(x, y) == C['kb'] else C['kb'])
    return cv.im


# ---------------------------------------------------------------- triangle shades
def triangle_shades(size, view):
    n = SIZE[size]
    cv = Canvas(n)
    if size == 'normal':
        dx = 0 if view == 'front' else 7
        left = [(34 + dx + (1 if view == 'q' else 0), 42), (46 + dx, 46), (44 + dx, 51)]
        right = [(61 + dx, 42), (49 + dx, 46), (51 + dx, 51)]
        for tri in (left, right):
            cv.poly(tri, C['tb'])
        # glare streak and lower shadow on each lens
        for y in range(n):
            for x in range(n):
                if cv.get(x, y) == C['tb']:
                    below = cv.get(x, y + 1)[3] == 0
                    if below or cv.get(x + 1, y + 1)[3] == 0:
                        cv.put(x, y, C['ts'])
                    elif (x - dx - y) in (-9, -8) or (x - dx + y) in (98, 99):
                        cv.put(x, y, C['tl'])
        cv.outline()
        for x in range(46 + dx, 50 + dx):
            cv.put(x, 46, O)  # bridge
    else:
        dx = 0 if view == 'front' else 3
        cv.pattern(9 + dx, 4, ["oo.........oo", "oTTo.....oTTo", ".oTTooooooTo.", "..oTo...oTo..", "...o.....o..."],
                   {'o': O, 'T': C['tb']})
    return cv.im


# ---------------------------------------------------------------- bamboo
def bamboo(size, view):
    n = SIZE[size]
    cv = Canvas(n)
    shell = mask('shell_crt', size, view)
    if size == 'normal':
        y = 52
        if view == 's':
            xs = [x for x in range(n) if shell[y][x]]
            for x in range(xs[0], xs[-1] - 1):
                cv.put(x, y, C['cr'])
            cv.pattern(xs[-1] - 1, 49, [".ooo.", "oGGGo", "oGNGo", "oSGSo", ".ooo."],
                       {'o': O, 'G': C['gb'], 'N': C['gn'], 'S': C['gs']})
            return cv.im
        cx = 48 if view == 'front' else 55
        tx0, tx1 = cx - 10, cx + 10
        xs = [x for x in range(n) if shell[y][x]]
        for x in range(xs[0], xs[-1] + 1):
            cv.put(x, y, C['cr'])  # the cord, tied behind the casing
        for x in range(tx0, tx1 + 1):
            for yy, c in ((50, O), (51, C['gl']), (52, C['gb']), (53, C['gs']), (54, O)):
                cv.put(x, yy, c)
        for nx in (cx - 5, cx + 5):
            for yy in (51, 52, 53):
                cv.put(nx, yy, C['gn'])
            cv.put(nx + 1, 51, C['gl'])
        for yy in (51, 52, 53):
            cv.put(tx0 - 1, yy, O)
            cv.put(tx1 + 1, yy, O)
    else:
        y = 10
        xs = [x for x in range(n) if shell[y][x]]
        if view == 's':
            for x in range(xs[0], xs[-1]):
                cv.put(x, y, C['cr'])
            cv.pattern(xs[-1] - 1, 9, ["oo", "Go", "oo"], {'o': O, 'G': C['gb']})
            return cv.im
        cx = 16 if view == 'front' else 18
        for x in range(xs[0], xs[-1] + 1):
            cv.put(x, y, C['cr'])
        cv.pattern(cx - 4, 9, ["ooooooooo", "oGGNGGNGo", "ooooooooo"], {'o': O, 'G': C['gb'], 'N': C['gn']})
    return cv.im


# ---------------------------------------------------------------- sailor collar
BOW = [".oo...oo.", "oRRoooRRo", "oRRDKDRRo", "oDRoooRDo", ".oo.o.oo.", "...oRo...", "..oRoRo..", "..oo.oo.."]
BOW_LEGEND = {'o': O, 'R': C['rr'], 'D': C['rd'], 'K': C['rd']}


def sailor_collar(size, view):
    n = SIZE[size]
    cv = Canvas(n)
    navy = {'N': C['nb'], 'L': C['nl'], 'S': C['ns'], 'W': C['nw'], 'o': O}
    if size == 'normal':
        if view in ('front', 'q'):
            dx = 0 if view == 'front' else 2
            far = 1 if view == 'q' else 0
            cv.poly([(33 + dx + far * 2, 64), (46 + dx, 64), (48 + dx, 75), (35 + dx + far * 2, 70)], C['nb'])
            cv.poly([(62 + dx, 64), (49 + dx, 64), (47 + dx, 75), (60 + dx, 70)], C['nb'])
            # white stripe one pixel inside each lapel's outer edge
            for y in range(n):
                for x in range(n):
                    if cv.get(x, y) == C['nb']:
                        inner = all(cv.get(x + a, y + b)[3] for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                        if not inner and y > 64:
                            cv.put(x, y, C['nw'])
            cv.outline()
            cv.pattern(44 + dx, 70, BOW, BOW_LEGEND)
        elif view in ('b', 'rq'):
            x0 = 36 if view == 'b' else 38
            w = 24 if view == 'b' else 22
            flap = ["o" * w]
            flap += ["o" + "L" * (w - 2) + "o"]
            flap += ["o" + "W" * (w - 3) + "No"]
            for _ in range(9):
                flap += ["oWN" + "N" * (w - 6) + "WNo".rjust(3, 'N')[:3]]
            flap += ["o" + "W" * (w - 3) + "So", "o" + "S" * (w - 2) + "o", "o" * w]
            flap = [r[:w].ljust(w, 'o') for r in flap]
            cv.pattern(x0, 63, flap, navy)
        elif view == 's':
            flap = ["oooooo", "oLLLLo", "oWWWNo", "oWNNWo", "oWNNWo", "oWNNWo", "oWNNWo", "oWWWWo", "oSSSSo", "oooooo"]
            cv.pattern(41, 63, flap, navy)
            cv.pattern(53, 63, ["oooo", "oNNo", "oWNo", ".oWo", "..oo"], navy)
            cv.pattern(54, 66, [".oo", "oRo", "oRo", ".oo"], BOW_LEGEND)
    else:
        if view in ('front', 'q'):
            dx = 0 if view == 'front' else 1
            cv.pattern(9 + dx, 15, ["ooooo..ooooo", "oNNWo..oWNNo", ".oNWoooWoNo.", "..ooRoRoo...", "....oRo....."],
                       {**navy, 'R': C['rr']})
        elif view in ('b', 'rq'):
            x0 = 10 if view == 'b' else 11
            cv.pattern(x0, 15, ["oooooooooooo", "oWWWWWWWWWWo", "oWNNNNNNNNWo", "oWWWWWWWWWWo", "oooooooooooo"], navy)
        elif view == 's':
            cv.pattern(13, 15, ["oooo", "oWWo", "oNWo", "oWWo", "oooo"], navy)
    return cv.im


# ---------------------------------------------------------------- checkered haori
def haori(size, view):
    src = sprite('top_jacket', size, view)
    n = SIZE[size]
    cv = Canvas(n)
    cell = 3 if size == 'normal' else 2
    tone = {(0x4c, 0x45, 0x47): 0, (0x38, 0x33, 0x3a): 1, (0x29, 0x25, 0x2b): 2}
    for y in range(n):
        for x in range(n):
            p = src.getpixel((x, y))
            if not p[3]:
                continue
            t = tone.get(p[:3])
            if t is None:
                cv.put(x, y, p if p[:3] == O[:3] else C['k2'])
                continue
            green = ((x // cell) + (y // cell)) % 2 == 0
            ramp = ('g1', 'g2', 'g3') if green else ('k1', 'k2', 'k3')
            cv.put(x, y, C[ramp[t]])
    return cv.im


PARTS = {
    'head_cube_clips': (cube_clips, ['front', 'q', 's', 'rq', 'b']),
    'head_straw_hat': (straw_hat, ['front', 'q', 's', 'rq', 'b']),
    'head_ninja_band': (ninja_band, ['front', 'q', 's', 'rq', 'b']),
    'head_fox_mask': (fox_mask, ['front', 'q', 's', 'rq', 'b']),
    'face_blindfold': (blindfold, ['front', 'q']),
    'face_triangle_shades': (triangle_shades, ['front', 'q']),
    'mouthwear_bamboo': (bamboo, ['front', 'q', 's']),
    'neck_sailor_collar': (sailor_collar, ['front', 'q', 's', 'rq', 'b']),
    'top_checkered_haori': (haori, ['front', 'q', 's', 'rq', 'b']),
}


def main():
    out = sys.argv[1]
    os.makedirs(f'{out}/small', exist_ok=True)
    for pid, (fn, views) in PARTS.items():
        for size in ('normal', 'small'):
            for view in views:
                im = fn(size, view)
                d = out if size == 'normal' else f'{out}/small'
                im.save(f'{d}/{pid}{VIEWS[view]}.png')
    if '--sheet' in sys.argv:
        sheet(out, sys.argv[sys.argv.index('--sheet') + 1])


def dressed(pid, size, view, out):
    """The default Bubie wearing one part, in renderer layer order."""
    order = ['base_body', 'bottom', 'base_feet', 'base_arms', 'top', 'neck', 'base_hands', 'shell_crt',
             'screen_crt', 'eyes_dots', 'mouth_neutral', 'face', 'head', 'mouthwear']
    slot = pid.split('_')[0]
    n = SIZE[size]
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    hidden_face = view in ('s', 'rq', 'b')
    for layer in order:
        if layer == slot:
            d = out if size == 'normal' else f'{out}/small'
            f = f'{d}/{pid}{VIEWS[view]}.png'
            if os.path.exists(f):
                im.alpha_composite(Image.open(f).convert('RGBA'))
            continue
        if layer in ('bottom', 'neck', 'face', 'head', 'mouthwear'):
            continue
        name = 'top_hoodie' if layer == 'top' else layer
        if hidden_face and name in ('screen_crt', 'eyes_dots', 'mouth_neutral'):
            continue
        s = sprite(name, size, view)
        if s:
            im.alpha_composite(s)
    return im


def sheet(out, path):
    rows = []
    for pid, (_, views) in PARTS.items():
        row = Image.new('RGBA', (96 * 5 + 32 * 5 + 20, 96), (246, 241, 232, 255))
        for i, v in enumerate(['front', 'q', 's', 'rq', 'b']):
            row.alpha_composite(dressed(pid, 'normal', v, out), (i * 96, 0))
            row.alpha_composite(dressed(pid, 'small', v, out), (96 * 5 + 20 + i * 32, 32))
        rows.append(row.crop((0, 20, row.width, 96)))
    h = sum(r.height for r in rows)
    sh = Image.new('RGBA', (rows[0].width, h), (246, 241, 232, 255))
    y = 0
    for r in rows:
        sh.alpha_composite(r, (0, y))
        y += r.height
    sh.resize((sh.width * 2, sh.height * 2), Image.NEAREST).save(path)


if __name__ == '__main__':
    main()
