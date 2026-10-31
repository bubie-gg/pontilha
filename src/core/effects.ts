import { pack, unpack } from './color';

/**
 * Whole-cel effects learned from node-based pixel tools (Pixel Composer's Boo):
 * forcing a palette, shading by the distance to a shape's edge, rounding shapes
 * into blobs, wavy displacement, and the timing helpers that make animations loop.
 * Every function is pure: it reads a cel and returns new pixels or a mask.
 */

/** Painted pixels of a cel (alpha above zero), as 1 / 0. */
export function paintedMask(cel: Uint32Array): Uint8Array {
  const out = new Uint8Array(cel.length);
  for (let i = 0; i < cel.length; i++) out[i] = cel[i] >>> 24 ? 1 : 0;
  return out;
}

// Palette

/** Squared colour distance weighted by the mean red ("redmean"), close to how far apart colours look. */
export function colorDistance(a: number, b: number): number {
  const ca = unpack(a);
  const cb = unpack(b);
  const rm = (ca.r + cb.r) / 2;
  const dr = ca.r - cb.r;
  const dg = ca.g - cb.g;
  const db = ca.b - cb.b;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

export function nearestColor(c: number, palette: readonly number[]): number {
  let best = palette[0];
  let bestD = Infinity;
  for (const p of palette) {
    const d = colorDistance(c, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Every painted pixel moved to its nearest palette colour, fully opaque; pixels
 * under half alpha become transparent. `dither` (0 to 1) nudges each pixel by a
 * 4×4 ordered pattern first, so smooth gradients break into a checker between
 * neighbouring palette colours instead of hard bands.
 */
export function posterize(cel: Uint32Array, width: number, palette: readonly number[], dither = 0): Uint32Array {
  const out = new Uint32Array(cel.length);
  const opaque = palette.map((c) => (c | 0xff000000) >>> 0);
  const cache = new Map<number, number>();
  const spread = 64 * dither;
  for (let i = 0; i < cel.length; i++) {
    const c = cel[i];
    if (c >>> 24 < 128) continue;
    let probe = (c | 0xff000000) >>> 0;
    if (spread > 0) {
      const x = i % width;
      const y = (i - x) / width;
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
      const { r, g, b } = unpack(probe);
      const k = Math.round(t * spread);
      const clamp = (v: number) => Math.min(255, Math.max(0, v + k));
      probe = pack(clamp(r), clamp(g), clamp(b));
    }
    let hit = cache.get(probe);
    if (hit === undefined) {
      hit = nearestColor(probe, opaque);
      cache.set(probe, hit);
    }
    out[i] = hit;
  }
  return out;
}

/** Painted colours that are not in the palette, with how many pixels use each. */
export function offPalette(cel: Uint32Array, palette: readonly number[], into = new Map<number, number>()) {
  const allowed = new Set(palette.map((c) => (c | 0xff000000) >>> 0));
  for (const c of cel) {
    if (!(c >>> 24)) continue;
    if (c >>> 24 === 255 && allowed.has(c)) continue;
    into.set(c, (into.get(c) ?? 0) + 1);
  }
  return into;
}

// Distance to the edge

const INF = 1e20;

/** Felzenszwalb's 1D squared distance transform of `f` (length n) into `d`. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/**
 * For each pixel inside `mask`, the straight-line distance from its centre to the
 * centre of the nearest pixel outside (beyond the image counts as outside), so the
 * rim is 1; 0 outside. This is the SDF a node graph uses to light a shape's edge.
 */
export function edgeDistance(mask: Uint8Array, width: number, height: number): Float64Array {
  // Pad by one so the image border is outside.
  const w = width + 2;
  const h = height + 2;
  const grid = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x > 0 && y > 0 && x <= width && y <= height && mask[(y - 1) * width + (x - 1)];
      grid[y * w + x] = inside ? INF : 0;
    }
  }
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = Math.sqrt(grid[(y + 1) * w + (x + 1)]);
  }
  return out;
}

/**
 * Light and shadow sides of a shape: a pixel is lit (1) when, walking up to `light`
 * pixels towards the light, it leaves the shape; in shadow (-1) when walking up to
 * `dark` pixels away from it does. `angle` is where the light comes from, in degrees
 * (-135: top-left; 0 points right, 90 down). Lit wins where both apply.
 */
export function shadeSides(
  mask: Uint8Array,
  width: number,
  height: number,
  angle: number,
  light: number,
  dark: number,
): Int8Array {
  const out = new Int8Array(mask.length);
  const ux = Math.cos((angle * Math.PI) / 180);
  const uy = Math.sin((angle * Math.PI) / 180);
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  const exits = (x: number, y: number, dx: number, dy: number, steps: number) => {
    for (let k = 1; k <= steps; k++) if (!at(x + Math.round(dx * k), y + Math.round(dy * k))) return true;
    return false;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (light > 0 && exits(x, y, ux, uy, light)) out[y * width + x] = 1;
      else if (dark > 0 && exits(x, y, -ux, -uy, dark)) out[y * width + x] = -1;
    }
  }
  return out;
}

