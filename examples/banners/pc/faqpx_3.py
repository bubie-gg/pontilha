import json, sys
from px import *
from sprites import *
import math
CR, CRS = '#fff8ea', '#e8d6b8'
layer('cast')
# "!" bubble, upper left, tail toward the head
g = bubble(48, 36, 9, [(30, 36, 8), (33, 37, 6), (36, 38, 4), (38, 39, 3), (40, 40, 2), (42, 41, 1)])
text_bang(g, 24, 10)
sprite(g.rows(), 312, 14, {'k': CHOC, 'f': '#ff9fb0', 'l': '#ffc4cf', 's': '#e0708a', 'w': CR, 'v': CRS}, 'bubble pink')
# "..." bubble, upper right, tail toward the head
g = bubble(60, 32, 9, [(6, 32, 8), (5, 33, 6), (4, 34, 4), (3, 35, 3), (2, 36, 2), (1, 37, 1)])
for i in range(3):
    for j in range(5):
        for k in range(5): g.set(15 + i * 13 + k, 15 + j, 'k' if k < 4 or j < 4 else 'k')
sprite(g.rows(), 530, 18, {'k': CHOC, 'f': '#8fe0d6', 'l': '#c4f3ec', 's': '#5fbdb7'}, 'bubble teal')
# light bulb, right, with rays
sprite(bulb().rows(), 548, 98, {'k': CHOC, 'g': '#fff3b0', 'h': '#ffffff', 'y': '#ffd66b', 'w': '#ffffff',
                                 'm': '#c9b8a0', 'n': '#8f7c66', 'f': '#e0a040'}, 'bulb')
rays = [(545, 103), (546, 104), (547, 105), (585, 103), (584, 104), (583, 105), (566, 92), (566, 93), (566, 94),
        (541, 114), (542, 114), (543, 114), (589, 114), (590, 114), (591, 114)]
pixels_path(rays, '#e0a040', 'bulb rays')
# open manual, lower left
sprite(book().rows(), 296, 136, {'k': CHOC, 'c': '#e3566f', 'p': '#fff8ea', 'q': '#f0e2c6', 'r': '#c9b8a0', 'z': '#c9b8a0'}, 'book')
# cursor clicking the screen
sprite(ARROW, 494, 110, {'X': CHOC, 'W': CR}, 'cursor')
pixels_path([(489, 107), (488, 106), (487, 105), (494, 104), (494, 103), (494, 102), (487, 111), (486, 111), (485, 111)], CHOC, 'click')
# sparkles
for (x, y, s) in [(372, 6, SPARK7), (528, 168, SPARK5), (288, 92, SPARK7), (606, 76, SPARK5), (426, 176, SPARK5), (612, 182, SPARK7)]:
    sprite(s, x, y, {'a': '#f0b04c', 'b': '#ffe08a', 'c': '#ffffff'}, 'spark')
# paper plane with a dotted loop
sprite(PLANE, 584, 196, {'X': CHOC, 'W': CR, 'S': '#dcc6a3'}, 'plane')
trail = []
for i in range(0, 60, 3):
    x = 582 - i; y = 214 + round(10 * math.sin(i / 60 * math.pi)) if False else 214 + (i * i) // 260
    trail += [(x, y), (x - 1, y)]
pixels_path(trail, '#d9902f', 'plane trail')
json.dump(steps, open(sys.argv[1], 'w')); print(len(steps))
