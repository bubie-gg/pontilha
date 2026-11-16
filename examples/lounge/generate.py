#!/usr/bin/env python3
"""
Recipes for the Lounge furniture (Bubie), in native pixels on 80 × 40 tiles.

Isometric unit: 1 step in u (grid x axis, going down to the right) or in v
(grid y axis, going down to the left) moves 2 px horizontally and 1 px vertically;
a tile is 20 units. z is the height in pixels. The front of each piece faces +v
(screen left), like the sofa. Light from above: light top, medium front face (+v),
dark side face (+u).

Each PNG comes out with the front vertex of the base diamond at the horizontal center,
on the bottom edge: that is the anchor the Lounge registers. Run `python3 generate.py` to
rewrite the JSON; then `pontilha run <piece>.json 0.1` draws it live in the window.
"""
import json
import math
from pathlib import Path

TILE = 20
OUT = '#241d2a'
SHADOW = '#262234'

# Materials: top, front (+v), side (+u), highlight on the top edge.
TEAL = dict(top='#91dfd4', left='#53aaa9', right='#347a88', rim='#bcece0')
WOOD = dict(top='#d7ac73', left='#b77d4d', right='#724533', rim='#f2cf96')
DARKWOOD = dict(top='#724533', left='#4d302c', right='#3a2428', rim='#b77d4d')
METAL = dict(top='#94899c', left='#65596e', right='#423343', rim='#c3b9cb')
CREAM = dict(top='#fff1d6', left='#f4bf69', right='#c98a3a', rim=None)
ACCENT = dict(top='#ffd88f', left='#f4bf69', right='#c98a3a', rim='#fff1d6')
RED = dict(top='#f0715e', left='#c93c4a', right='#8a2340', rim=None)
SCREEN = dict(top='#494256', left='#353144', right='#262234', rim='#65596e')
RUG = dict(top='#347a88', left='#2c5669', right='#233b51', rim=None)


