# Front-view helpers for the Bubie banner recipes.
steps = []
def cmd(i, **p): steps.append({'id': i, 'params': p})
def poly(pts, color, **kw): cmd('draw.polygon', points=pts, color=color, **kw)
def line(x0, y0, x1, y1, color, **kw): cmd('draw.line', x0=x0, y0=y0, x1=x1, y1=y1, color=color, **kw)
def rrect(x, y, w, h, r, color, **kw):
    """Filled rounded rectangle from two rects and four corner discs."""
    d = 2 * r
    cmd('draw.rect', x=x + r, y=y, w=w - d, h=h, color=color, filled=True, **kw)
    cmd('draw.rect', x=x, y=y + r, w=w, h=h - d, color=color, filled=True, **kw)
    for cx, cy in [(x, y), (x + w - d, y), (x, y + h - d), (x + w - d, y + h - d)]:
        cmd('draw.ellipse', x=cx, y=cy, w=d, h=d, color=color, filled=True, **kw)

CHOC = '#3a2620'          # outline, the interface glyph line
CREAM = '#fff8ea'         # warm-white glyph body
GOLD = dict(lip='#c98a3a', face='#f4bf69', sheen='#ffd68c', glint='#fff7d6', shade='#e2a650')

def keycap(x, y, w, h, r, c, layer):
    """Bubie keycap: lip below, face on top, sheen band, two glint pixels."""
    rrect(x, y + 5, w, h, r, c['lip'], layer=layer)
    rrect(x, y, w, h, r, c['face'], layer=layer)
    rrect(x + 3, y + 2, w - 6, h // 3, r - 2, c['sheen'], layer=layer, onlyOn=c['face'])
    # a soft shade on the lower face, light comes from the top-left
    rrect(x + 2, y + h - 7, w - 4, 5, 2, c['shade'], layer=layer, onlyOn=c['face'])
    cmd('draw.rect', x=x + 5, y=y + 4, w=3, h=3, color=c['glint'], filled=True, layer=layer)
    cmd('draw.rect', x=x + 9, y=y + 4, w=2, h=2, color=c['glint'], filled=True, layer=layer)
