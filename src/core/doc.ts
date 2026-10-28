import { blendOver } from './color';

/** Region of a layer changed since the last upload to its canvas. `x1`/`y1` are exclusive. */
export type Dirty = { x0: number; y0: number; x1: number; y1: number } | 'all' | null;

/** One step of an animation. Every layer has an image (a cel) for every frame. */
export interface Frame {
  id: string;
  /** How long the frame stays on screen during playback, in milliseconds. */
  duration: number;
}

/** A named stretch of the animation, like "andar" or "pular", from one frame to another (both included). */
export interface Tag {
  id: string;
  name: string;
  /** Frame ids of the ends. Frames added between them belong to the tag too. */
  from: string;
  to: string;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  /** The layer's image in each frame, by frame id. */
  cels: Map<string, Uint32Array>;
  /** The cel of the frame being shown: what tools and commands paint on. Kept in step by `showFrame`. */
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
  /** Playback order. Replace the array (don't mutate it) so subscribers notice. */
  frames: Frame[];
  /** Id of the frame being shown and edited. Change it with `showFrame`. */
  frame: string;
  /** Named stretches of frames. Replace the array (don't mutate it) so subscribers notice. */
  tags: Tag[];
}

export const MAX_SIZE = 2048;
export const MAX_FRAMES = 512;
export const DEFAULT_DURATION = 100;
/** Shortest and longest frame durations, in ms. GIF counts in hundredths of a second. */
export const MIN_DURATION = 10;
export const MAX_DURATION = 60000;

export const clampDuration = (ms: number) => Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(ms)));

let seq = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
export const newLayerId = () => newId('l');
export const newTagId = () => newId('t');

export function createFrame(duration = DEFAULT_DURATION): Frame {
  return { id: newId('f'), duration };
}

/** What creating a layer needs to know about its document. */
type Shape = Pick<Doc, 'width' | 'height' | 'frames' | 'frame'>;

/** A layer with an empty cel in every frame, or `pixels` in the frame being shown. */
export function createLayer(doc: Shape, name: string, pixels?: Uint32Array): Layer {
  const cels = new Map<string, Uint32Array>(doc.frames.map((f) => [f.id, new Uint32Array(doc.width * doc.height)]));
  if (pixels) cels.set(doc.frame, pixels);
  return {
    id: newLayerId(),
    name,
    visible: true,
    opacity: 1,
    cels,
    pixels: cels.get(doc.frame)!,
    rev: 0,
    dirty: 'all',
  };
}

/** A one-frame document with a single layer, empty or holding `pixels`. */
export function createDoc(width: number, height: number, pixels?: Uint32Array): Doc {
  const frame = createFrame();
  const doc: Doc = { width, height, layers: [], frames: [frame], frame: frame.id, tags: [] };
  doc.layers = [createLayer(doc, 'Camada 1', pixels)];
  return doc;
}

/** The layer's cel in a frame, created empty if it is missing. */
export function celOf(doc: Doc, layer: Layer, frameId: string): Uint32Array {
  let cel = layer.cels.get(frameId);
  if (!cel) {
    cel = new Uint32Array(doc.width * doc.height);
    layer.cels.set(frameId, cel);
  }
  return cel;
}

/** Shows and edits `frameId` from now on: every layer's `pixels` becomes that frame's cel. */
export function showFrame(doc: Doc, frameId: string) {
  doc.frame = frameId;
  for (const layer of doc.layers) {
    layer.pixels = celOf(doc, layer, frameId);
    markAllDirty(layer);
  }
}

export function frameIndex(doc: Doc, frameId = doc.frame): number {
  return doc.frames.findIndex((f) => f.id === frameId);
}

/** First and last frame index a tag covers, in playback order; null if an end is gone. */
export function tagRange(doc: Doc, tag: Tag): [number, number] | null {
  const a = frameIndex(doc, tag.from);
  const b = frameIndex(doc, tag.to);
  return a < 0 || b < 0 ? null : [Math.min(a, b), Math.max(a, b)];
}

/**
 * Tags as they should be once `frameId` is deleted: an end on that frame moves one
 * frame inwards, and a tag covering only that frame goes away.
 */
export function tagsWithoutFrame(doc: Doc, frameId: string): Tag[] {
  const out: Tag[] = [];
  for (const tag of doc.tags) {
    const range = tagRange(doc, tag);
    if (!range) continue;
    const [start, end] = range;
    if (start === end && doc.frames[start].id === frameId) continue;
    let first = doc.frames[start].id;
    let last = doc.frames[end].id;
    if (first === frameId) first = doc.frames[start + 1].id;
    if (last === frameId) last = doc.frames[end - 1].id;
    out.push({ ...tag, from: first, to: last });
  }
  return out;
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

/** Visible layers flattened, for the frame being shown or another one. */
export function composite(doc: Doc, frameId = doc.frame): Uint32Array {
  const out = new Uint32Array(doc.width * doc.height);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const px = celOf(doc, layer, frameId);
    for (let i = 0; i < out.length; i++) if (px[i] >>> 24) out[i] = blendOver(out[i], px[i], layer.opacity);
  }
  return out;
}

export function nextLayerName(doc: Doc): string {
  const used = new Set(doc.layers.map((l) => l.name));
  for (let n = doc.layers.length + 1; ; n++) if (!used.has(`Camada ${n}`)) return `Camada ${n}`;
}