class Mobi:
    def __init__(self, name, cols, rows, description):
        self.name = f'{name}.{cols}x{rows}'
        self.description = description
        self.U = cols * TILE
        self.V = rows * TILE
        self.ops = []
        self.colors = []

    # Projection: screen offset from the front vertex of the footprint.
    def P(self, u, v, z=0):
        return (2 * (u - v) - 2 * (self.U - self.V), (u + v) - (self.U + self.V) - z)

    def _use(self, *colors):
        for c in colors:
            if c and c[:7] not in self.colors:
                self.colors.append(c[:7])

    def layer(self, name):
        self.ops.append(('layer', name))

    def poly(self, pts, color, only_on=None, frame=None, layer=None):
        self._use(color)
        self.ops.append(('poly', [tuple(p) for p in pts], color, dict(onlyOn=only_on, frame=frame, layer=layer)))

    def ellipse(self, cx, cy, w, h, color, only_on=None, frame=None, layer=None):
        self._use(color)
        self.ops.append(('ellipse', cx, cy, w, h, color, dict(onlyOn=only_on, frame=frame, layer=layer)))

    def line(self, p0, p1, color, rim=False):
        """A line between pixels; a rim runs along a face edge, so it stops one pixel before the far corner."""
        self._use(color)
        self.ops.append(('line', tuple(p0), tuple(p1), color, rim))

    def dots(self, pts, color):
        """Single pixels at projected points, for buttons, studs and lights."""
        self._use(color)
        self.ops.append(('dots', [tuple(p) for p in pts], color))

    def outline(self):
        self._use(OUT)
        self.ops.append(('outline',))

    def raw(self, step):
        self.ops.append(('raw', step))

    def shadow(self, u, v, w, h):
        """Oval shadow on the floor, centred on (u, v), drawn on its own bottom layer."""
        self.layer('shadow')
        cx, cy = self.P(u, v)
        self.ellipse(cx, cy, w, h, SHADOW)

    def floor_shadow(self, u0, u1, v0, v1):
        """Shadow shaped like the footprint, for long pieces an oval can't follow."""
        self.layer('shadow')
        self.face_top(u0, u1, v0, v1, 0, SHADOW)

    def face_top(self, u0, u1, v0, v1, z, color, **kw):
        P = self.P
        self.poly([P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z)], color, **kw)

    def face_front(self, u0, u1, v, z0, z1, color, **kw):
        """A rectangle on the plane facing +v (the front of the room)."""
        P = self.P
        self.poly([P(u0, v, z1), P(u1, v, z1), P(u1, v, z0), P(u0, v, z0)], color, **kw)

    def box(self, u0, u1, v0, v1, z0, z1, mat, name=None, outline=True):
        """Solid block; a name puts it on a new layer (outlined on its own)."""
        if name:
            self.layer(name)
        P = self.P
        self.poly([P(u0, v1, z1), P(u1, v1, z1), P(u1, v1, z0), P(u0, v1, z0)], mat['left'])
        self.poly([P(u1, v1, z1), P(u1, v0, z1), P(u1, v0, z0), P(u1, v1, z0)], mat['right'])
        self.face_top(u0, u1, v0, v1, z1, mat['top'])
        if mat.get('rim'):
            self.line(P(u0, v1, z1), P(u1, v1, z1), mat['rim'], rim=True)
        if name and outline:
            self.outline()

    # Output

    def _points(self):
        for op in self.ops:
            if op[0] == 'poly':
                yield from op[1]
            elif op[0] == 'ellipse':
                _, cx, cy, w, h, *_ = op
                yield (cx - w / 2, cy - h / 2)
                yield (cx + w / 2, cy + h / 2)
            elif op[0] == 'line':
                yield op[1]
                yield op[2]
            elif op[0] == 'dots':
                yield from op[1]

    def recipe(self):
        pts = list(self._points())
        reach = max(max(-x for x, _ in pts), max(x for x, _ in pts)) + 2
        W = 2 * math.ceil(reach)
        H = math.ceil(-min(y for _, y in pts)) + 2
        X = lambda x: x + W / 2
        Y = lambda y: y + H

        def xy(p):
            return [round(X(p[0]), 2), round(Y(p[1]), 2)]

        steps = [
            {'id': 'doc.new', 'params': {'width': W, 'height': H, 'name': self.name}},
            {'id': 'palette.set', 'params': {'colors': self.colors}},
        ]
        first_layer = True
        for op in self.ops:
            kind = op[0]
            if kind == 'layer':
                if first_layer:
                    steps.append({'id': 'layer.setProps', 'params': {'name': op[1]}})
                    first_layer = False
                else:
                    steps.append({'id': 'layer.new', 'params': {'name': op[1]}})
            elif kind == 'poly':
                _, pts_, color, extra = op
                params = {'points': [xy(p) for p in pts_], 'color': color, **{k: v for k, v in extra.items() if v}}
                steps.append({'id': 'draw.polygon', 'params': params})
            elif kind == 'ellipse':
                _, cx, cy, w, h, color, extra = op
                params = {'x': round(X(cx - w / 2)), 'y': round(Y(cy - h / 2)), 'w': w, 'h': h, 'color': color, 'filled': True}
                params.update({k: v for k, v in extra.items() if v})
                steps.append({'id': 'draw.ellipse', 'params': params})
            elif kind == 'line':
                _, p0, p1, color, rim = op
                a, b = xy(p0), xy(p1)
                # A rim sits on the top row of the face below the edge, ending inside the far corner.
                x1 = math.floor(b[0]) - (1 if rim else 0)
                steps.append({'id': 'draw.line', 'params': {'x0': math.floor(a[0]), 'y0': math.floor(a[1]), 'x1': x1, 'y1': math.floor(b[1]), 'color': color}})
            elif kind == 'dots':
                _, pts_, color = op
                steps.append({'id': 'draw.pixels', 'params': {'pixels': [[math.floor(X(x)), math.floor(Y(y))] for x, y in pts_], 'color': color}})
            elif kind == 'outline':
                steps.append({'id': 'effect.outline', 'params': {'color': OUT}})
            elif kind == 'raw':
                steps.append(op[1])
        steps.append({'id': 'view.fit', 'params': {}})
        return {'name': self.name, 'description': self.description, 'anchor': {'x': W / 2, 'y': H}, 'steps': steps}


def leaf(m, base, tip, width, light, mid):
    """Pointed leaf from base to tip; the upper half lit."""
    bx, by = base
    tx, ty = tip
    dx, dy = tx - bx, ty - by
    length = math.hypot(dx, dy)
    nx, ny = -dy / length * width, dx / length * width
    mx, my = bx + dx * 0.5, by + dy * 0.5
    a = (mx + nx, my + ny)
    b = (mx - nx, my - ny)
    m.poly([base, a, tip, b], mid)
    upper = a if a[1] < b[1] else b
    m.poly([base, upper, tip], light)


