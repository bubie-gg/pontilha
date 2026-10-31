import json, sys
steps = []
def cmd(i, **p): steps.append({'id': i, 'params': p})
OUT = '#231a24'
# remove the blocky light patch from the floor
for l in ['hero', 'hero_depth', 'glow']:
    cmd('layer.delete', layer=l)
# glow rays behind the hero
cmd('layer.select', layer='walls')
cmd('layer.new', name='glow', opacity=0.85)
cmd('draw.burst', cx=181, cy=64, outer=58, inner=20, rays=18, colors=['#fff3b0', '#ffd66b', '#f4bf69'], dash=[3, 2], alternate=0.45)
cmd('layer.setProps', layer='glow', opacity=0.7)
cmd('layer.new', name='shadow', opacity=0.35)
cmd('draw.ellipse', x=166, y=96, w=30, h=9, color='#3d2a3a', filled=True)

def glyph(dx, dy, color, layer):
    x, y = 167 + dx, 38 + dy
    cmd('draw.ellipse', x=x, y=y, w=28, h=26, thickness=7, color=color, layer=layer)
    # open the lower-left of the ring so it becomes a hook
    cmd('draw.polygon', points=[[x - 1, y + 13], [x + 14, y + 13], [x + 14, y + 27], [x - 1, y + 27]], color='transparent', layer=layer, onlyOn=color)
    cmd('draw.rect', x=x + 11, y=y + 22, w=7, h=9, color=color, filled=True, layer=layer)
    cmd('draw.ellipse', x=x + 10, y=y + 34, w=9, h=9, color=color, filled=True, layer=layer)
    # rounded terminal on the left end of the hook
    cmd('draw.ellipse', x=x, y=y + 9, w=7, h=7, color=color, filled=True, layer=layer)

cmd('layer.new', name='hero_depth')
glyph(2, 3, '#a65a26', 'hero_depth')
cmd('layer.new', name='hero')
glyph(0, 0, '#f4bf69', 'hero')
# light from the top-left: a lighter band on the upper-left of every stroke
cmd('draw.ellipse', x=167, y=38, w=28, h=26, thickness=3, color='#ffd66b', onlyOn='#f4bf69', layer='hero')
cmd('draw.ellipse', x=170, y=41, w=22, h=20, thickness=2, color='#f4bf69', onlyOn='#ffd66b', layer='hero')
cmd('draw.ellipse', x=177, y=72, w=9, h=9, color='#d9902f', filled=True, onlyOn='#f4bf69', layer='hero')
cmd('draw.ellipse', x=177, y=72, w=7, h=7, color='#f4bf69', filled=True, onlyOn='#d9902f', layer='hero')
cmd('draw.pixels', layer='hero', pixels=[[172, 43, '#fff3b0'], [173, 42, '#fff3b0'], [174, 42, '#fff3b0'], [179, 74, '#fff3b0']], onlyOn='#ffd66b')
cmd('effect.outline', color=OUT, layer='hero_depth')
cmd('effect.outline', color=OUT, layer='hero')
json.dump(steps, open(sys.argv[1], 'w'))
print(len(steps))
