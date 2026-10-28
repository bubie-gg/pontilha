/**
 * Animated GIF writer. GIF keeps 256 colours and all-or-nothing transparency, so
 * pixels below half alpha become transparent and the rest keep their colour. Pixel
 * art rarely needs more than 255 colours; when it does, colours lose low bits until
 * they fit, which is cruder than dithering but never invents new hues.
 */

export interface GifFrame {
  /** Straight RGBA pixels, one Uint32 each (R in the low byte). */
  pixels: Uint32Array;
  /** Milliseconds on screen. */
  duration: number;
}

export interface GifResult {
  bytes: Uint8Array;
  /** Colours in the palette, not counting transparency. */
  colors: number;
  /** True when colours had to be merged to fit in 256. */
  reduced: boolean;
}

/** Browsers stretch delays under 20 ms to 100 ms, so GIF frames last at least 2 hundredths. */
const MIN_DELAY_CS = 2;

const opaque = (p: number) => p >>> 24 >= 128;

/** Drops `bits` low bits from each channel of a 24-bit colour. */
const coarse = (rgb: number, bits: number) => {
  const m = (0xff << bits) & 0xff;
  return ((rgb & m) | (rgb & (m << 8)) | (rgb & (m << 16))) >>> 0;
};

function buildPalette(frames: GifFrame[]) {
  let transparent = false;
  for (const f of frames) for (const p of f.pixels) if (!opaque(p)) transparent = true;
  const room = transparent ? 255 : 256;
  for (let bits = 0; bits <= 7; bits++) {
    const colors = new Map<number, number>();
    let fits = true;
    outer: for (const f of frames) {
      for (const p of f.pixels) {
        if (!opaque(p)) continue;
        const key = coarse(p & 0xffffff, bits);
        if (colors.has(key)) continue;
        if (colors.size === room) {
          fits = false;
          break outer;
        }
        colors.set(key, colors.size + (transparent ? 1 : 0));
      }
    }
    if (fits) return { colors, transparent, bits };
  }
  throw new Error('unreachable: 1-bit channels always fit');
}

/** Variable-width LZW as GIF wants it, with a clear code whenever the 4096-entry table fills. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const dict = new Map<number, number>();
  const out: number[] = [];
  let buffer = 0;
  let count = 0;
  const emit = (code: number) => {
    buffer |= code << count;
    count += codeSize;
    while (count >= 8) {
      out.push(buffer & 0xff);
      buffer >>>= 8;
      count -= 8;
    }
  };

  emit(clear);
  if (indices.length === 0) {
    emit(eoi);
    if (count > 0) out.push(buffer & 0xff);
    return Uint8Array.from(out);
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const known = dict.get(key);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      // The decoder adds this entry one code later, so widen once it would need the extra bit.
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict.clear();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (count > 0) out.push(buffer & 0xff);
  return Uint8Array.from(out);
}

class Writer {
  private chunks: number[] = [];
  byte(...values: number[]) {
    for (const v of values) this.chunks.push(v & 0xff);
  }
  u16(v: number) {
    this.byte(v, v >> 8);
  }
  text(s: string) {
    for (const c of s) this.byte(c.charCodeAt(0));
  }
  /** Data split into sub-blocks of at most 255 bytes, ended by an empty one. */
  blocks(data: Uint8Array) {
    for (let i = 0; i < data.length; i += 255) {
      const part = data.subarray(i, i + 255);
      this.byte(part.length, ...part);
    }
    this.byte(0);
  }
  done() {
    return Uint8Array.from(this.chunks);
  }
}

/** Encodes frames of the same size as a looping GIF. */
export function encodeGif(frames: GifFrame[], width: number, height: number): GifResult {
  if (frames.length === 0) throw new Error('o GIF precisa de pelo menos um quadro');
  const { colors, transparent, bits } = buildPalette(frames);
  const used = colors.size + (transparent ? 1 : 0);
  let depth = 1;
  while (1 << depth < used) depth++;

  const w = new Writer();
  w.text('GIF89a');
  w.u16(width);
  w.u16(height);
  // Global colour table present, 8-bit colour resolution, table of 2^depth entries.
  w.byte(0x80 | (7 << 4) | (depth - 1), 0, 0);
  const table = new Uint8Array(3 << depth);
  for (const [rgb, index] of colors) {
    table[index * 3] = rgb & 0xff;
    table[index * 3 + 1] = (rgb >>> 8) & 0xff;
    table[index * 3 + 2] = (rgb >>> 16) & 0xff;
  }
  w.byte(...table);

  // Loop forever.
  w.byte(0x21, 0xff, 11);
  w.text('NETSCAPE2.0');
  w.byte(3, 1);
  w.u16(0);
  w.byte(0);

  const minCodeSize = Math.max(2, depth);
  const indices = new Uint8Array(width * height);
  for (const frame of frames) {
    for (let i = 0; i < indices.length; i++) {
      const p = frame.pixels[i];
      indices[i] = opaque(p) ? colors.get(coarse(p & 0xffffff, bits))! : 0;
    }
    // Graphic control: clear to transparent before the next frame, so frames never pile up.
    w.byte(0x21, 0xf9, 4, (2 << 2) | (transparent ? 1 : 0));
    w.u16(Math.max(MIN_DELAY_CS, Math.round(frame.duration / 10)));
    w.byte(0, 0);
    w.byte(0x2c);
    w.u16(0);
    w.u16(0);
    w.u16(width);
    w.u16(height);
    w.byte(0);
    w.byte(minCodeSize);
    w.blocks(lzwEncode(indices, minCodeSize));
  }
  w.byte(0x3b);
  return { bytes: w.done(), colors: colors.size, reduced: bits > 0 };
}
