import { hsvToRgb, pack, parseHex, rgbToHsv, unpack } from './color';
import { type Doc, celOf } from './doc';

/** Starter palette: one neutral ramp plus hue-shifted ramps (shadows lean cool, lights lean warm). */
const HEX = [
  // neutrals
  '#16141c', '#2e2a38', '#4d4759', '#77708a', '#a9a2b8', '#d8d3e0', '#f7f4fa',
  // reds
  '#4a1730', '#8a2340', '#c93c4a', '#f0715e', '#ffb08f',
  // oranges and yellows
  '#5a2a1e', '#9c4a22', '#db7b2a', '#f6b847', '#ffe6a0',
  // greens
  '#12332f', '#1f5e45', '#3a9150', '#7dc25b', '#c6e77a',
  // blues
  '#14204a', '#1f3e8c', '#2f6fd0', '#4fb0f0', '#a4e4ff',
  // purples
  '#2c1a4a', '#57307f', '#8c4fb8', '#c98be0', '#f2c6f5',
];

export const DEFAULT_PALETTE: number[] = HEX.map((h) => parseHex(h)!);

/** Known palettes by name, for `palette.preset` and for forcing art into one with `effect.posterize`. */
export const PRESETS: Record<string, { label: string; colors: number[] }> = Object.fromEntries(
  Object.entries({
    pontilha: { label: 'Pontilha (default)', hex: HEX },
    // Bubie master palette (art-src/palette/bubie-paleta-mestre.hex in the Bubie repo): every badge colour comes from here.
    bubie: {
      label: 'Bubie (master palette)',
      hex: [
        '#16141c', '#262838', '#3a3d50', '#565b72', '#8187a0', '#c8ccd8',
        '#2b1b12', '#49372e', '#74502d', '#9c7a58', '#bfa586', '#ddcbb2',
        '#f3e7d5', '#fffdf8', '#5c2a0c', '#8d4814', '#c98f3a', '#f4bf69',
        '#ffd95a', '#3d0d24', '#7a1a33', '#c4363c', '#ec6a3a', '#ffa860',
        '#451640', '#852d6a', '#cc5c9a', '#f598bf', '#ffd6e2', '#1a1236',
        '#3a2068', '#6a43a3', '#a07ad6', '#e8d0f5', '#171538', '#263a7c',
        '#3d66bd', '#5ea3e0', '#b6e4f7', '#0e2a30', '#1b5a5a', '#2a9480',
        '#66d1a8', '#cdf5d8', '#16332a', '#2f6430', '#6a9e34', '#c2d95c',
      ],
    },
    // SLSO8 by Luis Miguel Maldonado: warm lights over deep blue nights.
    slso8: { label: 'SLSO8', hex: ['#0d2b45', '#203c56', '#544e68', '#8d697a', '#d08159', '#ffaa5e', '#ffd4a3', '#ffecd6'] },
    // SLSO8 with the extra night blue the Boo showcase adds for its darkest background.
    boo: { label: 'Boo (SLSO8 + night)', hex: ['#061a2c', '#0d2b45', '#203c56', '#544e68', '#8d697a', '#d08159', '#ffaa5e', '#ffd4a3', '#ffecd6'] },
    pico8: {
      label: 'PICO-8',
      hex: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
    },
    sweetie16: {
      label: 'Sweetie 16',
      hex: ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'],
    },
  }).map(([id, { label, hex }]) => [id, { label, colors: hex.map((h) => parseHex(h)!) }]),
);

/** Where shadows and lights lean: blue and yellow. */
const COOL = 240;
const WARM = 60;

/** Turns `h` towards `target` by at most `amount` degrees, the short way round. */
function towards(h: number, target: number, amount: number): number {
  const diff = ((target - h + 540) % 360) - 180;
  return (h + Math.sign(diff) * Math.min(Math.abs(diff), amount) + 360) % 360;
}

/**
 * A ramp around `base`, darkest first: shadows get darker, more saturated and
 * turn towards blue; lights get brighter, less saturated and turn towards yellow,
 * `shift` degrees per step. `base` sits in the middle (one step lower when even),
 * or at the end when it is already about as light or as dark as it can get.
 */
export function hueShiftRamp(base: number, steps = 5, shift = 12): number[] {
  const { r, g, b, a } = unpack(base);
  const hsv = rgbToHsv(r, g, b);
  const { s, v } = hsv;
  // A grey has no hue of its own (it reads as 0°, red); give its shadows the cool one.
  const h = s < 0.05 ? COOL : hsv.h;
  const roomAbove = 1 - v + s * 0.6;
  let darks = Math.floor((steps - 1) / 2);
  if (roomAbove < 0.08) darks = steps - 1;
  else if (v < 0.08) darks = 0;
  const lights = steps - 1 - darks;
  const shadowFloor = Math.min(0.1, v * 0.4);
  const at = (t: number) => {
    const k = Math.abs(t);
    const color =
      t < 0
        ? hsvToRgb(towards(h, COOL, shift * darks * k), s + (1 - s) * 0.3 * k, v - (v - shadowFloor) * 0.85 * k)
        : hsvToRgb(towards(h, WARM, shift * lights * k), s * (1 - 0.6 * k), v + (1 - v) * 0.85 * k);
    return pack(color.r, color.g, color.b, a);
  };
  const out: number[] = [];
  for (let i = darks; i >= 1; i--) out.push(at(-i / darks));
  out.push(base);
  for (let i = 1; i <= lights; i++) out.push(at(i / lights));
  return out.filter((c, i) => out.indexOf(c) === i);
}

/** Where a colour change applies: everything, one layer in every frame, or every layer in one frame. */
export type ColorScope = 'all' | 'layer' | 'frame';

/** The cels a scope covers, as [layer, frame id] pairs. */
export function scopeCels(doc: Doc, scope: ColorScope, layerId: string, frameId: string) {
  const layers = scope === 'layer' ? doc.layers.filter((l) => l.id === layerId) : doc.layers;
  const frames = scope === 'frame' ? doc.frames.filter((f) => f.id === frameId) : doc.frames;
  return layers.flatMap((layer) => frames.map((f) => ({ layer, frame: f.id, cel: celOf(doc, layer, f.id) })));
}

/** Painted colours in a scope with how many pixels use each, most used first. */
export function usedColors(doc: Doc, scope: ColorScope, layerId: string, frameId: string): Array<{ color: number; pixels: number }> {
  const counts = new Map<number, number>();
  for (const { cel } of scopeCels(doc, scope, layerId, frameId)) {
    for (const p of cel) if (p >>> 24) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts].map(([color, pixels]) => ({ color, pixels })).sort((x, y) => y.pixels - x.pixels);
}

