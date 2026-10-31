import json, sys
from pcgen import *
for lid in (14, 13, 12):
    cmd('layer.delete', layer=lid)
cmd('layer.select', layer=11)
Q = upsample(['..XXXXX..',
              '.XXXXXXX.',
              'XXX...XXX',
              'XXX...XXX',
              '......XXX',
              '.....XXX.',
              '...XXXX..',
              '...XXX...',
              '...XXX...'])
Q += ['.' * 18] * 3
Q += upsample(['...XXX...', '...XXX...'])
S = 6; KX, KY, KW, KH = 792, 110, 224, 210
GX = KX + KW // 2 - (18 * S) // 2; GY = KY + KH // 2 - (len(Q) * S) // 2
outlined_sprite(Q, GX, GY, S, 'glyph', CREAM, drop='#c98a3a', dropOff=(6, 8))
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
