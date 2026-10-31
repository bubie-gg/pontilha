import json, sys
from flat import *
PINK = dict(face='#ff9fb0', lip='#d85a74', sheen='#ffc4cf')
TEAL = dict(face='#8fe0d6', lip='#3f9a96', sheen='#c4f3ec')
def bubble(x, y, w, h, c, tail, layer):
    rrect(x, y + 2, w, h, 6, c['lip'], layer=layer)
    rrect(x, y, w, h, 6, c['face'], layer=layer)
    rrect(x + 2, y + 1, w - 4, 5, 2, c['sheen'], layer=layer, onlyOn=c['face'])
    poly(tail, c['face'], layer=layer)
cmd('layer.select', layer='shadow')
cmd('layer.new', name='cast')
# "!" bubble, upper left, tail pointing at the key
bubble(152, 10, 28, 22, PINK, [[168, 31], [176, 31], [182, 40]], 'cast')
cmd('draw.rect', x=164, y=14, w=4, h=9, color=CREAM, filled=True, layer='cast')
cmd('draw.rect', x=164, y=25, w=4, h=3, color=CREAM, filled=True, layer='cast')
# "..." bubble, upper right
bubble(268, 14, 34, 20, TEAL, [[274, 33], [281, 33], [270, 41]], 'cast')
for x in (276, 283, 290):
    cmd('draw.rect', x=x, y=21, w=4, h=4, color=CHOC, filled=True, layer='cast')
# light bulb, right
cmd('draw.ellipse', x=276, y=56, w=18, h=18, color='#fff3b0', filled=True, layer='cast')
cmd('draw.ellipse', x=279, y=59, w=6, h=5, color='#ffffff', filled=True, layer='cast')
cmd('draw.ellipse', x=281, y=65, w=10, h=8, color='#ffd66b', filled=True, layer='cast', onlyOn='#fff3b0')
cmd('draw.rect', x=280, y=73, w=10, h=7, color='#c9b8a0', filled=True, layer='cast')
for y in (75, 77):
    line(280, y, 289, y, '#8f7c66', layer='cast')
cmd('draw.rect', x=282, y=80, w=6, h=2, color='#8f7c66', filled=True, layer='cast')
# open manual, lower left
poly([[150, 78], [166, 74], [166, 94], [150, 98]], '#e3566f', layer='cast')          # cover peeking
poly([[152, 76], [166, 73], [166, 91], [152, 94]], '#fff8ea', layer='cast')          # left page
poly([[166, 73], [181, 76], [181, 94], [166, 91]], '#f3e6cf', layer='cast')          # right page
poly([[181, 76], [183, 77], [183, 97], [166, 94], [166, 91], [181, 94]], '#e3566f', layer='cast')
for i in range(4):
    line(155, 80 + 3 * i, 163, 78 + 3 * i, '#c9b8a0', layer='cast')
    line(169, 78 + 3 * i, 178, 80 + 3 * i, '#c9b8a0', layer='cast')
cmd('effect.outline', color=CHOC, layer='cast')
# bulb rays and sparkles on their own layer (no outline)
cmd('layer.new', name='fx')
for (x0, y0, x1, y1) in [(273, 59, 270, 57), (285, 52, 285, 49), (297, 59, 300, 57), (272, 67, 269, 67), (298, 67, 301, 67)]:
    line(x0, y0, x1, y1, '#d9902f')
for (cx, cy, r) in [(190, 18, 4), (262, 92, 3), (140, 52, 3), (300, 100, 4), (205, 104, 2)]:
    cmd('draw.star', cx=cx, cy=cy, outer=r, inner=1, points=4, color='#fff3b0')
    cmd('draw.pixels', pixels=[[cx, cy, '#ffffff']])
# paper plane looping in from the lower right
plane = ['.......kk',
         '.....kkwk',
         '...kkwwwk',
         '.kkwwwwk.',
         'kwwwwwwk.',
         '.kkwwbwk.',
         '...kbbk..',
         '....kk...']
cmd('draw.pattern', x=292, y=104, rows=plane, legend={'k': CHOC, 'w': CREAM, 'b': '#dcc6a3'})
for i in range(0, 34, 4):
    x = 290 - i; y = 113 + (i * i) // 140
    line(x, y, x - 1, y, '#c98a3a')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
