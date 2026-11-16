import json
SIX = ["....BBBBBB....","..BBBBBBBBBB..",".BBBBBBBBBBBB.",".BBBBB...BBBB.","BBBBB.....BB..","BBBBB.........","BBBBB.........","BBBBB.BBBBBB..","BBBBBBBBBBBBB.","BBBBBBBBBBBBBB","BBBBBB...BBBBB","BBBBB....BBBBB","BBBBB....BBBBB","BBBBB....BBBBB","BBBBB....BBBBB","BBBBB....BBBBB",".BBBBB..BBBBB.",".BBBBBBBBBBBB.","..BBBBBBBBBB..","....BBBBBB...."]
SEVEN = ["BBBBBBBBBBBBBB","BBBBBBBBBBBBBB","BBBBBBBBBBBBBB","BBBB....BBBBB.","........BBBBB.",".......BBBBB..",".......BBBBB..","......BBBBB...","......BBBBB...",".....BBBBB....",".....BBBBB....","....BBBBBB....","....BBBBB.....","....BBBBB.....","...BBBBBB.....","...BBBBB......","...BBBBB......","...BBBBB......","...BBBBB......","...BBBBB......"]
DOWN = ["..BBB..","..BBB..","..BBB..","BBBBBBB",".BBBBB.","..BBB..","...B..."]
UP = list(reversed(DOWN))
assert all(len(r)==14 for r in SIX+SEVEN) and all(len(r)==7 for r in DOWN)
def bevel(rows, x, y, layer, base, light, shadow):
    return [
      {"id":"draw.pattern","params":{"x":x,"y":y,"rows":rows,"legend":{"B":shadow},"layer":layer}},
      {"id":"draw.pattern","params":{"x":x-1,"y":y-1,"rows":rows,"legend":{"B":light},"onlyOn":shadow,"layer":layer}},
      {"id":"draw.pattern","params":{"x":x+1,"y":y+1,"rows":rows,"legend":{"B":base},"onlyOn":light,"layer":layer}},
    ]
recipe = {"six": bevel(SIX, 2, 18, "seis", "#f6a531", "#ffd86b", "#c8641f"),
          "seven": bevel(SEVEN, 23, 3, "sete", "#2fc4c0", "#8af0dd", "#1b84a0"),
          "arrows": bevel(DOWN, 6, 6, "setas", "#fffdf8", "#ffffff", "#b8c2d6") + bevel(UP, 27, 26, "setas", "#fffdf8", "#ffffff", "#b8c2d6")}
open('./r67.json','w').write(json.dumps(recipe))
print({k: len(v) for k,v in recipe.items()})
