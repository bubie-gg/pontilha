import { describe, expect, it } from 'vitest';
import { toBase64 } from './base64';
import { blendOver, pack, parseHex, rgbToHsv, toHex, unpack } from './color';
import { createDoc, createFrame, sampleComposite, showFrame } from './doc';
import { History } from './history';
import { hueShiftRamp } from './palette';
import { encodePng, scaleNearest, zlibDeflate, zlibInflate } from './png';
import { parseProject, serializeProject } from './project';
import { brushOffsets, floodFill, line, rectCells, snapToPerfectAngle } from './raster';
import { DEFAULT_SETTINGS, startSession } from './tools';

const RED = pack(255, 0, 0);
const BLUE = pack(0, 0, 255);

function points(x0: number, y0: number, x1: number, y1: number) {
  const out: string[] = [];
  line(x0, y0, x1, y1, (x, y) => out.push(`${x},${y}`));
  return out;
}

/** Renders a layer as rows of '#' (painted) and '.' (empty). */
function ascii(pixels: Uint32Array, width: number) {
  const rows: string[] = [];
  for (let i = 0; i < pixels.length; i += width) {
    rows.push([...pixels.subarray(i, i + width)].map((p) => (p ? '#' : '.')).join(''));
  }
  return rows;
}

describe('color', () => {
  it('round-trips hex', () => {
    expect(toHex(parseHex('#c93c4a')!)).toBe('#c93c4a');
    expect(toHex(parseHex('abc')!)).toBe('#aabbcc');
    expect(toHex(parseHex('#11223380')!)).toBe('#11223380');
    expect(parseHex('nope')).toBeNull();
  });

  it('blends straight alpha', () => {
    expect(blendOver(0, RED)).toBe(RED);
    expect(blendOver(BLUE, RED, 0)).toBe(BLUE);
    const half = blendOver(BLUE, RED, 0.5);
    expect(half & 255).toBe(128);
    expect((half >>> 16) & 255).toBe(128);
    expect(half >>> 24).toBe(255);
  });
});

describe('ramps', () => {
  const hsv = (c: number) => {
    const { r, g, b } = unpack(c);
    return rgbToHsv(r, g, b);
  };

  it('darkens towards blue and lightens towards yellow around the base', () => {
    const base = parseHex('#c93c4a')!;
    const ramp = hueShiftRamp(base, 5, 12);
    expect(ramp).toHaveLength(5);
    expect(ramp[2]).toBe(base);
    const v = ramp.map((c) => hsv(c).v);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThan(v[i - 1]);
    // Red (~355°) turns down towards blue in the shadows and up towards yellow in the lights.
    const hue = (c: number) => (hsv(c).h + 180) % 360; // unwrap around red
    expect(hue(ramp[0])).toBeLessThan(hue(ramp[1]));
    expect(hue(ramp[1])).toBeLessThan(hue(base));
    expect(hue(ramp[4])).toBeGreaterThan(hue(ramp[3]));
    expect(hsv(ramp[0]).s).toBeGreaterThan(hsv(base).s);
    expect(hsv(ramp[4]).s).toBeLessThan(hsv(base).s);
  });

  it('keeps steps distinct for greys, near-black and white', () => {
    for (const hex of ['#808080', '#0a0a0a', '#ffffff']) {
      const ramp = hueShiftRamp(parseHex(hex)!, 5, 12);
      expect(new Set(ramp).size).toBe(5);
    }
    expect(hueShiftRamp(parseHex('#336699')!, 4)).toHaveLength(4);
  });
});

