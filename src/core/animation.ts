import { DEFAULT_DURATION, type Doc, composite, createFrame, createLayer } from './doc';
import { type GifResult, encodeGif } from './gif';
import { scaleNearest } from './png';

export type SheetLayout = 'row' | 'grid';

/** Columns and rows for `count` frames: one row, or the squarest grid that holds them. */
export function sheetGrid(count: number, layout: SheetLayout) {
  const cols = layout === 'row' ? count : Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

/** First and last frame index to export, both included. */
export type FrameRange = [number, number];

const framesIn = (doc: Doc, range?: FrameRange) => (range ? doc.frames.slice(range[0], range[1] + 1) : doc.frames);

/** Frames (all, or `range`) flattened side by side, left to right then top to bottom, enlarged by `scale`. */
export function renderSheet(doc: Doc, layout: SheetLayout, scale = 1, range?: FrameRange) {
  const frames = framesIn(doc, range);
  const { cols, rows } = sheetGrid(frames.length, layout);
  const fw = doc.width * scale;
  const fh = doc.height * scale;
  const width = cols * fw;
  const height = rows * fh;
  const pixels = new Uint32Array(width * height);
  frames.forEach((frame, i) => {
    const cell = scaleNearest(composite(doc, frame.id), doc.width, doc.height, scale);
    const ox = (i % cols) * fw;
    const oy = Math.floor(i / cols) * fh;
    for (let y = 0; y < fh; y++) pixels.set(cell.subarray(y * fw, (y + 1) * fw), (oy + y) * width + ox);
  });
  return { pixels, width, height, cols, rows, frameWidth: fw, frameHeight: fh, durations: frames.map((f) => f.duration) };
}

/** Frame order for playback: straight through, or there and back without repeating the ends. */
export function playbackOrder(count: number, pingpong: boolean): number[] {
  const forward = Array.from({ length: count }, (_, i) => i);
  if (!pingpong || count < 3) return forward;
  return [...forward, ...forward.slice(1, -1).reverse()];
}

export function renderGif(doc: Doc, opts: { scale?: number; pingpong?: boolean; range?: FrameRange } = {}): GifResult {
  const scale = opts.scale ?? 1;
  const source = framesIn(doc, opts.range);
  const flat = source.map((f) => scaleNearest(composite(doc, f.id), doc.width, doc.height, scale));
  const frames = playbackOrder(source.length, opts.pingpong ?? false).map((i) => ({
    pixels: flat[i],
    duration: source[i].duration,
  }));
  return encodeGif(frames, doc.width * scale, doc.height * scale);
}

/**
 * Cuts a sprite sheet into fw × fh cells, left to right then top to bottom. Empty
 * cells at the end (a half-filled last row) are dropped; at least one is kept.
 */
export function sliceSheet(pixels: Uint32Array, width: number, height: number, fw: number, fh: number): Uint32Array[] {
  const cols = Math.floor(width / fw);
  const rows = Math.floor(height / fh);
  const cells: Uint32Array[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = new Uint32Array(fw * fh);
      for (let y = 0; y < fh; y++) {
        const from = (r * fh + y) * width + c * fw;
        cell.set(pixels.subarray(from, from + fw), y * fw);
      }
      cells.push(cell);
    }
  }
  while (cells.length > 1 && cells[cells.length - 1].every((p) => p >>> 24 === 0)) cells.pop();
  return cells;
}

/** A one-layer animation with one frame per image. */
export function docFromFrames(images: Uint32Array[], width: number, height: number, duration = DEFAULT_DURATION): Doc {
  const frames = images.map(() => createFrame(duration));
  const doc: Doc = { width, height, layers: [], frames, frame: frames[0].id, tags: [] };
  const layer = createLayer(doc, 'Layer 1');
  images.forEach((cell, i) => layer.cels.set(frames[i].id, cell));
  layer.pixels = layer.cels.get(frames[0].id)!;
  doc.layers = [layer];
  return doc;
}

/** Likely frame size for a sheet: square cells along a strip, or the whole image. */
export function guessFrameSize(width: number, height: number): { w: number; h: number } {
  if (width > height && width % height === 0) return { w: height, h: height };
  if (height > width && height % width === 0) return { w: width, h: width };
  return { w: width, h: height };
}
