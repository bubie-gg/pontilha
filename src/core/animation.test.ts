import { describe, expect, it } from 'vitest';
import { docFromFrames, guessFrameSize, playbackOrder, renderGif, renderSheet, sheetGrid, sliceSheet } from './animation';
import { pack } from './color';
import { createDoc, createFrame } from './doc';
import { encodeGif, lzwEncode } from './gif';

const RED = pack(255, 0, 0);
const BLUE = pack(0, 0, 255);

/** Reference LZW decoder, written from the GIF spec, to check the encoder against. */
function lzwDecode(data: Uint8Array, minCodeSize: number, length: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let table: number[][] = [];
  const reset = () => {
    table = Array.from({ length: clear }, (_, i) => [i]);
    table.push([], []);
    size = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let pos = 0;
  const read = () => {
    let code = 0;
    for (let i = 0; i < size; i++, pos++) code |= ((data[pos >> 3] >> (pos & 7)) & 1) << i;
    return code;
  };
  let prev: number[] | null = null;
  while (out.length <= length) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    const entry: number[] = code < table.length ? table[code] : [...prev!, prev![0]];
    out.push(...entry);
    if (prev && table.length < 4096) table.push([...prev, entry[0]]);
    if (table.length === 1 << size && size < 12) size++;
    prev = entry;
  }
  return out;
}

/** Splits a GIF into its palette and per-frame colour indices and delays. */
function decodeGif(bytes: Uint8Array) {
  const text = String.fromCharCode(...bytes.subarray(0, 6));
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const tableSize = 2 << (bytes[10] & 7);
  const palette: number[] = [];
  let p = 13;
  for (let i = 0; i < tableSize; i++, p += 3) palette.push(pack(bytes[p], bytes[p + 1], bytes[p + 2]));
  const frames: Array<{ delay: number; transparent: number | null; indices: number[] }> = [];
  let gce = { delay: 0, transparent: null as number | null };
  let loops = false;
  const subBlocks = () => {
    const parts: number[] = [];
    while (bytes[p] !== 0) {
      parts.push(...bytes.subarray(p + 1, p + 1 + bytes[p]));
      p += bytes[p] + 1;
    }
    p++;
    return Uint8Array.from(parts);
  };
  while (bytes[p] !== 0x3b) {
    if (bytes[p] === 0x21 && bytes[p + 1] === 0xf9) {
      gce = { delay: bytes[p + 4] | (bytes[p + 5] << 8), transparent: bytes[p + 3] & 1 ? bytes[p + 6] : null };
      p += 8;
    } else if (bytes[p] === 0x21) {
      loops ||= String.fromCharCode(...bytes.subarray(p + 3, p + 14)) === 'NETSCAPE2.0';
      p += 2;
      subBlocks();
    } else if (bytes[p] === 0x2c) {
      p += 10;
      const min = bytes[p++];
      frames.push({ ...gce, indices: lzwDecode(subBlocks(), min, width * height).slice(0, width * height) });
    } else throw new Error(`bloco inesperado ${bytes[p]} em ${p}`);
  }
  return { text, width, height, palette, frames, loops };
}