describe('raster', () => {
  it('draws 2:1 lines as clean pairs', () => {
    expect(points(0, 0, 6, 3)).toEqual(['0,0', '1,0', '2,1', '3,1', '4,2', '5,2', '6,3']);
    expect(points(0, 0, 2, 4)).toEqual(['0,0', '0,1', '1,2', '1,3', '2,4']);
  });

  it('draws other lines end to end', () => {
    const pts = points(0, 0, 7, 2);
    expect(pts[0]).toBe('0,0');
    expect(pts.at(-1)).toBe('7,2');
    expect(pts).toHaveLength(8);
  });

  it('snaps to perfect angles', () => {
    expect(snapToPerfectAngle(0, 0, 9, 1)).toEqual([9, 0]);
    expect(snapToPerfectAngle(0, 0, 10, 6)).toEqual([10, 5]);
    expect(snapToPerfectAngle(0, 0, -7, -8)).toEqual([-8, -8]);
    expect(snapToPerfectAngle(5, 5, 6, 12)).toEqual([5, 12]);
  });

  it('makes round brushes', () => {
    expect(brushOffsets(1, 'round')).toEqual([[0, 0]]);
    expect(brushOffsets(3, 'round')).toHaveLength(5);
    expect(brushOffsets(3, 'square')).toHaveLength(9);
  });

  it('rounds rectangle corners', () => {
    const cells = (filled: boolean, radius: number) => {
      const out = new Set<string>();
      rectCells(0, 0, 9, 7, filled, 1, (x, y) => out.add(`${x},${y}`), radius);
      return out;
    };
    const square = cells(true, 0);
    const round = cells(true, 3);
    expect(square.size).toBe(80);
    expect(round.has('0,0') || round.has('9,7')).toBe(false);
    expect(round.has('4,0') && round.has('0,4') && round.has('9,4')).toBe(true);
    // Symmetric left to right and top to bottom.
    for (const key of round) {
      const [x, y] = key.split(',').map(Number);
      expect(round.has(`${9 - x},${y}`) && round.has(`${x},${7 - y}`)).toBe(true);
    }
    // The outline is the edge of the filled shape, with no doubled corner pixels.
    const ring = cells(false, 3);
    for (const key of ring) expect(round.has(key)).toBe(true);
    expect(ring.has('4,3')).toBe(false);
    for (const key of ring) {
      const [x, y] = key.split(',').map(Number);
      const hz = +ring.has(`${x - 1},${y}`) + +ring.has(`${x + 1},${y}`);
      const vt = +ring.has(`${x},${y - 1}`) + +ring.has(`${x},${y + 1}`);
      expect(hz + vt).toBeLessThanOrEqual(2);
    }
  });

  it('flood fills only the connected area', () => {
    const px = new Uint32Array(9);
    px[1] = px[4] = px[7] = RED; // vertical wall in a 3x3 image
    expect(floodFill(px, 3, 3, 0, 0, true).sort()).toEqual([0, 3, 6]);
    expect(floodFill(px, 3, 3, 0, 0, false)).toHaveLength(6);
  });
});

describe('tools and history', () => {
  it('removes L corners with pixel-perfect strokes', () => {
    const doc = createDoc(4, 4);
    const layer = doc.layers[0];
    const s = startSession('pencil', doc, layer, RED, DEFAULT_SETTINGS, 0, 0, false);
    s.move(1, 0, false);
    s.move(1, 1, false);
    s.move(2, 1, false);
    s.move(2, 2, false);
    s.end();
    expect(ascii(layer.pixels, 4)).toEqual(['#...', '.#..', '..#.', '....']);
  });

  it('keeps corners when pixel-perfect is off', () => {
    const doc = createDoc(3, 2);
    const layer = doc.layers[0];
    const s = startSession('pencil', doc, layer, RED, { ...DEFAULT_SETTINGS, pixelPerfect: false }, 0, 0, false);
    s.move(1, 0, false);
    s.move(1, 1, false);
    s.end();
    expect(ascii(layer.pixels, 3)).toEqual(['##.', '.#.']);
  });

  it('previews lines without leaving old segments behind', () => {
    const doc = createDoc(5, 5);
    const layer = doc.layers[0];
    const s = startSession('line', doc, layer, RED, DEFAULT_SETTINGS, 0, 0, false);
    s.move(4, 4, false);
    s.move(4, 0, false);
    s.end();
    expect(ascii(layer.pixels, 5)[0]).toBe('#####');
    expect(layer.pixels.filter(Boolean)).toHaveLength(5);
  });

  it('undoes and redoes strokes', () => {
    const doc = createDoc(4, 4);
    const layer = doc.layers[0];
    const history = new History();
    const s = startSession('rect', doc, layer, BLUE, DEFAULT_SETTINGS, 0, 0, false);
    s.move(3, 3, false);
    history.push(s.end()!);
    expect(layer.pixels.filter(Boolean)).toHaveLength(12);
    history.undo(doc);
    expect(layer.pixels.filter(Boolean)).toHaveLength(0);
    history.redo(doc);
    expect(sampleComposite(doc, 0, 0)).toBe(BLUE);
  });

  it('mirrors strokes and fills with symmetry', () => {
    const doc = createDoc(6, 4);
    const layer = doc.layers[0];
    const s = startSession('pencil', doc, layer, RED, { ...DEFAULT_SETTINGS, symmetry: 'both' }, 0, 0, false);
    s.move(1, 0, false);
    const entry = s.end();
    expect(ascii(layer.pixels, 6)).toEqual(['##..##', '......', '......', '##..##']);
    // One undo step holds every mirrored pixel.
    expect(entry?.kind === 'pixels' && entry.indices.length).toBe(8);

    const wall = createDoc(5, 1);
    wall.layers[0].pixels[2] = BLUE; // splits the row in two areas
    startSession('fill', wall, wall.layers[0], RED, { ...DEFAULT_SETTINGS, symmetry: 'vertical' }, 0, 0, false).end();
    expect([...wall.layers[0].pixels]).toEqual([RED, RED, BLUE, RED, RED]);
  });

  it('draws ellipses, and circles with shift', () => {
    const doc = createDoc(9, 9);
    const layer = doc.layers[0];
    const s = startSession('ellipse', doc, layer, RED, { ...DEFAULT_SETTINGS, ellipseFilled: true }, 0, 0, false);
    s.move(8, 4, true);
    s.end();
    const rows = ascii(layer.pixels, 9);
    // Shift turned the 9 × 5 drag into a 9 × 9 circle, symmetric both ways.
    expect(rows[4]).toBe('#########');
    expect(rows[0]).toBe(rows[8]);
    for (const row of rows) expect(row).toBe([...row].reverse().join(''));
  });

  it('erases to transparent', () => {
    const doc = createDoc(2, 1);
    const layer = doc.layers[0];
    layer.pixels.fill(RED);
    startSession('eraser', doc, layer, RED, DEFAULT_SETTINGS, 1, 0, false).end();
    expect([...layer.pixels]).toEqual([RED, 0]);
  });
});