def armchair():
    m = Mobi('armchair', 1, 1, 'Turquoise armchair from the sofa set. Seat on its single tile (0, 0).')
    # Heights match the sofa already in the Lounge: seat ~22 px, arms ~28, back ~56.
    m.shadow(10, 10, 56, 24)
    m.box(2, 18, 3, 18, 0, 8, WOOD, 'base')
    m.box(3, 17, 3, 6, 8, 56, TEAL, 'backrest')
    m.dots([m.P(u, 6, z) for u in (6, 10, 14) for z in (47, 34)], TEAL['right'])
    m.box(3, 5, 6, 18, 8, 28, TEAL, 'left_arm')
    m.box(5, 15, 6, 18, 8, 22, TEAL, 'seat')
    # Cushion leaning on the back: chamfered panel on the front plane, lit along the top.
    m.layer('cushion')
    corners = [(8, 40), (12, 40), (13, 38), (13, 24), (12, 22), (8, 22), (7, 24), (7, 38)]
    m.poly([m.P(u, 7, z) for u, z in corners], ACCENT['left'])
    m.poly([m.P(8, 7, 40), m.P(12, 7, 40), m.P(13, 7, 38), m.P(13, 7, 35), m.P(7, 7, 35), m.P(7, 7, 38)], ACCENT['top'])
    m.outline()
    m.box(15, 17, 6, 18, 8, 28, TEAL, 'right_arm')
    return m


def coffee_table():
    m = Mobi('coffee_table', 2, 1, 'Low coffee table: wooden top, metal legs, books and a mug.')
    m.floor_shadow(7, 33, 6, 15)
    m.layer('legs')
    for u, v in [(3, 3), (3, 15), (35, 3), (35, 15)]:
        m.box(u, u + 2, v, v + 2, 0, 12, METAL)
    m.outline()
    m.box(2, 38, 2, 18, 12, 16, WOOD, 'tabletop')
    m.box(7, 17, 6, 13, 16, 19, CREAM, 'bottom_book')
    m.box(8, 16, 7, 12, 19, 21, TEAL, 'top_book')
    m.box(28, 31, 8, 11, 16, 22, ACCENT, 'mug')
    return m


def floor_lamp():
    m = Mobi('floor_lamp', 1, 1, 'Floor lamp. Frame 1 off, frame 2 on (warm light on the floor).')
    cx, cy = m.P(10, 10)
    m.layer('shine')
    m.shadow(10, 10, 40, 18)
    m.layer('foot')
    m.ellipse(cx, cy - 3, 24, 12, METAL['left'])
    m.ellipse(cx, cy - 4, 20, 9, METAL['top'])
    m.outline()
    m.layer('pole')
    for dx, color in [(-1, METAL['rim']), (0, METAL['left']), (1, METAL['right'])]:
        m.line((cx + dx, cy - 62), (cx + dx, cy - 5), color)
    m.outline()
    m.layer('shade')
    body = [(cx - 8, cy - 82), (cx + 8, cy - 82), (cx + 17, cy - 64), (cx - 17, cy - 64)]
    m.poly(body, WOOD['top'])
    m.ellipse(cx, cy - 64, 34, 10, WOOD['top'])
    m.poly([(cx, cy - 82), (cx + 8, cy - 82), (cx + 17, cy - 64), (cx + 17, cy - 57), (cx, cy - 57)], WOOD['left'], only_on=WOOD['top'])
    m.ellipse(cx, cy - 82, 16, 6, WOOD['right'])
    m.outline()
    # Second frame: the lamp on.
    m.raw({'id': 'frame.new', 'params': {'copy': True, 'duration': 600}})
    m.raw({'id': 'color.replaceAll', 'params': {'from': WOOD['top'], 'to': '#fff1d6', 'scope': 'frame'}})
    m.raw({'id': 'color.replaceAll', 'params': {'from': WOOD['left'], 'to': '#f4bf69', 'scope': 'frame'}})
    m.raw({'id': 'color.replaceAll', 'params': {'from': WOOD['right'], 'to': '#ffd88f', 'scope': 'frame'}})
    m._use('#fff1d6', '#f4bf69', '#ffd88f')
    m.ellipse(cx, cy, 72, 32, '#f4bf6966', only_on='transparent', frame=2, layer='shadow')
    m.ellipse(cx, cy - 72, 52, 40, '#fff1d633', frame=2, layer='shine')
    m.raw({'id': 'tag.add', 'params': {'name': 'off', 'from': 1, 'to': 1}})
    m.raw({'id': 'tag.add', 'params': {'name': 'on', 'from': 2, 'to': 2}})
    return m


