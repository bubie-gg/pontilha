import { describe, expect, it } from 'vitest';
import { toBase64 } from './base64';
import { blendOver, pack, parseHex, toHex } from './color';
import { createDoc, createFrame, sampleComposite, showFrame } from './doc';
import { History } from './history';
import { encodePng, scaleNearest, zlibDeflate, zlibInflate } from './png';
import { parseProject, serializeProject } from './project';
import { brushOffsets, floodFill, line, snapToPerfectAngle } from './raster';
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
