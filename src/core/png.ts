/**
 * Minimal PNG encoder. Going through a canvas would premultiply alpha and shift
 * the colour of semi-transparent pixels; writing the file ourselves keeps every
 * pixel exactly as drawn.
 */

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data as Uint8Array<ArrayBuffer>);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** zlib-wrapped deflate, as PNG's IDAT expects. */
export const zlibDeflate = (data: Uint8Array) => pipe(data, new CompressionStream('deflate'));
export const zlibInflate = (data: Uint8Array) => pipe(data, new DecompressionStream('deflate'));

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Encodes straight-alpha RGBA bytes as an 8-bit RGBA PNG. */
export async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Each scanline starts with filter type 0 (none), already zeroed.
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type RGBA

  const parts = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', await zlibDeflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Nearest-neighbour upscale by an integer factor. */
export function scaleNearest(pixels: Uint32Array, width: number, height: number, factor: number): Uint32Array {
  if (factor === 1) return pixels;
  const w = width * factor;
  const out = new Uint32Array(w * height * factor);
  for (let y = 0; y < height * factor; y++) {
    const src = Math.floor(y / factor) * width;
    for (let x = 0; x < w; x++) out[y * w + x] = pixels[src + Math.floor(x / factor)];
  }
  return out;
}