def plant():
    m = Mobi('plant', 1, 1, 'Large plant in a turquoise ceramic pot.')
    cx, cy = m.P(10, 10)
    m.shadow(10, 10, 40, 18)
    m.layer('pot')
    m.ellipse(cx, cy - 3, 22, 10, TEAL['left'])
    m.poly([(cx - 11, cy - 3), (cx + 11, cy - 3), (cx + 15, cy - 27), (cx - 15, cy - 27)], TEAL['left'])
    m.poly([(cx, cy - 27), (cx + 15, cy - 27), (cx + 11, cy - 3), (cx + 11, cy + 2), (cx, cy + 2)], TEAL['right'], only_on=TEAL['left'])
    m.ellipse(cx, cy - 27, 32, 14, TEAL['top'])
    m.ellipse(cx, cy - 28, 26, 10, '#4d302c')
    m.outline()
    m.layer('stem')
    m.line((cx, cy - 30), (cx - 2, cy - 51), '#724533')
    m.line((cx + 1, cy - 30), (cx + 3, cy - 58), '#724533')
    m.line((cx - 1, cy - 30), (cx - 1, cy - 40), '#724533')
    m.layer('leaves')
    dark, mid, light = '#1f5e45', '#3a9150', '#7dc25b'
    m._use(dark, mid, light)
    # Back leaves first, front ones last.
    leaf(m, (cx + 3, cy - 58), (cx + 16, cy - 82), 5, mid, dark)
    leaf(m, (cx - 2, cy - 51), (cx - 10, cy - 81), 5, mid, dark)
    leaf(m, (cx + 3, cy - 56), (cx + 32, cy - 58), 4, light, mid)
    leaf(m, (cx - 2, cy - 51), (cx - 30, cy - 69), 6, light, mid)
    leaf(m, (cx - 2, cy - 51), (cx + 26, cy - 71), 6, light, mid)
    leaf(m, (cx - 1, cy - 40), (cx - 32, cy - 46), 5, light, mid)
    leaf(m, (cx - 1, cy - 40), (cx + 30, cy - 43), 5, light, mid)
    leaf(m, (cx - 1, cy - 38), (cx - 26, cy - 30), 4, mid, dark)
    leaf(m, (cx, cy - 38), (cx + 24, cy - 30), 4, mid, dark)
    m.outline()
    return m


def bookshelf():
    m = Mobi('bookshelf', 2, 1, 'Wooden bookshelf against the back wall, with three shelves of books.')
    m.floor_shadow(2, 39, 1, 13)
    m.box(2, 38, 1, 11, 0, 96, WOOD, 'shelf_case')
    m.layer('background')
    m.face_front(4, 36, 11, 6, 92, '#4d302c')
    shelves = [6, 34, 63]
    # Plank surfaces first, books on them, then the plank fronts over the books' feet.
    m.layer('planks')
    for s in shelves[1:]:
        m.face_top(4, 36, 1, 11, s + 3, WOOD['top'])
    m.layer('books')
    books = [WOOD, RED, TEAL, CREAM, METAL, ACCENT, DARKWOOD]
    rows = [
        [(5, 2, 18), (7, 2, 20), (9, 3, 16), (12, 2, 19), (14, 2, 17), (19, 3, 21), (22, 2, 18), (26, 2, 20), (28, 3, 15), (33, 2, 19)],
        [(5, 3, 20), (8, 2, 17), (10, 2, 21), (13, 3, 18), (17, 2, 16), (20, 2, 20), (24, 3, 19), (28, 2, 17), (31, 3, 21)],
        [(6, 2, 17), (8, 3, 20), (12, 2, 18), (15, 2, 21), (18, 3, 16), (25, 2, 19), (27, 3, 17), (31, 2, 20)],
    ]
    for shelf, row in zip(shelves, rows):
        base = shelf + (3 if shelf != 6 else 0)
        for i, (u, width, height) in enumerate(row):
            m.box(u, u + width, 3, 8, base, base + height, books[(i * 3 + shelf) % len(books)])
    m.outline()
    m.layer('shelves')
    for s in shelves[1:]:
        m.face_front(4, 36, 11, s, s + 3, WOOD['left'])
        m.line(m.P(4, 11, s + 3), m.P(36, 11, s + 3), WOOD['rim'], rim=True)
    return m


