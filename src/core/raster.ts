import { sameColor } from './color';

export type Plot = (x: number, y: number) => void;

/**
 * 1px line. Exact 1:1, 2:1 and 1:2 slopes use evenly repeating steps (2-2-2…),
 * the way pixel artists draw isometric lines; other slopes use Bresenham.
 */
export function line(x0: number, y0: number, x1: number, y1: number, plot: Plot) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);

  if (adx === ady || adx === 2 * ady || ady === 2 * adx) {
    const n = Math.max(adx, ady);
    const ratio = adx === ady ? 1 : 2;
    for (let i = 0; i <= n; i++) {
      if (adx >= ady) plot(x0 + sx * i, y0 + sy * Math.floor(i / ratio));
      else plot(x0 + sx * Math.floor(i / ratio), y0 + sy * i);
    }
    return;
  }

  let err = adx - ady;
  let x = x0;
  let y = y0;
  for (;;) {
    plot(x, y);
    if (x === x1 && y === y1) return;
    const e2 = 2 * err;
    if (e2 > -ady) {
      err -= ady;
      x += sx;
    }
    if (e2 < adx) {
      err += adx;
      y += sy;
    }
  }
}

/** Horizontal, vertical, 45° and the two 2:1 isometric directions. */
const PERFECT_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [2, 1],
  [1, 1],
  [1, 2],
  [0, 1],
];

/** Moves the end point onto the nearest perfect pixel-art angle from the start. */
export function snapToPerfectAngle(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return [x1, y1];
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const angle = Math.atan2(ady, adx);
  let best = PERFECT_DIRECTIONS[0];
  let bestDiff = Infinity;
  for (const dir of PERFECT_DIRECTIONS) {
    const diff = Math.abs(Math.atan2(dir[1], dir[0]) - angle);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = dir;
    }
  }
  const [rx, ry] = best;
  const k = Math.max(0, Math.round((adx * rx + ady * ry) / (rx * rx + ry * ry)));
  return [x0 + (Math.sign(dx) || 1) * rx * k, y0 + (Math.sign(dy) || 1) * ry * k];
}

export type BrushShape = 'square' | 'round';

const brushCache = new Map<string, ReadonlyArray<readonly [number, number]>>();

/** Cell offsets covered by a brush centred on the cursor pixel. */
export function brushOffsets(size: number, shape: BrushShape): ReadonlyArray<readonly [number, number]> {
  const key = `${size}:${shape}`;
  const cached = brushCache.get(key);
  if (cached) return cached;
  const out: Array<[number, number]> = [];
  const start = -Math.floor((size - 1) / 2);
  const c = (size - 1) / 2;
  const r2 = (size / 2 - 0.25) ** 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (shape === 'round' && size > 2 && (i - c) ** 2 + (j - c) ** 2 > r2) continue;
      out.push([start + i, start + j]);
    }
  }
  brushCache.set(key, out);
  return out;
}

export function rectCells(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean,
  thickness: number,
  plot: Plot,
) {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const edge =
        x - left < thickness || right - x < thickness || y - top < thickness || bottom - y < thickness;
      if (filled || edge) plot(x, y);
    }
  }
}

/** Indices of the pixels a bucket fill at (x, y) would recolour. */
export function floodFill(
  pixels: Uint32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  contiguous: boolean,
): number[] {
  if (x < 0 || y < 0 || x >= width || y >= height) return [];
  const start = y * width + x;
  const target = pixels[start];
  const out: number[] = [];

  if (!contiguous) {
    for (let i = 0; i < pixels.length; i++) if (sameColor(pixels[i], target)) out.push(i);
    return out;
  }

  const seen = new Uint8Array(width * height);
  const stack = [start];
  seen[start] = 1;
  const visit = (n: number) => {
    if (!seen[n] && sameColor(pixels[n], target)) {
      seen[n] = 1;
      stack.push(n);
    }
  };
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const px = i % width;
    if (px > 0) visit(i - 1);
    if (px < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < width * (height - 1)) visit(i + width);
  }
  return out;
}

/**
 * Ellipse inscribed in the box [x, x+w) × [y, y+h), decided per pixel centre so
 * even and odd sizes both come out symmetric. Outlines drop the doubled corner
 * pixels so the curve reads as a clean 1px line.
 */