// Blobs

/** Box blur of `src` with the given radius, horizontally then vertically. */
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += x >= 0 && x < width ? src[y * width + x] : 0;
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / span;
      const add = x + radius + 1;
      const drop = x - radius;
      if (add < width) sum += src[y * width + add];
      if (drop >= 0) sum -= src[y * width + drop];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += y >= 0 && y < height ? tmp[y * width + x] : 0;
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span;
      const add = y + radius + 1;
      const drop = y - radius;
      if (add < height) sum += tmp[add * width + x];
      if (drop >= 0) sum -= tmp[drop * width + x];
    }
  }
  return out;
}

/**
 * Blur, then cut at `threshold` (0 to 1): nearby shapes melt together, corners round
 * off and thin bits vanish, like metaballs. Pixels the blob gains take the colour of
 * the nearest pixel that was painted; pixels it loses become transparent.
 */
export function blobify(cel: Uint32Array, width: number, height: number, radius: number, threshold = 0.5): Uint32Array {
  const cover = new Float32Array(cel.length);
  for (let i = 0; i < cel.length; i++) cover[i] = cel[i] >>> 24 ? 1 : 0;
  // Two box passes look close to a Gaussian.
  const blurred = boxBlur(boxBlur(cover, width, height, radius), width, height, radius);
  const nearest = nearestPainted(cel, width, height);
  const out = new Uint32Array(cel.length);
  for (let i = 0; i < cel.length; i++) {
    if (blurred[i] < threshold) continue;
    out[i] = cel[i] >>> 24 ? cel[i] : nearest[i];
  }
  return out;
}

/** For every pixel, the colour of the closest painted pixel (8-neighbour steps); 0 if the cel is empty. */
export function nearestPainted(cel: Uint32Array, width: number, height: number): Uint32Array {
  const out = new Uint32Array(cel.length);
  const queue = new Int32Array(cel.length);
  let head = 0;
  let tail = 0;
  const seen = new Uint8Array(cel.length);
  for (let i = 0; i < cel.length; i++) {
    if (cel[i] >>> 24) {
      out[i] = cel[i];
      seen[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (seen[j]) continue;
        seen[j] = 1;
        out[j] = out[i];
        queue[tail++] = j;
      }
    }
  }
  return out;
}

// Displacement and motion

export type WaveDirection = 'vertical' | 'horizontal';

export interface WaveOptions {
  /** Which way pixels move: vertical shifts each column up or down, horizontal each row sideways. */
  direction: WaveDirection;
  /** Largest shift in pixels. */
  amp: number;
  /** Pixels between two crests. */
  wavelength: number;
  /** Where the wave starts, as a fraction of a wavelength (0 to 1). */
  phase: number;
  /**
   * Row (vertical) or column (horizontal) where the wave begins: pixels before it stay
   * put and it grows to full strength over `ramp` pixels. Ghost hems, flags, capes.
   */
  start?: number;
  ramp?: number;
}

/** The cel with every column (or row) shifted along a sine wave, sampled nearest so pixels stay crisp. */
export function wave(cel: Uint32Array, width: number, height: number, o: WaveOptions): Uint32Array {
  const out = new Uint32Array(cel.length);
  const ramp = Math.max(1, o.ramp ?? 1);
  const weight = (along: number) => (o.start === undefined ? 1 : along < o.start ? 0 : Math.min(1, (along - o.start + 1) / ramp));
  const shift = (across: number) => o.amp * Math.sin(2 * Math.PI * (across / o.wavelength + o.phase));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx = x;
      let sy = y;
      if (o.direction === 'vertical') sy = Math.round(y - shift(x) * weight(y));
      else sx = Math.round(x - shift(y) * weight(x));
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      out[y * width + x] = cel[sy * width + sx];
    }
  }
  return out;
}

export type WaveShape = 'sine' | 'bounce' | 'square';

