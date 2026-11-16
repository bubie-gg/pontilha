import { type Layer, markDirty } from './doc';
import type { Entry } from './history';

/**
 * Writes pixels into one layer during a gesture while remembering each pixel's
 * original value, so the gesture can be previewed, reverted or turned into an
 * undo entry when it ends.
 */
export class PixelEditor {
  private readonly original = new Map<number, number>();
  /** When set, only pixels for which this returns true can be painted. */
  allow: ((index: number) => boolean) | null = null;

  /** The cel being painted: the layer's current frame unless another one is given. */
  readonly cel: Uint32Array;

  constructor(
    readonly layer: Layer,
    readonly width: number,
    readonly height: number,
    cel?: Uint32Array,
  ) {
    this.cel = cel ?? layer.pixels;
  }

  set(x: number, y: number, color: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.setIndex(y * this.width + x, color);
  }

  setIndex(i: number, color: number) {
    if (this.allow && !this.allow(i)) return;
    const px = this.cel;
    const current = px[i];
    if (!this.original.has(i)) this.original.set(i, current);
    if (current !== color) {
      px[i] = color;
      markDirty(this.layer, i % this.width, Math.floor(i / this.width));
    }
  }

  /** Puts one pixel back to its value from before the gesture. */
  restore(x: number, y: number) {
    const i = y * this.width + x;
    const before = this.original.get(i);
    if (before === undefined) return;
    this.cel[i] = before;
    this.original.delete(i);
    markDirty(this.layer, x, y);
  }

  revertAll() {
    for (const [i, before] of this.original) {
      this.cel[i] = before;
      markDirty(this.layer, i % this.width, Math.floor(i / this.width));
    }
    this.original.clear();
  }

  /** Undo entry for every pixel that ended the gesture with a different value, or null. */
  toEntry(): Entry | null {
    const indices: number[] = [];
    const before: number[] = [];
    const after: number[] = [];
    const px = this.cel;
    for (const [i, b] of this.original) {
      if (px[i] === b) continue;
      indices.push(i);
      before.push(b);
      after.push(px[i]);
    }
    if (indices.length === 0) return null;
    const frame = [...this.layer.cels].find(([, cel]) => cel === this.cel)?.[0];
    if (frame === undefined) throw new Error('the edited cel does not belong to the layer');
    return {
      kind: 'pixels',
      layer: this.layer,
      frame,
      indices: Uint32Array.from(indices),
      before: Uint32Array.from(before),
      after: Uint32Array.from(after),
    };
  }
}