def rug():
    m = Mobi('rug', 3, 2, 'Turquoise rug with a gold border and a medallion in the center. Flat: you can walk on it and put furniture on top.')
    m.box(2, 58, 2, 38, 0, 2, RUG, 'rug')
    m.face_top(4, 56, 4, 36, 2, '#f4bf69')
    m.face_top(6, 54, 6, 34, 2, '#fff1d6')
    m.face_top(7, 53, 7, 33, 2, RUG['top'])
    m.face_top(20, 40, 12, 28, 2, '#53aaa9')
    m.face_top(25, 35, 16, 24, 2, '#91dfd4')
    m.face_top(28, 32, 18, 22, 2, '#f4bf69')
    for u, v in [(12, 20), (48, 20), (30, 10), (30, 30)]:
        m.face_top(u - 2, u + 2, v - 2, v + 2, 2, '#53aaa9')
    m._use('#53aaa9', '#91dfd4')
    return m


def wall_screen():
    m = Mobi('wall_screen', 3, 1,
             'Wall screen for videos, 3 tiles wide. It sits flush against the back wall (edge v = 0 of the 3 × 1 diamond), '
             'with the bottom of the screen 38 px above the floor. The anchor is the front vertex of that 3 × 1 diamond, as in the other pieces.')
    m.box(4, 56, 0, 3, 38, 100, SCREEN, 'bezel')
    m.layer('screen')
    m.face_front(6, 54, 3, 42, 96, '#233b51')
    m.poly([m.P(6, 3, 96), m.P(18, 3, 96), m.P(10, 3, 42), m.P(6, 3, 42)], '#2c5669', only_on='#233b51')
    m.poly([m.P(20, 3, 96), m.P(24, 3, 96), m.P(14, 3, 42), m.P(10, 3, 42)], '#2c5669', only_on='#233b51')
    m.face_front(25, 35, 3, 62, 76, '#f4bf69')
    m.poly([m.P(28, 3, 73), m.P(33, 3, 69), m.P(28, 3, 65)], OUT)
    m.face_front(51, 53, 3, 39, 40, '#91dfd4')
    m._use('#487588')
    return m


def entrance_pad():
    m = Mobi('entrance_pad', 2, 2, 'Entrance (spawn) platform with an arrow pointing forward. 3 frames: the ring pulses (tag "pulse", ping-pong).')
    m.shadow(20, 20, 112, 50)
    m.box(3, 37, 3, 37, 0, 4, METAL, 'platform')
    m.layer('markings')
    m.face_top(7, 33, 7, 33, 4, '#2c5669')
    m.face_top(10, 30, 10, 30, 4, '#53aaa9')
    m.face_top(12, 28, 12, 28, 4, '#233b51')
    # Two chevrons pointing along +v, towards the front of the room.
    for back in (0, 6):
        chevron = [(14, 13), (20, 19), (26, 13), (26, 17), (20, 23), (14, 17)]
        m.poly([m.P(u, v + 4 - back, 4) for u, v in chevron], '#f4bf69')
    m._use('#91dfd4', '#bcece0', '#fff1d6')
    m.raw({'id': 'frame.new', 'params': {'copy': True, 'duration': 160}})
    m.raw({'id': 'color.replaceAll', 'params': {'from': '#53aaa9', 'to': '#91dfd4', 'scope': 'frame'}})
    m.raw({'id': 'frame.new', 'params': {'copy': True, 'duration': 160}})
    m.raw({'id': 'color.replaceAll', 'params': {'from': '#91dfd4', 'to': '#bcece0', 'scope': 'frame'}})
    m.raw({'id': 'color.replaceAll', 'params': {'from': '#f4bf69', 'to': '#fff1d6', 'scope': 'frame'}})
    m.raw({'id': 'frame.setDuration', 'params': {'frame': 1, 'duration': 500}})
    m.raw({'id': 'tag.add', 'params': {'name': 'pulse', 'from': 1, 'to': 3}})
    return m


DARK = dict(top='#625a70', left='#494256', right='#353144', rim='#94899c')