describe('gif', () => {
  it('round-trips LZW across table resets', () => {
    // Pseudo-random indices fill the 4096-entry table several times over.
    let seed = 7;
    const data = Uint8Array.from({ length: 40000 }, () => (seed = (seed * 1103515245 + 12345) >>> 0) % 16);
    expect(lzwDecode(lzwEncode(data, 4), 4, data.length)).toEqual([...data]);
    const flat = new Uint8Array(5000);
    expect(lzwDecode(lzwEncode(flat, 2), 2, flat.length)).toEqual([...flat]);
  });

  it('writes frames, delays, transparency and looping', () => {
    const a = Uint32Array.from([RED, 0, 0, BLUE]);
    const b = Uint32Array.from([0, BLUE, RED, pack(1, 2, 3, 100)]);
    const gif = encodeGif(
      [
        { pixels: a, duration: 100 },
        { pixels: b, duration: 5 },
      ],
      2,
      2,
    );
    const out = decodeGif(gif.bytes);
    expect(out.text).toBe('GIF89a');
    expect(out.loops).toBe(true);
    expect(gif.colors).toBe(2);
    expect(out.frames.map((f) => f.delay)).toEqual([10, 2]);
    const colorsOf = (f: (typeof out.frames)[number]) => f.indices.map((i) => (i === f.transparent ? 0 : out.palette[i]));
    expect(colorsOf(out.frames[0])).toEqual([...a]);
    // Under half alpha counts as transparent.
    expect(colorsOf(out.frames[1])).toEqual([0, BLUE, RED, 0]);
  });

  it('merges colours when there are more than 256', () => {
    const pixels = Uint32Array.from({ length: 1024 }, (_, i) => pack(i & 0xff, (i >> 2) & 0xff, 40));
    const gif = encodeGif([{ pixels, duration: 100 }], 32, 32);
    expect(gif.reduced).toBe(true);
    expect(gif.colors).toBeLessThanOrEqual(256);
    expect(decodeGif(gif.bytes).frames[0].indices).toHaveLength(1024);
  });
});

describe('animation export', () => {
  function threeFrames() {
    const doc = createDoc(2, 1);
    const frames = [doc.frames[0], createFrame(200), createFrame(300)];
    doc.frames = frames;
    doc.layers[0].cels.set(frames[0].id, Uint32Array.from([RED, 0]));
    doc.layers[0].cels.set(frames[1].id, Uint32Array.from([0, RED]));
    doc.layers[0].cels.set(frames[2].id, Uint32Array.from([BLUE, BLUE]));
    return doc;
  }

  it('lays frames out in a row or a grid', () => {
    expect(sheetGrid(5, 'row')).toEqual({ cols: 5, rows: 1 });
    expect(sheetGrid(5, 'grid')).toEqual({ cols: 3, rows: 2 });
    const doc = threeFrames();
    const row = renderSheet(doc, 'row');
    expect([...row.pixels]).toEqual([RED, 0, 0, RED, BLUE, BLUE]);
    const grid = renderSheet(doc, 'grid', 2);
    expect(grid.width).toBe(8);
    expect(grid.height).toBe(4);
    // Second row, first cell: frame 3 enlarged.
    expect(grid.pixels[2 * 8]).toBe(BLUE);
    expect(grid.pixels[2 * 8 + 4]).toBe(0);
  });

  it('plays there and back without repeating the ends', () => {
    expect(playbackOrder(4, true)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playbackOrder(2, true)).toEqual([0, 1]);
    const gif = decodeGif(renderGif(threeFrames(), { pingpong: true, scale: 3 }).bytes);
    expect(gif.width).toBe(6);
    expect(gif.frames.map((f) => f.delay)).toEqual([10, 20, 30, 20]);
  });
});

describe('sprite sheet import', () => {
  it('cuts a sheet into frames and drops empty cells at the end', () => {
    // A 3 × 2 grid of 2 × 1 cells; only the first four hold pixels.
    const pixels = new Uint32Array(6 * 2);
    for (const i of [0, 3, 4, 7]) pixels[i] = RED;
    const cells = sliceSheet(pixels, 6, 2, 2, 1);
    expect(cells.map((c) => [...c])).toEqual([
      [RED, 0],
      [0, RED],
      [RED, 0],
      [0, RED],
    ]);
    const doc = docFromFrames(cells, 2, 1, 80);
    expect(doc.frames.map((f) => f.duration)).toEqual([80, 80, 80, 80]);
    expect([...doc.layers[0].cels.get(doc.frames[1].id)!]).toEqual([0, RED]);
    expect([...doc.layers[0].pixels]).toEqual([RED, 0]);
  });

  it('guesses square frames along a strip', () => {
    expect(guessFrameSize(128, 32)).toEqual({ w: 32, h: 32 });
    expect(guessFrameSize(16, 64)).toEqual({ w: 16, h: 16 });
    expect(guessFrameSize(30, 20)).toEqual({ w: 30, h: 20 });
  });
});
