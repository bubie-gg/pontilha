import { blendOver } from './color';

/** Region of a layer changed since the last upload to its canvas. `x1`/`y1` are exclusive. */
export type Dirty = { x0: number; y0: number; x1: number; y1: number } | 'all' | null;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  pixels: Uint32Array;
  /** Bumped on every pixel change so render caches know to re-upload. */
  rev: number;
  dirty: Dirty;
}

export interface Doc {
  width: number;
  height: number;
  /** Bottom layer first. Replace the array (don't mutate it) so subscribers notice. */
  layers: Layer[];
}

export const MAX_SIZE = 2048;

let seq = 0;
export const newLayerId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function createLayer(width: number, height: number, name: string, pixels?: Uint32Array): Layer {
  return {
    id: newLayerId(),
    name,
    visible: true,
    opacity: 1,
    pixels: pixels ?? new Uint32Array(width * height),
    rev: 0,
    dirty: 'all',
  };
}

export function createDoc(width: number, height: number): Doc {
  return { width, height, layers: [createLayer(width, height, 'Camada 1')] };
}

export function markDirty(layer: Layer, x: number, y: number) {
  layer.rev++;
  const d = layer.dirty;
  if (d === 'all') return;
  if (d === null) {
    layer.dirty = { x0: x, y0: y, x1: x + 1, y1: y + 1 };
    return;
  }
  if (x < d.x0) d.x0 = x;
  if (y < d.y0) d.y0 = y;
  if (x + 1 > d.x1) d.x1 = x + 1;
  if (y + 1 > d.y1) d.y1 = y + 1;
}

export function markAllDirty(layer: Layer) {
  layer.rev++;
  layer.dirty = 'all';
}

export function pixelAt(doc: Doc, layer: Layer, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return 0;
  return layer.pixels[y * doc.width + x];
}

export function sampleComposite(doc: Doc, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return 0;
  const i = y * doc.width + x;
  let out = 0;
  for (const layer of doc.layers) if (layer.visible) out = blendOver(out, layer.pixels[i], layer.opacity);
  return out;
}

export function composite(doc: Doc): Uint32Array {
  const out = new Uint32Array(doc.width * doc.height);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const px = layer.pixels;
    for (let i = 0; i < out.length; i++) if (px[i] >>> 24) out[i] = blendOver(out[i], px[i], layer.opacity);
  }
  return out;
}

export function nextLayerName(doc: Doc): string {
  const used = new Set(doc.layers.map((l) => l.name));
  for (let n = doc.layers.length + 1; ; n++) if (!used.has(`Camada ${n}`)) return `Camada ${n}`;
}