def pc_desk():
    m = Mobi('pc_desk', 2, 1, 'Gaming desk with monitor, keyboard, mouse and tower. Faces +y; the chair goes on the tile in front.')
    m.floor_shadow(4, 37, 4, 17)
    m.layer('legs')
    for u, v in [(3, 3), (3, 16), (36, 3), (36, 16)]:
        m.box(u, u + 2, v, v + 2, 0, 28, METAL)
    m.outline()
    m.box(2, 39, 2, 19, 28, 32, WOOD, 'tabletop')
    m.box(33, 38, 4, 14, 32, 58, DARK, 'tower')
    m.dots([m.P(36, 14, z) for z in range(38, 54, 3)], '#91dfd4')
    m.box(18, 22, 4, 7, 32, 40, METAL, 'stand')
    m.box(7, 31, 5, 8, 40, 64, DARK, 'monitor')
    m.layer('screen')
    m.face_front(8, 30, 8, 42, 62, '#233b51')
    for z, u1 in [(57, 22), (53, 26), (49, 18)]:
        m.line(m.P(10, 8, z), m.P(u1, 8, z), '#487588')
    m.box(11, 27, 11, 15, 32, 34, DARK, 'keyboard')
    m.dots([m.P(u, 15, 34) for u in range(13, 26, 2)], '#91dfd4')
    m.box(29, 31, 12, 15, 32, 34, METAL, 'mouse')
    return m


def gamer_chair():
    m = Mobi('gamer_chair', 1, 1, 'Gaming chair turned toward the desk (back to the viewer). Seat on its single tile (0, 0).')
    cx, cy = m.P(10, 10)
    m.shadow(10, 10, 44, 20)
    m.layer('base')
    for du, dv in [(-7, 0), (7, 0), (0, -7), (0, 7)]:
        m.line(m.P(10, 10, 3), m.P(10 + du, 10 + dv, 1), METAL['left'])
    m.box(9, 11, 9, 11, 3, 18, METAL)
    m.outline()
    m.box(4, 16, 4, 14, 18, 23, DARK, 'seat')
    m.box(3, 5, 5, 14, 23, 31, DARK, 'left_arm')
    m.box(15, 17, 5, 14, 23, 31, DARK, 'right_arm')
    # Seen from behind: the backrest is on the near (+y) side.
    m.box(5, 15, 14, 17, 21, 62, DARK, 'backrest')
    for u in (7, 12):
        m.face_front(u, u + 1, 17, 24, 59, '#f4bf69')
    return m


def armchair_x():
    m = Mobi('armchair', 1, 1, 'Armchair facing +x (screen right). Seat on its single tile (0, 0).')
    m.name = 'armchair.1x1.x'
    m.shadow(10, 10, 56, 24)
    m.box(3, 18, 2, 18, 0, 8, WOOD, 'base')
    m.box(3, 6, 3, 17, 8, 56, TEAL, 'backrest')
    m.dots([m.P(6, v, z) for v in (6, 10, 14) for z in (47, 34)], TEAL['left'])
    m.box(6, 18, 3, 5, 8, 28, TEAL, 'back_arm')
    m.box(6, 18, 5, 15, 8, 22, TEAL, 'seat')
    m.layer('cushion')
    corners = [(8, 40), (12, 40), (13, 38), (13, 24), (12, 22), (8, 22), (7, 24), (7, 38)]
    m.poly([m.P(7, v, z) for v, z in corners], ACCENT['right'])
    m.poly([m.P(7, 8, 40), m.P(7, 12, 40), m.P(7, 13, 38), m.P(7, 13, 35), m.P(7, 7, 35), m.P(7, 7, 38)], ACCENT['left'])
    m.outline()
    m.box(6, 18, 15, 17, 8, 28, TEAL, 'front_arm')
    return m


def snack_counter():
    m = Mobi('snack_counter', 2, 1, 'Snack counter: coffee maker, cups and a cookie jar. Faces +y.')
    m.floor_shadow(3, 38, 3, 18)
    m.box(2, 38, 3, 18, 0, 30, WOOD, 'counter')
    m.face_front(4, 36, 18, 4, 26, TEAL['left'])
    for u in (12, 20, 28):
        m.face_front(u, u + 1, 18, 4, 26, TEAL['right'])
    m.box(1, 39, 2, 19, 30, 33, DARKWOOD, 'tabletop')
    m.box(5, 13, 5, 12, 33, 52, DARK, 'coffee_maker')
    m.face_front(7, 11, 12, 44, 49, '#233b51')
    m.dots([m.P(10, 12, 46)], '#c93c4a')
    m.box(8, 10, 12, 14, 33, 37, CREAM, 'cup_1')
    m.box(16, 18, 13, 15, 33, 37, CREAM, 'cup_2')
    m.box(19, 21, 11, 13, 33, 37, RED, 'cup_3')
    m.box(27, 34, 7, 14, 33, 44, dict(top='#bcece0', left='#91dfd4', right='#53aaa9', rim='#ffffff'), 'jar')
    m.dots([m.P(u, 14, z) for u, z in [(28, 37), (30, 39), (32, 36), (29, 41), (33, 40)]], '#b77d4d')
    return m