/**
 * Offset in whole pixels at step `i` of an `n`-step loop: `cycles` full waves of
 * amplitude `amp` per loop, starting `phase` (0 to 1) into the wave. Whole cycles
 * make the last frame lead back into the first without a jump. `bounce` only goes
 * one way (up when amp is negative), like a hop; `square` snaps between the ends.
 */
export function loopOffset(i: number, n: number, amp: number, cycles = 1, phase = 0, shape: WaveShape = 'sine'): number {
  const t = 2 * Math.PI * (cycles * (i / n) + phase);
  const s = shape === 'bounce' ? Math.abs(Math.sin(t / 2)) : shape === 'square' ? Math.sign(Math.sin(t)) || 1 : Math.sin(t);
  const v = Math.round(amp * s);
  return v === 0 ? 0 : v; // no -0 in results
}

// Particles

/** Small deterministic random generator (mulberry32), so the same seed gives the same sparkles. */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ParticleOptions {
  count: number;
  seed: number;
  /** Box particles start in. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** How far a particle travels over its life, in pixels. */
  drift: readonly [number, number];
  /** Sideways sway in pixels, one back-and-forth per life. */
  wobble: number;
  /** Fraction of the loop each particle is visible (0 to 1). */
  life: number;
  /** Colours over a particle's life, first at birth. */
  colors: number;
}

export interface Particle {
  x: number;
  y: number;
  /** Index into the colours, by age. */
  color: number;
}

/**
 * Where each particle is at step `i` of an `n`-step loop. Each one is born at a
 * random moment, drifts while it lives and is reborn at the same spot one loop
 * later, so the animation repeats seamlessly.
 */
export function particlesAt(o: ParticleOptions, i: number, n: number): Particle[] {
  const rand = random(o.seed);
  const out: Particle[] = [];
  const life = Math.min(1, Math.max(0.05, o.life));
  for (let k = 0; k < o.count; k++) {
    const sx = o.x + rand() * o.w;
    const sy = o.y + rand() * o.h;
    const born = rand();
    const age = (((i / n - born) % 1) + 1) % 1;
    if (age >= life) continue;
    const t = age / life;
    const sway = o.wobble * Math.sin(2 * Math.PI * t);
    const [dx, dy] = o.drift;
    const len = Math.hypot(dx, dy);
    // Sway at right angles to the drift (sideways when drifting up, or when not drifting).
    const [px, py] = len ? [-dy / len, dx / len] : [1, 0];
    const x = sx + dx * t + px * sway;
    const y = sy + dy * t + py * sway;
    out.push({ x: Math.floor(x), y: Math.floor(y), color: Math.min(o.colors - 1, Math.floor(t * o.colors)) });
  }
  return out;
}

// Thumbnails

/** The image fitted inside a size × size box, nearest-neighbour, enlarged by whole steps when small. */
export function thumbnail(pixels: Uint32Array, width: number, height: number, size = 128) {
  const scale = Math.max(width, height) <= size ? Math.max(1, Math.floor(size / Math.max(width, height))) : size / Math.max(width, height);
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));
  const out = new Uint32Array(tw * th);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < tw; x++) out[y * tw + x] = pixels[sy * width + Math.min(width - 1, Math.floor(x / scale))];
  }
  return { pixels: out, width: tw, height: th };
}

// Rotation

/**
 * The cel turned by `angle` degrees (clockwise on screen, since y points down) around
 * (cx, cy). Each new pixel takes the colour most of its 4×4 sub-samples land on, so
 * edges stay clean, thin lines survive and no new colours appear (like RotSprite).
 */
export function rotate(cel: Uint32Array, width: number, height: number, angle: number, cx = width / 2, cy = height / 2): Uint32Array {
  const out = new Uint32Array(cel.length);
  const rad = (-angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const S = 4;
  const counts = new Map<number, number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      counts.clear();
      let center = 0;
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const px = x + (i + 0.5) / S - cx;
          const py = y + (j + 0.5) / S - cy;
          const sx = Math.floor(cx + px * cos - py * sin);
          const sy = Math.floor(cy + px * sin + py * cos);
          const c = sx >= 0 && sy >= 0 && sx < width && sy < height ? cel[sy * width + sx] : 0;
          const key = c >>> 24 ? c : 0;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          if (i === S / 2 && j === S / 2) center = key;
        }
      }
      let best = center;
      let bestN = counts.get(center) ?? 0;
      for (const [c, n] of counts) if (n > bestN) [best, bestN] = [c, n];
      out[y * width + x] = best;
    }
  }
  return out;
}
