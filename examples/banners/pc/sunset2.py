import json, math, random, sys
from scene import *
from sprites import Grid
cmd('layer.delete', layer=1054)
cmd('layer.delete', layer=1063)
cmd('layer.select', layer=1035)
layer('sun')
SX_, SY_, SR_ = 392, 172, 50
sel_ellipse(SX_ - SR_, SY_ - SR_, 2 * SR_, 2 * SR_); fill('#ffe27a')
sel_ellipse(SX_ - SR_, SY_ - SR_, 2 * SR_, 2 * SR_); sel_rect(SX_ - SR_, SY_ - 10, 2 * SR_, 70, 'intersect'); fill('#ffc45c')
sel_ellipse(SX_ - SR_, SY_ - SR_, 2 * SR_, 2 * SR_); sel_rect(SX_ - SR_, SY_ + 18, 2 * SR_, 50, 'intersect'); fill('#ffa64d')
cmd('select.deselect')
cuts = [(x, y) for y in range(SY_ - 6, SY_ + SR_) for x in range(SX_ - SR_, SX_ + SR_)
        if math.hypot(x + 0.5 - SX_, y + 0.5 - SY_) <= SR_ and ((y - (SY_ - 6)) % 9) < 1 + (y - (SY_ - 6)) // 12]
merged_pixels(cuts, '#ffcb8c', 'sun cuts')
cmd('layer.select', layer=1062)
layer('lights')
wire = []
for x in range(250, 641):
    t = (x - 250) / 390
    wire.append((x, round(10 + 26 * t + 22 * math.sin(math.pi * t))))
merged_pixels(wire, '#4a2c48', 'wire')
cols = ['#ffe08a', '#ff8fa3', '#8fe0d6', '#ffbd52']
for i, x in enumerate(range(262, 640, 18)):
    y = [p for p in wire if p[0] == x][0][1]
    c = cols[i % 4]
    glow = [(x + dx, y + 2 + dy) for dx in range(-4, 6) for dy in range(-2, 9) if (dx + dy) % 2 == 0 and 3.0 <= math.hypot(dx - 0.5, dy - 3) <= 4.8]
    merged_pixels(glow, '#fff2c9', 'glow')
    merged_sprite(['.kk.', 'kccK', 'kccK', 'kccK', '.kk.'], x - 1, y + 1, {'k': '#4a2c48', 'K': '#4a2c48', 'c': c}, 'bulb')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
