import json, sys
from iso import *
OUT = '#231a24'
# ---- wall decor (between walls and glow) ---------------------------------
cmd('layer.select', layer='walls')
cmd('layer.new', name='wall_decor')
# window on the right wall: frame, sky, clouds, cross bars
wall_right_quad(284, 314, 45, 22, '#fffaf0')
wall_right_quad(286, 312, 47, 18, '#8fd8ff')
wall_right_quad(286, 312, 47, 7, '#bfe9ff')
cmd('draw.ellipse', x=292, y=55, w=8, h=4, color='#ffffff', filled=True, onlyOn='#8fd8ff')
cmd('draw.ellipse', x=297, y=53, w=7, h=5, color='#ffffff', filled=True, onlyOn='#8fd8ff')
cmd('draw.ellipse', x=303, y=61, w=7, h=3, color='#ffffff', filled=True, onlyOn='#8fd8ff')
line(299, 53, 299, 71, '#fffaf0')
line(286, 57, 312, 70, '#fffaf0')
wall_right_quad(283, 315, 66, 2, '#dcc6a3')   # sill
# light pouring from the window onto the floor
cmd('layer.select', layer='floor')
poly([[262, 96], [298, 78], [316, 98], [280, 117]], '#e0a56b', onlyOn='#d0925a')
cmd('layer.select', layer='wall_decor')
# cork notice board on the left wall
wall_left_quad(199, 229, 52, 20, '#7a4a2e')
wall_left_quad(201, 227, 53, 18, '#c8834d')
for (x, y, c) in [(203, 54, '#fffaf0'), (211, 51, '#ff8fa3'), (219, 46, '#bff3ea'), (205, 63, '#ffd66b'), (214, 59, '#fffaf0')]:
    wall_left_quad(x, x + 6, y, 6, c, onlyOn='#c8834d')
    cmd('draw.pixels', pixels=[[x + 3, y, '#e3566f']])
# scribbles on the notes
for (x, y) in [(204, 56), (212, 53), (215, 61), (206, 65)]:
    line(x, y + 1, x + 3, y, '#b39575')
cmd('effect.outline', color=OUT, layer='wall_decor')

# ---- floor props ----------------------------------------------------------
cmd('layer.select', layer='hero')
cmd('layer.move', layer='hero', direction='up')
cmd('layer.select', layer='shadow')
cmd('layer.new', name='props')
# help desk against the right wall
d = box(252, 119, 15, 7, 15, '#fffaf0', '#d0925a', '#a86b3f')
box(252, 104, 15, 7, 2, '#f3e6cf', '#e8b27a', '#c8834d')     # counter lip
line(252, 117, 282, 102, '#7a4a2e')                            # kick plate
line(252, 117, 238, 110, '#7a4a2e')
# question-mark panel on the desk front (right face)
poly([[262, 111], [272, 106], [272, 98], [262, 103]], '#5fbdb7')
cmd('draw.pattern', x=265, y=100, rows=['.yy.', 'y..y', '..y.', '.y..', '....', '.y..'], legend={'y': '#fff3b0'}, onlyOn='#5fbdb7')
# bell and papers on the counter
cmd('draw.ellipse', x=265, y=85, w=8, h=6, color='#f4bf69', filled=True)
cmd('draw.ellipse', x=266, y=86, w=3, h=2, color='#fff3b0', filled=True)
line(264, 90, 274, 90, '#a65a26')
cmd('draw.pixels', pixels=[[269, 84, '#a65a26']])
box(280, 89, 4, 3, 2, '#fffaf0', '#dcc6a3', '#b39575')
box(281, 87, 4, 3, 1, '#ffffff', '#dcc6a3', '#b39575')
# stack of books on the floor
box(214, 119, 6, 4, 4, '#ff8fa3', '#e3566f', '#a83252')
box(215, 115, 5, 4, 4, '#bff3ea', '#5fbdb7', '#3f8f93')
box(213, 111, 6, 3, 3, '#fff3b0', '#f4bf69', '#d9902f')
for (x, y) in [(214, 117), (215, 113), (213, 109)]:
    line(x - 7, y - 4, x - 1, y - 1, '#fffaf0')   # page edges on the left faces
# potted plant in the back corner
box(236, 66, 4, 4, 7, '#7a4a2e', '#e3566f', '#a83252')
for (x, y, w, h, c) in [(226, 46, 12, 10, '#3f8f93'), (234, 41, 12, 12, '#5fbdb7'), (230, 50, 14, 10, '#2a5f6b'), (238, 49, 10, 9, '#3f8f93')]:
    cmd('draw.ellipse', x=x, y=y, w=w, h=h, color=c, filled=True)
cmd('draw.pixels', pixels=[[238, 44, '#bff3ea'], [239, 44, '#bff3ea'], [229, 49, '#8fe0d6']])
cmd('effect.outline', color=OUT, layer='props')
json.dump(steps, open(sys.argv[1], 'w'))
print(len(steps))
