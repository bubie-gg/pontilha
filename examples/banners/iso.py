# Isometric helpers shared by the banner recipes (2:1 projection).
steps = []
def cmd(i, **p): steps.append({'id': i, 'params': p})
def poly(pts, color, **kw): cmd('draw.polygon', points=pts, color=color, **kw)
def line(x0, y0, x1, y1, color, **kw): cmd('draw.line', x0=x0, y0=y0, x1=x1, y1=y1, color=color, **kw)

def box(fx, fy, a, b, h, top, left, right, layer=None, edge=None):
    """Box whose front-bottom corner is (fx, fy); a units to the right-back,
    b units to the left-back (each unit is 2 px across, 1 px up), h px tall."""
    kw = {'layer': layer} if layer else {}
    F = (fx, fy); R = (fx + 2 * a, fy - a); L = (fx - 2 * b, fy - b)
    B = (fx + 2 * a - 2 * b, fy - a - b)
    up = lambda p: (p[0], p[1] - h)
    poly([F, L, up(L), up(F)], left, **kw)
    poly([F, R, up(R), up(F)], right, **kw)
    poly([up(F), up(R), up(B), up(L)], top, **kw)
    if edge:
        line(*up(L), *up(F), edge, **kw); line(*up(F), *up(R), edge, **kw)
    return {'F': F, 'R': R, 'L': L, 'B': B, 'top': lambda p: up(p)}

def wall_left_quad(x0, x1, y_top0, hgt, color, **kw):
    """Parallelogram lying on the left wall: vertical sides, top edge rising
    to the right at 1:2. y_top0 is the top at x0."""
    d = (x1 - x0) // 2
    poly([[x0, y_top0], [x1, y_top0 - d], [x1, y_top0 - d + hgt], [x0, y_top0 + hgt]], color, **kw)

def wall_right_quad(x0, x1, y_top0, hgt, color, **kw):
    d = (x1 - x0) // 2
    poly([[x0, y_top0], [x1, y_top0 + d], [x1, y_top0 + d + hgt], [x0, y_top0 + hgt]], color, **kw)
