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

