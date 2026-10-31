import json, math, sys
from scene import *
cmd('layer.select', layer=2834)
layer('sun')
glow = [(x, y) for y in range(120, 166) for x in range(330, 420) if 21 <= math.hypot(x + 0.5 - 375, y + 0.5 - 160) <= 30 and (x + y) % 2 == 0]
merged_pixels(glow, '#fff6dc', 'sun glow')
sel_ellipse(355, 140, 40, 40); fill('#fff1b8')
sel_ellipse(355, 140, 40, 40); sel_rect(355, 158, 40, 22, 'intersect'); fill('#ffe08a')
cmd('select.deselect')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
