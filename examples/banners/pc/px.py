# Pixel-art step builders for PhotoCraft: hard-edged selections and fills.
import math
steps = []
CHOC = '#2e1f1c'
OX = [0]   # x offset applied to object drawing (scenery runs inside background())
def _shift(i, p):
    dx = OX[0]
    if not dx: return p
    if i == 'select.rect' and 'x' in p: p['x'] += dx
    elif i == 'select.lasso': p['points'] = [[a + dx, b] for a, b in p['points']]
    elif i == 'shape.create':
        if 'rect' in p: p['rect'] = [p['rect'][0] + dx] + p['rect'][1:]
        if 'path' in p:
            for sp in p['path']['subpaths']:
                sp['knots'] = [[k[0] + dx, k[1]] for k in sp['knots']]
    return p
def cmd(i, **p): steps.append({'id': i, 'params': _shift(i, p)})
class background:
    """Scenery spans the whole canvas, so it is drawn without the object offset."""
    def __enter__(self): self.saved = OX[0]; OX[0] = 0
    def __exit__(self, *a): OX[0] = self.saved
_chan = [0]
def chan(prefix):
    """Unique alpha-channel name: saving under an existing name adds a duplicate
    and loading by name then returns the older one."""
    import time
    _chan[0] += 1
    return f'{prefix}_{int(time.time()) % 100000}_{_chan[0]}'
def layer(name): cmd('layer.new.layer', name=name)
def opacity(v): cmd('layer.setProps', opacity=v)
def sel_rect(x, y, w, h, mode='replace'):
    cmd('select.rect', x=x, y=y, width=w, height=h, mode=mode, antiAlias=False)
def sel_ellipse(x, y, w, h, mode='replace'):
    cmd('select.rect', x=x, y=y, width=w, height=h, mode=mode, ellipse=True, antiAlias=False)
def sel_rrect(x, y, w, h, r, mode='replace'):
    """Rounded rectangle as a union of two rects and four corner discs.
    For mode intersect/subtract the union is built in a saved channel first."""
    if mode in ('intersect', 'subtract'):
        keep, shp = chan('keep'), chan('shape')
        cmd('select.saveSelection', name=keep)
        sel_rrect(x, y, w, h, r)
        cmd('select.saveSelection', name=shp)
        cmd('select.loadSelection', channel=keep)
        cmd('select.loadSelection', channel=shp, operation=mode)
        return
    d = 2 * r
    sel_rect(x + r, y, w - d, h, mode)
    sel_rect(x, y + r, w, h - d, 'add')
    for cx, cy in [(x, y), (x + w - d, y), (x, y + h - d), (x + w - d, y + h - d)]:
        sel_ellipse(cx, cy, d, d, 'add')
def fill(color): cmd('edit.fill', contents='color', color=color)
def rrect(x, y, w, h, r, color, mode='replace'):
    sel_rrect(x, y, w, h, r, mode); fill(color)
def runs_path(rows, x, y, ch):
    subs = []
    for j, row in enumerate(rows):
        i = 0
        while i < len(row):
            if row[i] == ch:
                k = i
                while k < len(row) and row[k] == ch: k += 1
                subs.append({'closed': True, 'knots': [[x + i, y + j], [x + k, y + j], [x + k, y + j + 1], [x + i, y + j + 1]]})
                i = k
            else: i += 1
    return {'subpaths': subs}
def sprite(rows, x, y, legend, name):
    """Stamp a pixel sprite: one hard-edged shape per colour, then rasterized."""
    for ch, color in legend.items():
        p = runs_path(rows, x, y, ch)
        if p['subpaths']:
            cmd('shape.create', kind='path', name=f'{name} {ch}', fill=color, path=p)
            cmd('shape.rasterize')
def pixels_path(points, color, name):
    """Single pixels as shapes; the engine caps a path at 4096 knots, so chunk it."""
    pts = list(points)
    for k in range(0, len(pts), 1000):
        subs = [{'closed': True, 'knots': [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]} for x, y in pts[k:k + 1000]]
        cmd('shape.create', kind='path', name=f'{name} {k // 1000}', fill=color, path={'subpaths': subs})
        cmd('shape.rasterize')