describe('files', () => {
  it('encodes a valid PNG with the exact pixels', async () => {
    const pixels = Uint32Array.from([RED, pack(10, 20, 30, 77)]);
    const png = await encodePng(new Uint8Array(pixels.buffer), 2, 1);
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
    // IDAT data starts after signature (8) + IHDR chunk (25) + IDAT length and type (8).
    const idatLength = new DataView(png.buffer).getUint32(33);
    const raw = await zlibInflate(png.subarray(41, 41 + idatLength));
    expect([...raw]).toEqual([0, 255, 0, 0, 255, 10, 20, 30, 77]);
  });

  it('scales with nearest neighbour', () => {
    expect([...scaleNearest(Uint32Array.from([1, 2]), 2, 1, 2)]).toEqual([1, 1, 2, 2, 1, 1, 2, 2]);
  });

  it('round-trips projects', async () => {
    const doc = createDoc(3, 2);
    doc.layers[0].pixels[4] = pack(1, 2, 3, 40);
    doc.layers[0].opacity = 0.5;
    const text = await serializeProject(doc, [RED], doc.layers[0].id);
    const loaded = await parseProject(text);
    expect(loaded.doc.width).toBe(3);
    expect(loaded.doc.layers[0].pixels[4]).toBe(pack(1, 2, 3, 40));
    expect(loaded.doc.layers[0].opacity).toBe(0.5);
    expect(loaded.palette).toEqual([RED]);
  });

  it('round-trips animations', async () => {
    const doc = createDoc(2, 1);
    const second = createFrame(250);
    doc.frames = [...doc.frames, second];
    doc.layers[0].cels.set(second.id, Uint32Array.from([0, BLUE]));
    showFrame(doc, second.id);
    const loaded = await parseProject(await serializeProject(doc, [], doc.layers[0].id));
    expect(loaded.doc.frames.map((f) => f.duration)).toEqual([100, 250]);
    expect(loaded.doc.frame).toBe(loaded.doc.frames[1].id);
    expect([...loaded.doc.layers[0].pixels]).toEqual([0, BLUE]);
    expect([...loaded.doc.layers[0].cels.get(loaded.doc.frames[0].id)!]).toEqual([0, 0]);
  });

  it('opens version 1 projects as one frame', async () => {
    const rgba = toBase64(await zlibDeflate(new Uint8Array(Uint32Array.from([RED, 0]).buffer)));
    const v1 = { app: 'pontilha', version: 1, width: 2, height: 1, palette: [], activeLayer: 0, layers: [{ name: 'A', visible: true, opacity: 1, rgba }] };
    const loaded = await parseProject(JSON.stringify(v1));
    expect(loaded.doc.frames).toHaveLength(1);
    expect([...loaded.doc.layers[0].pixels]).toEqual([RED, 0]);
  });

  it('rejects files that are not projects', async () => {
    await expect(parseProject('{"app":"other"}')).rejects.toThrow('não é um projeto');
  });
});