export function ellipseCells(
  x: number,
  y: number,
  w: number,
  h: number,
  filled: boolean,
  thickness: number,
  plot: Plot,
) {
  if (w <= 0 || h <= 0) return;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const inside = (px: number, py: number, inset: number) => {
    const rx = w / 2 - inset;
    const ry = h / 2 - inset;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (px + 0.5 - cx) / rx;
    const dy = (py + 0.5 - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };

  if (filled) {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) if (inside(px, py, 0)) plot(px, py);
    return;
  }

  // Ring: inside the outer ellipse, and touching the outside through a 4-neighbour
  // either of the ellipse itself or of the inner edge of a thicker ring.
  const ring = new Set<number>();
  const key = (px: number, py: number) => (py - y + 1) * (w + 2) + (px - x + 1);
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (!inside(px, py, 0)) continue;
      const edge =
        !inside(px - 1, py, 0) || !inside(px + 1, py, 0) || !inside(px, py - 1, 0) || !inside(px, py + 1, 0);
      if (edge || (thickness > 1 && !inside(px, py, thickness))) ring.add(key(px, py));
    }
  }
  if (thickness === 1) {
    // Remove L corners: a ring pixel whose only ring neighbours are one horizontal and one vertical.
    const has = (px: number, py: number) => ring.has(key(px, py));
    const corners: number[] = [];
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (!has(px, py)) continue;
        const hz = (has(px - 1, py) ? 1 : 0) + (has(px + 1, py) ? 1 : 0);
        const vt = (has(px, py - 1) ? 1 : 0) + (has(px, py + 1) ? 1 : 0);
        const diag =
          (has(px - 1, py - 1) ? 1 : 0) + (has(px + 1, py - 1) ? 1 : 0) + (has(px - 1, py + 1) ? 1 : 0) + (has(px + 1, py + 1) ? 1 : 0);
        if (hz === 1 && vt === 1 && diag === 0) corners.push(key(px, py));
      }
    }
    for (const k of corners) ring.delete(k);
  }
  for (const k of ring) {
    const px = (k % (w + 2)) - 1 + x;
    const py = Math.floor(k / (w + 2)) - 1 + y;
    plot(px, py);
  }
}

/** Transparent pixels next to painted ones: where a sprite outline goes. */
export function outlineIndices(pixels: Uint32Array, width: number, height: number, corners: boolean): number[] {
  const out: number[] = [];
  const painted = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && pixels[y * width + x] >>> 24 !== 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (painted(x, y)) continue;
      const near =
        painted(x - 1, y) ||
        painted(x + 1, y) ||
        painted(x, y - 1) ||
        painted(x, y + 1) ||
        (corners && (painted(x - 1, y - 1) || painted(x + 1, y - 1) || painted(x - 1, y + 1) || painted(x + 1, y + 1)));
      if (near) out.push(y * width + x);
    }
  }
  return out;
}

export type Point = readonly [number, number];

/** Even-odd test of point (x, y) against a polygon. */
function insidePolygon(points: readonly Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[j];
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) hit = !hit;
  }
  return hit;
}

/**
 * Polygon through points given in pixel coordinates (fractions allowed). Filled
 * polygons cover every pixel whose position falls inside, plus their edges.
 */
export function polygonCells(points: readonly Point[], filled: boolean, plot: Plot) {
  if (points.length < 2) return;
  if (filled && points.length >= 3) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (insidePolygon(points, x, y)) plot(x, y);
      }
    }
  }
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    line(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), plot);
  }
}

export function regularPolygonPoints(cx: number, cy: number, radius: number, sides: number, rotation: number): Point[] {
  return Array.from({ length: sides }, (_, k) => {
    const a = ((rotation + (360 / sides) * k) * Math.PI) / 180;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
  });
}

/**
 * Star centred on (cx, cy). Each covered pixel is reported with the index of the
 * facet it sits on (two facets per point, counted clockwise from the first tip),
 * so callers can shade facets separately.
 */
export function starCells(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  tips: number,
  rotation: number,
  plot: (x: number, y: number, facet: number) => void,
) {
  const step = 180 / tips;
  const corners = Array.from({ length: tips * 2 }, (_, k) => {
    const a = ((rotation + step * k) * Math.PI) / 180;
    const r = k % 2 === 0 ? outer : inner;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      if (!insidePolygon(corners, x, y)) continue;
      const angle = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
      const facet = Math.floor((((angle - rotation) % 360) + 360) % 360 / step) % (tips * 2);
      plot(x, y, facet);
    }
  }
}

/**
 * Firework burst: `rays` straight rays from radius `inner` to `outer`. Each plotted
 * pixel reports how far along the ray it is (0 at the centre, 1 at the tip) so
 * callers can grade colours. `dash` = [on, off] pixels along the ray breaks the
 * rays into sparks; `alternate` scales the length of every other ray.
 */
export function burstCells(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  rays: number,
  rotation: number,
  dash: readonly [number, number] | null,
  alternate: number,
  plot: (x: number, y: number, t: number) => void,
) {
  const period = dash ? dash[0] + dash[1] : 0;
  for (let k = 0; k < rays; k++) {
    const angle = ((rotation + (360 / rays) * k) * Math.PI) / 180;
    const length = k % 2 === 1 ? inner + (outer - inner) * alternate : outer;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let last = '';
    for (let r = inner; r <= length; r += 0.5) {
      if (period > 0 && (r - inner) % period >= dash![0]) continue;
      const x = Math.floor(cx + dx * r);
      const y = Math.floor(cy + dy * r);
      const key = `${x},${y}`;
      if (key === last) continue;
      last = key;
      plot(x, y, outer === inner ? 1 : (r - inner) / (outer - inner));
    }
  }
}
