import json, math, random, sys
from scene import *
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
cmd('layer.delete', layer=2639)
cmd('layer.select', layer=1692)
layer('aurora')
for (y0, amp, ph, c1, c2) in [(30, 10, 0.0, '#7ee0c1', '#4fbfa9'), (46, 8, 1.3, '#a6f0d8', '#6fd1b8')]:
    pts1, pts2 = [], []
    for x in range(150, 640):
        fade = min(1.0, (x - 150) / 140)
        yc = y0 + amp * math.sin(x / 38 + ph) + 4 * math.sin(x / 13 + ph * 2)
        for dy in range(0, 16):
            y = int(yc + dy)
            if BAYER[y % 4][x % 4] / 16 >= fade: continue
            if dy < 3: pts1.append((x, y))
            elif (x + y) % 2 == 0 and dy < 9: pts2.append((x, y))
            elif (x % 2 == 0 and y % 2 == 0) and dy < 15: pts2.append((x, y))
    merged_pixels(pts2, c2, 'aurora'); merged_pixels(pts1, c1, 'aurora')
cmd('layer.setProps', opacity=0.75)
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
