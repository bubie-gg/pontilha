# Scene kit for full-bleed pixel-art banners (640x250, opaque) drawn live in PhotoCraft.
import math, random
from px import *
from template import merged_pixels, merged_sprite
from sprites import Grid
W, H = 1320, 250
ART = 640          # width the objects were composed for; they sit at the right edge
OX[0] = W - ART

def new_scene(name):
    with background(): cmd('file.new', width=W, height=H, background='white', name=name)

def sky(bands):
    """bands: [(y_start, colour), ...] top to bottom; 2-row ordered dither between bands."""
    with background(): _sky(bands)
def _sky(bands):
    layer('sky')
    for i, (y0, c) in enumerate(bands):
        y1 = bands[i + 1][0] if i + 1 < len(bands) else H
        sel_rect(0, y0, W, y1 - y0); fill(c)
    cmd('select.deselect')
    for i in range(1, len(bands)):
        y, upper = bands[i][0], bands[i - 1][1]
        # pixels of the upper colour reaching down into the lower band, thinning out
        pts = [(x, y + 0) for x in range(W) if x % 2 == 0] + [(x, y + 1) for x in range(W) if x % 4 == 1] + [(x, y + 2) for x in range(W) if x % 8 == 3]
        merged_pixels(pts, upper, 'sky dither')

def puffs_select(puffs, dx=0, dy=0):
    for i, (x, y, w, h) in enumerate(puffs):
        sel_ellipse(x + dx, y + dy, w, h, 'replace' if i == 0 else 'add')

def cloud(puffs, base, shade, light=None, name='clouds'):
    """Flat pixel cloud: shade silhouette, base lifted 2px up, optional highlight 4px up."""
    puffs_select(puffs); fill(shade)
    c = chan('cl'); puffs_select(puffs); cmd('select.saveSelection', name=c)
    puffs_select(puffs, 0, -2); cmd('select.loadSelection', channel=c, operation='intersect'); fill(base)
    if light:
        puffs_select(puffs, 1, -5); cmd('select.loadSelection', channel=c, operation='intersect'); fill(light)
    cmd('select.deselect')

def hill(color, base, amp, period, phase=0.0, amp2=0.0, period2=1.0, top=None):
    with background(): _hill(color, base, amp, period, phase, amp2, period2)
def _hill(color, base, amp, period, phase=0.0, amp2=0.0, period2=1.0):
    pts = [[0, H]]
    for x in range(0, W + 8, 4):
        y = base - amp * math.sin(x / period + phase) - amp2 * math.sin(x / period2 + phase * 1.7)
        pts.append([x, round(y)])
    pts.append([W, H])
    cmd('select.lasso', points=pts, antiAlias=False); fill(color)
    cmd('select.deselect')

def stars(rng, n, area, colors):
    with background(): _stars(rng, n, area, colors)
def _stars(rng, n, area, colors):
    pts = {c: [] for c in colors}
    for _ in range(n):
        x = rng.randrange(area[0], area[2]); y = rng.randrange(area[1], area[3])
        pts[rng.choice(colors)].append((x, y))
    for c, p in pts.items():
        if p: merged_pixels(p, c, 'stars')

TWINKLE = ['..a..', '..a..', 'aabaa', '..a..', '..a..']
