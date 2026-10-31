import json, sys
from flat import *
cmd('doc.new', width=320, height=125, name='banner-faq')
cmd('layer.setProps', name='halo')
# warm halo: concentric discs, the outer one broken into a checker dither
cmd('draw.ellipse', x=150, y=-18, w=150, h=150, color='#f4bf69', filled=True)
cmd('draw.burst', cx=225, cy=57, outer=80, inner=0, rays=24, colors=['#ffd68c'], onlyOn='#f4bf69')
dither = [[x, y, 'transparent'] for y in range(0, 125) for x in range(150, 300)
          if (x + y) % 2 == 0 and 66 ** 2 <= (x - 225) ** 2 + (y - 57) ** 2 <= 75 ** 2]
cmd('draw.pixels', pixels=dither)
cmd('layer.setProps', layer='halo', opacity=0.45)
cmd('layer.new', name='shadow', opacity=0.28)
cmd('draw.ellipse', x=196, y=96, w=60, h=10, color=CHOC, filled=True)
cmd('layer.new', name='key')
keycap(198, 28, 56, 54, 10, GOLD, 'key')
cmd('effect.outline', color=CHOC, layer='key')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
