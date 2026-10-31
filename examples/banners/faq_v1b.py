import json, sys
from flat import *
def qmark(x, y, color, layer):
    cmd('draw.ellipse', x=x, y=y, w=24, h=22, thickness=6, color=color, layer=layer)
    cmd('draw.polygon', points=[[x - 1, y + 11], [x + 12, y + 11], [x + 12, y + 23], [x - 1, y + 23]], color='transparent', layer=layer, onlyOn=color)
    cmd('draw.ellipse', x=x, y=y + 7, w=6, h=6, color=color, filled=True, layer=layer)
    cmd('draw.rect', x=x + 9, y=y + 18, w=6, h=7, color=color, filled=True, layer=layer)
    cmd('draw.ellipse', x=x + 8, y=y + 28, w=8, h=8, color=color, filled=True, layer=layer)
cmd('layer.new', name='glyph_drop')
qmark(215, 36, GOLD['lip'], 'glyph_drop')
cmd('layer.new', name='glyph')
qmark(214, 34, CREAM, 'glyph')
cmd('effect.outline', color=CHOC, layer='glyph')
# cursor: the classic arrow, clicking the key's lower-right
arrow = ['k...........',
         'kk..........',
         'kwk.........',
         'kwwk........',
         'kwwwk.......',
         'kwwwwk......',
         'kwwwwwk.....',
         'kwwwwwwk....',
         'kwwwwwwwk...',
         'kwwwwwwwwk..',
         'kwwwwwwwwwk.',
         'kwwwwwwkkkkk',
         'kwwwkwwk....',
         'kwwkkwwwk...',
         'kwk..kwwk...',
         'kk...kwwwk..',
         'k.....kwwk..',
         '......kkk...']
cmd('layer.new', name='cursor')
cmd('draw.pattern', x=246, y=68, rows=arrow, legend={'k': CHOC, 'w': CREAM})
# click burst at the arrow tip
for (x0, y0, x1, y1) in [(243, 65, 240, 62), (246, 63, 246, 59), (241, 69, 237, 69)]:
    line(x0, y0, x1, y1, CHOC)
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
