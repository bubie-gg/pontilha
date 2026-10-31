# Step builders for PhotoCraft banner recipes (engine.execute commands).
import math
steps = []
CHOC = '#3a2620'; CREAM = '#fff8ea'
def cmd(i, **p): steps.append({'id': i, 'params': p})
def shape(kind, name, fill, stroke=None, **kw):
    p = {'kind': kind, 'name': name, 'fill': fill}
    if stroke: p['stroke'] = stroke
    p.update(kw); cmd('shape.create', **p)
def ol(w=8): return {'width': w, 'color': CHOC, 'align': 'outside', 'join': 'round'}
def grad(a, b, angle=-90, style='linear'):
    return {'gradient': {'stops': [[0, a], [1, b]], 'angle': angle, 'style': style}}
def path(subs): return {'subpaths': [{'closed': True, 'knots': k} for k in subs]}
def blocks(rows, x, y, s, ch):
    """Pixel sprite as one path: horizontal runs of `ch` in rows, block size s."""
    subs = []
    for j, row in enumerate(rows):
        i = 0
        while i < len(row):
            if row[i] == ch:
                k = i
                while k < len(row) and row[k] == ch: k += 1
                x0, y0, x1, y1 = x + i * s, y + j * s, x + k * s, y + (j + 1) * s
                subs.append([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
                i = k
            else: i += 1
    return path(subs)
def dilate(rows):
    h, w = len(rows), len(rows[0])
    g = [['.'] * (w + 2) for _ in range(h + 2)]
    for j in range(h):
        for i in range(w):
            if rows[j][i] != '.':
                for dj in (-1, 0, 1):
                    for di in (-1, 0, 1):
                        g[j + 1 + dj][i + 1 + di] = 'X'
    return [''.join(r) for r in g]
def opacity(v): cmd('layer.setProps', opacity=v)
def blur(r): cmd('shape.rasterize'); cmd('filter.blur.gaussianBlur', radius=r)

def upsample(rows, f=2):
    out = []
    for r in rows:
        line = ''.join(c * f for c in r)
        out += [line] * f
    return out
def components(rows):
    """Split a sprite into 8-connected components, each as its own rows."""
    h, w = len(rows), len(rows[0]); seen = set(); comps = []
    for j in range(h):
        for i in range(w):
            if rows[j][i] != '.' and (i, j) not in seen:
                stack = [(i, j)]; seen.add((i, j)); cells = []
                while stack:
                    a, b = stack.pop(); cells.append((a, b))
                    for da in (-1, 0, 1):
                        for db in (-1, 0, 1):
                            n = (a + da, b + db)
                            if 0 <= n[0] < w and 0 <= n[1] < h and n not in seen and rows[n[1]][n[0]] != '.':
                                seen.add(n); stack.append(n)
                g = [['.'] * w for _ in range(h)]
                for a, b in cells: g[b][a] = 'X'
                comps.append([''.join(r) for r in g])
    return comps
def outlined_sprite(rows, x, y, s, name, body, line=CHOC, drop=None, dropOff=(8, 10)):
    """Pixel sprite with a one-cell outline per connected part (parts never merge)."""
    subs_line = []
    for comp in components(rows):
        subs_line += blocks(dilate(comp), x - s, y - s, s, 'X')['subpaths']
    if drop:
        dsubs = []
        for comp in components(rows):
            dsubs += blocks(dilate(comp), x - s + dropOff[0], y - s + dropOff[1], s, 'X')['subpaths']
        shape('path', name + ' drop', drop, path={'subpaths': dsubs})
    shape('path', name + ' line', line, path={'subpaths': subs_line})
    shape('path', name, body, path=blocks(rows, x, y, s, 'X'))