def sofa_x():
    m = Mobi('sofa', 1, 3, '3-seat sofa facing +x (screen right), in the style of the Lounge’s 3 × 1 sofa. Seats on tiles (0, 0), (0, 1) and (0, 2).')
    m.name = 'sofa.1x3.x'
    m.floor_shadow(4, 18, 4, 56)
    m.box(2, 19, 2, 58, 0, 8, WOOD, 'base')
    m.box(3, 7, 3, 57, 8, 54, TEAL, 'backrest')
    m.box(6, 18, 3, 7, 8, 30, TEAL, 'back_arm')
    for i, (v0, v1) in enumerate([(7, 22), (22, 38), (38, 53)]):
        m.box(7, 10, v0, v1, 22, 47, TEAL, f'back_{i + 1}')
        m.dots([m.P(10, (v0 + v1) // 2, z) for z in (40, 30)], TEAL['right'])
        m.box(7, 18, v0, v1, 8, 22, TEAL, f'seat_{i + 1}')
    m.layer('cushion')
    corners = [(42, 38), (47, 38), (48, 36), (48, 24), (47, 22), (42, 22), (41, 24), (41, 36)]
    m.poly([m.P(11, v, z) for v, z in corners], ACCENT['right'])
    m.poly([m.P(11, 42, 38), m.P(11, 47, 38), m.P(11, 48, 36), m.P(11, 48, 33), m.P(11, 41, 33), m.P(11, 41, 36)], ACCENT['left'])
    m.outline()
    m.box(6, 18, 53, 57, 8, 30, TEAL, 'front_arm')
    return m


def energy_machine():
    m = Mobi('energy_machine', 1, 1, 'Drinks machine "Bubie Energy": a window of cans, green and amber sign. Faces +y.')
    green = dict(top='#c6e77a', left='#7dc25b', right='#3a9150', rim=None)
    m.floor_shadow(4, 17, 4, 17)
    m.box(4, 16, 4, 16, 0, 84, DARK, 'cabinet')
    m.layer('front')
    m.face_front(5, 15, 16, 66, 81, green['left'])
    m.face_front(5, 15, 16, 66, 68, green['right'])
    bolt = [(11, 80), (7, 73), (10, 73), (8, 67), (13, 75), (10, 75), (12, 80)]
    m.poly([m.P(u, 16, z) for u, z in bolt], '#f4bf69')
    m.face_front(5, 12, 16, 22, 62, '#233b51')
    for z in (26, 39, 52):
        m.face_front(5, 12, 16, z, z + 1, '#353144')
        for u, col in [(6, '#7dc25b'), (8, '#f4bf69'), (10, '#7dc25b')]:
            m.face_front(u, u + 1, 16, z + 1, z + 8, col)
    m.face_front(13, 15, 16, 40, 56, '#423343')
    m.dots([m.P(14, 16, z) for z in (52, 48)], '#f4bf69')
    m.face_front(6, 13, 16, 6, 14, '#1c1722')
    m.dots([m.P(16, v, z) for v in (6, 10, 14) for z in (81,)], '#c6e77a')
    m._use('#3a9150', '#c6e77a', '#1c1722')
    return m


if __name__ == '__main__':
    here = Path(__file__).parent
    for make in [armchair, coffee_table, floor_lamp, plant, bookshelf, rug, wall_screen, entrance_pad, pc_desk, gamer_chair, armchair_x, snack_counter, sofa_x, energy_machine]:
        m = make()
        (here / f'{m.name}.json').write_text(json.dumps(m.recipe(), ensure_ascii=False, indent=1) + '\n')
        print(m.name, m.recipe()['steps'][0]['params']['width'], 'x', m.recipe()['steps'][0]['params']['height'])
