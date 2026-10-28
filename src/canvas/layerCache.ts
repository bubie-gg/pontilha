import type { Layer } from '../core/doc';

interface Cached {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  buffer: ArrayBufferLike;
  rev: number;
}

const cache = new WeakMap<Layer, Cached>();

/**
 * An image-sized canvas mirroring the layer's pixels. The ImageData shares the
 * layer's buffer, so syncing is a single putImageData of the dirty region.
 */
export function layerCanvas(layer: Layer, width: number, height: number): HTMLCanvasElement {
  let entry = cache.get(layer);
  if (!entry || entry.buffer !== layer.pixels.buffer || entry.canvas.width !== width || entry.canvas.height !== height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const bytes = new Uint8ClampedArray(layer.pixels.buffer as ArrayBuffer, layer.pixels.byteOffset, layer.pixels.byteLength);
    entry = { canvas, ctx, image: new ImageData(bytes, width, height), buffer: layer.pixels.buffer, rev: -1 };
    cache.set(layer, entry);
  }

  if (entry.rev !== layer.rev) {
    const d = layer.dirty;
    if (entry.rev === -1 || d === 'all' || d === null) entry.ctx.putImageData(entry.image, 0, 0);
    else entry.ctx.putImageData(entry.image, 0, 0, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    layer.dirty = null;
    entry.rev = layer.rev;
  }
  return entry.canvas;
}

let checker: { size: number; canvas: HTMLCanvasElement } | null = null;

/** Two-tone transparency checkerboard tile, `size` device pixels per square. */
export function checkerTile(size: number): HTMLCanvasElement {
  if (checker?.size === size) return checker.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#cfcdd4';
  ctx.fillRect(0, 0, size * 2, size * 2);
  ctx.fillStyle = '#bdbbc4';
  ctx.fillRect(size, 0, size, size);
  ctx.fillRect(0, size, size, size);
  checker = { size, canvas };
  return canvas;
}
