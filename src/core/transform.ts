import { type Doc, type Layer, celOf } from './doc';
import { PixelEditor } from './editor';
import type { Entry } from './history';

/** A rectangle of image pixels: top-left corner, width and height. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Flip = 'horizontal' | 'vertical';
export type Turn = 'cw' | 'ccw';

/** The rectangle spanning two corner pixels, both included. */
export function rectBetween(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

/** The part of `r` inside a width × height image, or null when nothing is left. */
export function clipRect(r: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export const contains = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

export const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/**
 * A copy of a w × h cel on a new nw × nh canvas, with old pixel (x, y) at (x + dx, y + dy).
 * What falls outside is dropped; new space is transparent.
 */
export function shiftCel(cel: Uint32Array, w: number, h: number, nw: number, nh: number, dx: number, dy: number): Uint32Array {
  const out = new Uint32Array(nw * nh);
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(w, nw - dx);
  if (x1 <= x0) return out;
  for (let y = 0; y < h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= nh) continue;
    out.set(cel.subarray(y * w + x0, y * w + x1), ty * nw + x0 + dx);
  }
  return out;
}

/** Smallest rectangle holding every painted pixel, in any layer and frame; null when the image is empty. */
export function contentBounds(doc: Doc): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const layer of doc.layers) {
    for (const frame of doc.frames) {
      const cel = celOf(doc, layer, frame.id);
      for (let i = 0; i < cel.length; i++) {
        if (!(cel[i] >>> 24)) continue;
        const x = i % doc.width;
        const y = (i - x) / doc.width;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export type Anchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

export const ANCHORS: Anchor[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

/** Where the old image sits on a new canvas: pinned to a side or corner, or centred (rounding up-left). */
export function anchorOffset(anchor: Anchor, w: number, h: number, nw: number, nh: number): { dx: number; dy: number } {
  const i = ANCHORS.indexOf(anchor);
  const place = (col: number, old: number, next: number) => (col === 0 ? 0 : col === 1 ? Math.floor((next - old) / 2) : next - old);
  return { dx: place(i % 3, w, nw), dy: place(Math.floor(i / 3), h, nh) };
}

/** Pixels of `cel` inside `r` (which must lie inside the image), row by row. */
export function copyRegion(cel: Uint32Array, width: number, r: Rect): Uint32Array {
  const out = new Uint32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) out.set(cel.subarray((r.y + y) * width + r.x, (r.y + y) * width + r.x + r.w), y * r.w);
  return out;
}

export function flipRegion(px: Uint32Array, w: number, h: number, flip: Flip): Uint32Array {
  const out = new Uint32Array(px.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = flip === 'horizontal' ? w - 1 - x : x;
      const sy = flip === 'vertical' ? h - 1 - y : y;
      out[y * w + x] = px[sy * w + sx];
    }
  }
  return out;
}

/** A quarter turn. The result is h wide and w tall. */
export function rotateRegion(px: Uint32Array, w: number, h: number, turn: Turn): Uint32Array {
  const out = new Uint32Array(px.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Clockwise, source (x, y) lands at (h - 1 - y, x); counter-clockwise at (y, w - 1 - x).
      const [tx, ty] = turn === 'cw' ? [h - 1 - y, x] : [y, w - 1 - x];
      out[ty * h + tx] = px[y * w + x];
    }
  }
  return out;
}

/** Where `r` ends up after a quarter turn about its centre. Odd differences round towards the top-left. */
export function turnedRect(r: Rect): Rect {
  return { x: r.x + Math.floor((r.w - r.h) / 2), y: r.y + Math.floor((r.h - r.w) / 2), w: r.h, h: r.w };
}

export function clearRegion(editor: PixelEditor, r: Rect) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) editor.set(x, y, 0);
}

/**
 * Empties `from`, then paints `pixels` (to.w × to.h) at `to`. Transparent pixels
 * don't paint, so what was under the destination shows through them. Anything
 * outside the image is dropped.
 */
export function relocate(editor: PixelEditor, from: Rect | null, pixels: Uint32Array, to: Rect) {
  if (from) clearRegion(editor, from);
  for (let y = 0; y < to.h; y++) {
    for (let x = 0; x < to.w; x++) {
      const c = pixels[y * to.w + x];
      if (c >>> 24) editor.set(to.x + x, to.y + y, c);
    }
  }
}

/**
 * Dragging the selection: lifts its pixels and shows them at the pointer's offset
 * until release. Nothing under the path is harmed: every move starts from the
 * pixels as they were before the drag.
 */
export function startMove(doc: Doc, layer: Layer, region: Rect, x: number, y: number) {
  const editor = new PixelEditor(layer, doc.width, doc.height);
  const pixels = copyRegion(layer.pixels, doc.width, region);
  let to = region;
  return {
    /** Moves the lifted pixels so they follow the pointer; returns where they are now. */
    move(px: number, py: number): Rect {
      to = { ...region, x: region.x + px - x, y: region.y + py - y };
      editor.revertAll();
      relocate(editor, region, pixels, to);
      return to;
    },
    end(): { entry: Entry | null; to: Rect } {
      return { entry: editor.toEntry(), to };
    },
  };
}
