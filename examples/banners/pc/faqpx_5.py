import json, math, sys
from px import *
cmd('layer.delete', layer=102)
cmd('layer.select', layer=25)
layer('hoodie')
def outlined(sel, body):
    sel()
    c = chan('obj')
    cmd('select.saveSelection', name=c)
    cmd('select.modify.expand', radius=1, applyAtCanvasBounds=True)
    fill(CHOC)
    cmd('select.loadSelection', channel=c)
    fill(body)
torso = [[338, 251], [344, 214], [358, 192], [384, 178], [412, 172], [492, 172], [520, 178], [546, 192], [560, 214], [566, 251]]
def torso_sel(mode='replace'): cmd('select.lasso', points=torso, mode=mode, antiAlias=False)
outlined(torso_sel, '#34303a')
torso_sel(); sel_rect(338, 170, 46, 81, 'intersect'); fill('#403b48')           # lit left side
cmd('select.lasso', points=[[346, 212], [358, 193], [384, 179], [412, 173], [412, 176], [386, 182], [361, 196], [349, 214]], antiAlias=False); fill('#4b4654')   # shoulder rim light
torso_sel(); sel_rect(522, 170, 46, 81, 'intersect'); fill('#29262e')           # shaded right side
# kangaroo pocket peeking at the bottom edge
cmd('select.lasso', points=[[394, 251], [400, 236], [504, 236], [510, 251]], antiAlias=False)
pk = chan('pk'); cmd('select.saveSelection', name=pk); cmd('select.modify.expand', radius=1); fill('#25222a')
cmd('select.loadSelection', channel=pk); fill('#383340')
sel_rect(402, 237, 100, 1); fill('#46414e')
# rolled hood: a rounded band the head rests on, light along its top
def hood_sel(mode='replace'): sel_rrect(392, 150, 120, 30, 15, mode)
outlined(hood_sel, '#3e3945')
hood_sel(); sel_rect(392, 150, 120, 7, 'intersect'); fill('#4d4857')
hood_sel(); sel_rect(392, 172, 120, 8, 'intersect'); fill('#302c36')
for x in (414, 452, 490):                                                      # fabric folds
    for i in range(6): sel_rect(x + (i // 3), 160 + i, 1, 1); fill('#2a2730')
# drawstrings with aglets
for (x0, x1) in [(438, 432), (466, 472)]:
    for y in range(178, 222):
        x = round(x0 + (x1 - x0) * (y - 178) / 44)
        sel_rect(x, y, 2, 1); fill('#f4bf69')
        sel_rect(x + 1, y, 1, 1); fill('#d9a04a')
    sel_rect(x1 - 1, 221, 4, 6); fill(CHOC)
    sel_rect(x1, 222, 2, 4); fill('#c98a3a')
cmd('select.deselect')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
