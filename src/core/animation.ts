import { type Doc, composite } from './doc';
import { type GifResult, encodeGif } from './gif';
import { scaleNearest } from './png';

export type SheetLayout = 'row' | 'grid';

/** Columns and rows for `count` frames: one row, or the squarest grid that holds them. */
export function sheetGrid(count: number, layout: SheetLayout) {
  const cols = layout === 'row' ? count : Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

/** Every frame flattened side by side, left to right then top to bottom, enlarged by `scale`. */
export function renderSheet(doc: Doc, layout: SheetLayout, scale = 1) {
  const { cols, rows } = sheetGrid(doc.frames.length, layout);
  const fw = doc.width * scale;
  const fh = doc.height * scale;
  const width = cols * fw;
  const height = rows * fh;
  const pixels = new Uint32Array(width * height);
  doc.frames.forEach((frame, i) => {
    const cell = scaleNearest(composite(doc, frame.id), doc.width, doc.height, scale);
    const ox = (i % cols) * fw;
    const oy = Math.floor(i / cols) * fh;
    for (let y = 0; y < fh; y++) pixels.set(cell.subarray(y * fw, (y + 1) * fw), (oy + y) * width + ox);
  });
  return { pixels, width, height, cols, rows, frameWidth: fw, frameHeight: fh };
}

/** Frame order for playback: straight through, or there and back without repeating the ends. */
export function playbackOrder(count: number, pingpong: boolean): number[] {
  const forward = Array.from({ length: count }, (_, i) => i);
  if (!pingpong || count < 3) return forward;
  return [...forward, ...forward.slice(1, -1).reverse()];
}

export function renderGif(doc: Doc, opts: { scale?: number; pingpong?: boolean } = {}): GifResult {
  const scale = opts.scale ?? 1;
  const flat = doc.frames.map((f) => scaleNearest(composite(doc, f.id), doc.width, doc.height, scale));
  const frames = playbackOrder(doc.frames.length, opts.pingpong ?? false).map((i) => ({
    pixels: flat[i],
    duration: doc.frames[i].duration,
  }));
  return encodeGif(frames, doc.width * scale, doc.height * scale);
}
