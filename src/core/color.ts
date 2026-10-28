/**
 * Pixels are packed RGBA in a Uint32 read as little-endian, so memory order is
 * R, G, B, A and a layer buffer can be handed to ImageData without conversion.
 */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HSV {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  v: number;
}

export const TRANSPARENT = 0;

export function pack(r: number, g: number, b: number, a = 255): number {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export function unpack(c: number): RGBA {
  return { r: c & 255, g: (c >>> 8) & 255, b: (c >>> 16) & 255, a: c >>> 24 };
}

export const alphaOf = (c: number) => c >>> 24;

/** Any fully transparent pixel counts as the same colour, whatever RGB it carries. */
export const sameColor = (a: number, b: number) => a === b || (a >>> 24 === 0 && b >>> 24 === 0);

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** `#rrggbb` for opaque colours, `#rrggbbaa` otherwise. */
export function toHex(c: number): string {
  const { r, g, b, a } = unpack(c);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a === 255 ? '' : hex2(a)}`;
}

export function toCss(c: number): string {
  const { r, g, b, a } = unpack(c);
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export function parseHex(input: string): number | null {
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(s)) s = [...s].map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return null;
  const byte = (i: number) => parseInt(s.slice(i, i + 2), 16);
  return pack(byte(0), byte(2), byte(4), s.length === 8 ? byte(6) : 255);
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

/** Source-over compositing of straight (non-premultiplied) colours. */
export function blendOver(dst: number, src: number, opacity = 1): number {
  const sa = ((src >>> 24) / 255) * opacity;
  if (sa <= 0) return dst;
  const da = (dst >>> 24) / 255;
  if (sa >= 1 || da === 0) {
    if (sa >= 1) return src;
    return ((src & 0x00ffffff) | (Math.round(sa * 255) << 24)) >>> 0;
  }
  const oa = sa + da * (1 - sa);
  const mix = (shift: number) => {
    const s = (src >>> shift) & 255;
    const d = (dst >>> shift) & 255;
    return Math.round((s * sa + d * da * (1 - sa)) / oa);
  };
  return pack(mix(0), mix(8), mix(16), Math.round(oa * 255));
}
