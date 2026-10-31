import json
OUT = [
"...............O............",
"..............OO............",
".............OOO............",
"............OOOO............",
"............OOOOO...........",
"....O......OOOOOO........O..",
"....OO.....OOOOOOO......OO..",
"....OOO...OOOOOOOO.....OOO..",
".....OOO..OOOOOOOOO...OOOO..",
".....OOOO.OOOOOOOOO..OOOOO..",
".....OOOOOOOOOOOOOOOOOOOOO..",
"....OOOOOOOOOOOOOOOOOOOOOO..",
"....OOOOOOOOOOOOOOOOOOOOOOO.",
"...OOOOOOOOOOOOOOOOOOOOOOOO.",
"...OOOOOOOOOOOOOOOOOOOOOOOO.",
"..OOOOOOOOOOOOOOOOOOOOOOOOO.",
"..OOOOOOOOOOOOOOOOOOOOOOOOO.",
"..OOOOOOOOOOOOOOOOOOOOOOOOO.",
"..OOOOOOOOOOOOOOOOOOOOOOOOO.",
"..OOOOOOOOOOOOOOOOOOOOOOOOO.",
"...OOOOOOOOOOOOOOOOOOOOOOO..",
"...OOOOOOOOOOOOOOOOOOOOOOO..",
"....OOOOOOOOOOOOOOOOOOOOO...",
".....OOOOOOOOOOOOOOOOOOO....",
"......OOOOOOOOOOOOOOOOO.....",
"........OOOOOOOOOOOOO.......",
"...........OOOOOOO..........",
]
H=len(OUT); W=len(OUT[0]); assert all(len(r)==W for r in OUT)
cells={(x,y) for y,r in enumerate(OUT) for x,c in enumerate(r) if c=='O'}
cx, cy = 14.5, 25.0
def scaled(f, dy=0):
    s=set()
    for y in range(H):
        for x in range(W):
            sx = round(cx + (x - cx)/f); sy = round(cy + (y - dy - cy)/f)
            if (sx,sy) in cells: s.add((x,y))
    return s
def rows(s):
    return ["".join("O" if (x,y) in s else "." for x in range(W)) for y in range(H)]
layers = {"mid": scaled(0.74, 0), "inner": scaled(0.5, 1), "core": scaled(0.27, 2)}
X0, Y0 = 6, 1
steps = []
dark, base = "#3a1f9e", "#6b3df0"
steps.append({"id":"layer.clear","params":{"layer":"aura"}})
steps.append({"id":"draw.pattern","params":{"x":X0,"y":Y0,"rows":rows(cells),"legend":{"O":dark},"layer":"aura"}})
steps.append({"id":"draw.pattern","params":{"x":X0-1,"y":Y0-1,"rows":rows(cells),"legend":{"O":base},"onlyOn":dark,"layer":"aura"}})
for name,color in [("mid","#a875ff"),("inner","#e0bfff"),("core","#fff7ff")]:
    steps.append({"id":"draw.pattern","params":{"x":X0,"y":Y0,"rows":rows(layers[name]),"legend":{"O":color},"onlyOn":"painted","layer":"aura"}})
open('./raura.json','w').write(json.dumps(steps))
for n in ("mid","inner","core"): print(n); print("\n".join(rows(layers[n])))
