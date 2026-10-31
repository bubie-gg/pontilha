import { describe, expect, it } from 'vitest';
import { pack, parseHex } from './color';
import { blobify, edgeDistance, loopOffset, nearestColor, offPalette, particlesAt, posterize, rotate, shadeSides, thumbnail, wave } from './effects';

const hex = (h: string) => parseHex(h)!;

/** A mask from rows of '#' and '.'. */
function mask(rows: string[]) {
  return { width: rows[0].length, height: rows.length, mask: Uint8Array.from(rows.join('').split(''), (ch) => (ch === '#' ? 1 : 0)) };
}

describe('palette forcing', () => {
  it('moves colours to the nearest palette entry and drops faint pixels', () => {
    const palette = [hex('#000000'), hex('#ffffff'), hex('#ff0000')];
    expect(nearestColor(hex('#e01010'), palette)).toBe(hex('#ff0000'));
    const cel = Uint32Array.of(hex('#202020'), hex('#f0f0f0'), pack(200, 0, 0, 100), pack(200, 0, 0, 200));
    expect([...posterize(cel, 4, palette)]).toEqual([hex('#000000'), hex('#ffffff'), 0, hex('#ff0000')]);
  });

  it('dithers a mid grey into a checker of its neighbours', () => {
    const palette = [hex('#000000'), hex('#ffffff')];
    const cel = new Uint32Array(16).fill(hex('#808080'));
    const out = posterize(cel, 4, palette, 1);
    expect(new Set(out)).toEqual(new Set(palette));
  });

  it('reports colours outside the palette', () => {
    const cel = Uint32Array.of(hex('#000000'), hex('#123456'), hex('#123456'), 0);
    expect([...offPalette(cel, [hex('#000000')])]).toEqual([[hex('#123456'), 2]]);
  });
});

describe('edge distance', () => {
  it('measures from the rim inwards, treating the border as outside', () => {
    const { width, height, mask: m } = mask(['#####', '#####', '#####', '#####', '#####']);
    const d = edgeDistance(m, width, height);
    expect(d[0]).toBe(1);
    expect(d[2 * 5 + 2]).toBe(3);
    expect(d[1 * 5 + 1]).toBe(2);
  });

  it('lights the side facing the light and shades the other', () => {
    const { width, height, mask: m } = mask(['.....', '.###.', '.###.', '.###.', '.....']);
    const sides = shadeSides(m, width, height, -90, 1, 1); // light from above
    expect([...sides.slice(6, 9)]).toEqual([1, 1, 1]);
    expect(sides[2 * 5 + 2]).toBe(0);
    expect([...sides.slice(16, 19)]).toEqual([-1, -1, -1]);
  });
});

describe('blobify', () => {
  it('melts two close squares together and keeps their colours', () => {
    const w = 12;
    const cel = new Uint32Array(w * 6);
    const red = hex('#ff0000');
    const blue = hex('#0000ff');
    for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) cel[y * w + x] = red;
    for (let y = 1; y < 5; y++) for (let x = 7; x < 11; x++) cel[y * w + x] = blue;
    const out = blobify(cel, w, 6, 2, 0.35);
    expect(out[2 * w + 5] >>> 24).toBe(255); // the gap filled
    expect(out[2 * w + 5]).toBe(red);
    expect(out[2 * w + 6]).toBe(blue);
    expect(out[1 * w + 1]).toBe(0); // corners rounded off
  });
});

describe('motion', () => {
  it('closes whole-cycle loops and offsets by phase', () => {
    const n = 8;
    const ys = Array.from({ length: n }, (_, i) => loopOffset(i, n, 2));
    expect(ys).toEqual([0, 1, 2, 1, 0, -1, -2, -1]);
    expect(loopOffset(n, n, 2)).toBe(loopOffset(0, n, 2));
    expect(loopOffset(0, n, 2, 1, 0.25)).toBe(2);
    expect(Array.from({ length: n }, (_, i) => loopOffset(i, n, -2, 1, 0, 'bounce')).every((v) => v <= 0)).toBe(true);
  });

  it('waves columns only below the start row', () => {
    const w = 8;
    const cel = new Uint32Array(w * 8);
    for (let x = 0; x < w; x++) cel[4 * w + x] = hex('#ffffff');
    cel[0] = hex('#ff0000');
    const out = wave(cel, w, 8, { direction: 'vertical', amp: 1, wavelength: 4, phase: 0, start: 2 });
    expect(out[0]).toBe(hex('#ff0000'));
    const rows = new Set<number>();
    for (let i = 0; i < out.length; i++) if (out[i] === hex('#ffffff')) rows.add(Math.floor(i / w));
    expect(rows.size).toBeGreaterThan(1);
  });

  it('places the same particles at the same step of every loop', () => {
    const o = { count: 20, seed: 7, x: 0, y: 0, w: 32, h: 32, drift: [0, -6] as const, wobble: 1, life: 0.6, colors: 3 };
    expect(particlesAt(o, 3, 12)).toEqual(particlesAt(o, 3 + 12, 12));
    expect(particlesAt(o, 3, 12).length).toBeLessThan(20);
    expect(particlesAt({ ...o, seed: 8 }, 3, 12)).not.toEqual(particlesAt(o, 3, 12));
  });
});

it('fits thumbnails in the box', () => {
  expect(thumbnail(new Uint32Array(32 * 16), 32, 16)).toMatchObject({ width: 128, height: 64 });
  expect(thumbnail(new Uint32Array(512 * 256), 512, 256)).toMatchObject({ width: 128, height: 64 });
});

describe('rotation', () => {
  it('turns without new colours and keeps right angles exact', () => {
    const w = 9;
    const cel = new Uint32Array(w * w);
    const red = hex('#ff0000');
    const blue = hex('#0000ff');
    for (let y = 2; y < 7; y++) cel[y * w + 4] = red; // vertical bar through the centre
    cel[2 * w + 4] = blue;
    const quarter = rotate(cel, w, w, 90, 4.5, 4.5);
    for (let x = 2; x < 7; x++) expect(quarter[4 * w + x] >>> 24).toBe(255);
    expect(quarter[4 * w + 6]).toBe(blue); // the top end swings to the right
    const tilted = rotate(cel, w, w, 30, 4.5, 4.5);
    expect(new Set([...tilted].filter((c) => c))).toEqual(new Set([red, blue]));
  });
});
