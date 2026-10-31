import math
def qmark(k=1.0):
    W, H = round(22 * k), round(36 * k)
    g = [['.'] * W for _ in range(H)]
    cx, cy = 10.5 * k, 10.5 * k
    for y in range(H):
        for x in range(W):
            px, py = x + 0.5, y + 0.5
            d = math.hypot(px - cx, py - cy)
            ring = 5.0 * k <= d <= 10.6 * k
            lower_left = px < cx and py > cy + 1
            if ring and not lower_left: g[y][x] = 'a'
    for y in range(round(16 * k), round(26 * k)):            # stem
        for x in range(round(9 * k), round(14 * k)): g[y][x] = 'a'
    for y in range(round(29 * k), H):            # dot
        for x in range(round(8 * k), round(15 * k)):
            if math.hypot(x + 0.5 - 11.5 * k, y + 0.5 - 32.5 * k) <= 3.3 * k: g[y][x] = 'a'
    # round the hook's left terminal
    for y in range(round(8 * k), round(15 * k)):
        for x in range(0, round(7 * k)):
            if math.hypot(x + 0.5 - 2.8 * k, y + 0.5 - 11 * k) <= 2.9 * k: g[y][x] = 'a'
    # light on the upper-left edge of each stroke, shade on the lower-right edge
    out = [row[:] for row in g]
    for y in range(H):
        for x in range(W):
            if g[y][x] != 'a': continue
            up = y == 0 or g[y - 1][x] == '.'; left = x == 0 or g[y][x - 1] == '.'
            down = y == H - 1 or g[y + 1][x] == '.'; right = x == W - 1 or g[y][x + 1] == '.'
            if up or left: out[y][x] = 'o'
            elif down or right: out[y][x] = 'd'
    return [''.join(r) for r in out]
if __name__ == '__main__':
    print('\n'.join(qmark(1.25)))
