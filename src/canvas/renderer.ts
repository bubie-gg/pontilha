import { toCss } from '../core/color';
import { type Doc, composite, frameIndex } from '../core/doc';
import { brushOffsets } from '../core/raster';
import type { AppState } from '../state/store';
import { checkerTile, layerCanvas } from './layerCache';

const FELT = '#5b5a61';
const SHADOW = 'rgba(22, 21, 28, 0.5)';
const GRID = 'rgba(36, 34, 46, 0.2)';

const BRUSH_TOOLS = new Set(['pencil', 'eraser', 'line', 'rect']);
/** Onion skin strength: the previous frame reads more than the next one. */
const ONION_PREVIOUS = 0.3;
const ONION_NEXT = 0.15;

interface Ghost {
  canvas: HTMLCanvasElement;
  version: number;
}

/** Flattened neighbouring frames, rebuilt only when the document changes. */
let ghosts = new Map<string, Ghost>();

function ghostCanvas(doc: Doc, frameId: string, version: number, keep: Map<string, Ghost>): HTMLCanvasElement {
  let ghost = ghosts.get(frameId);
  if (!ghost || ghost.canvas.width !== doc.width || ghost.canvas.height !== doc.height) {
    const canvas = document.createElement('canvas');
    canvas.width = doc.width;
    canvas.height = doc.height;
    ghost = { canvas, version: -1 };
  }
  if (ghost.version !== version) {
    const pixels = composite(doc, frameId);
    const image = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), doc.width, doc.height);
    ghost.canvas.getContext('2d')!.putImageData(image, 0, 0);
    ghost.version = version;
  }
  keep.set(frameId, ghost);
  return ghost.canvas;
}

function drawOnionSkin(ctx: CanvasRenderingContext2D, s: AppState, dw: number, dh: number) {
  const { doc, view } = s;
  const keep = new Map<string, Ghost>();
  const index = frameIndex(doc);
  const neighbours: Array<[number, number]> = [
    [index - 1, ONION_PREVIOUS],
    [index + 1, ONION_NEXT],
  ];
  for (const [i, alpha] of neighbours) {
    const frame = doc.frames[i];
    if (!frame) continue;
    ctx.globalAlpha = alpha;
    ctx.drawImage(ghostCanvas(doc, frame.id, s.version, keep), view.panX, view.panY, dw, dh);
  }
  ctx.globalAlpha = 1;
  ghosts = keep;
}

export function renderViewport(ctx: CanvasRenderingContext2D, s: AppState) {
  const { doc, view } = s;
  const { width: W, height: H, zoom, panX, panY, dpr } = view;
  const dw = Math.round(doc.width * zoom);
  const dh = Math.round(doc.height * zoom);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.fillStyle = FELT;
  ctx.fillRect(0, 0, W, H);

  // Hard offset shadow, like a sprite lifted off the table.
  const lift = Math.round(4 * dpr);
  ctx.fillStyle = SHADOW;
  ctx.fillRect(panX + lift, panY + lift, dw, dh);

  const pattern = ctx.createPattern(checkerTile(Math.max(4, Math.round(8 * dpr))), 'repeat')!;
  pattern.setTransform(new DOMMatrix([1, 0, 0, 1, panX, panY]));
  ctx.fillStyle = pattern;
  ctx.fillRect(panX, panY, dw, dh);

  if (s.onionSkin && !s.playing && doc.frames.length > 1) drawOnionSkin(ctx, s, dw, dh);

  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layerCanvas(layer, doc.width, doc.height), panX, panY, dw, dh);
  }
  ctx.globalAlpha = 1;

  if (s.showGrid && zoom >= 6) {
    ctx.fillStyle = GRID;
    const x0 = Math.max(1, Math.floor(-panX / zoom));
    const x1 = Math.min(doc.width - 1, Math.ceil((W - panX) / zoom));
    for (let x = x0; x <= x1; x++) ctx.fillRect(panX + Math.round(x * zoom), panY, 1, dh);
    const y0 = Math.max(1, Math.floor(-panY / zoom));
    const y1 = Math.min(doc.height - 1, Math.ceil((H - panY) / zoom));
    for (let y = y0; y <= y1; y++) ctx.fillRect(panX, panY + Math.round(y * zoom), dw, 1);
  }

  if (s.selection) drawSelection(ctx, s);
  drawCursor(ctx, s);
}

/** Dashed black-and-white outline, readable over any colour. */
function drawSelection(ctx: CanvasRenderingContext2D, s: AppState) {
  const { selection: r, view } = s;
  if (!r) return;
  const x = view.panX + Math.round(r.x * view.zoom) - 0.5;
  const y = view.panY + Math.round(r.y * view.zoom) - 0.5;
  const w = Math.round(r.w * view.zoom) + 1;
  const h = Math.round(r.h * view.zoom) + 1;
  const dash = Math.max(3, Math.round(4 * view.dpr));
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(16, 15, 22, 0.9)';
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([dash, dash]);
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

function drawCursor(ctx: CanvasRenderingContext2D, s: AppState) {
  const { hover, view, tool, settings, panKey } = s;
  if (!hover || panKey) return;
  const { zoom, panX, panY } = view;
  const cells = BRUSH_TOOLS.has(tool) && tool !== 'rect' ? brushOffsets(settings.brushSize, settings.brushShape) : [[0, 0] as const];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ctx.fillStyle = tool === 'eraser' ? 'rgba(255, 255, 255, 0.35)' : toCss(s.primary);
  for (const [ox, oy] of cells) {
    const x = hover.x + ox;
    const y = hover.y + oy;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (tool === 'pencil' || tool === 'line' || tool === 'eraser') {
      ctx.fillRect(panX + Math.round(x * zoom), panY + Math.round(y * zoom), Math.ceil(zoom), Math.ceil(zoom));
    }
  }

  const left = panX + Math.round(minX * zoom);
  const top = panY + Math.round(minY * zoom);
  const w = Math.round((maxX - minX + 1) * zoom);
  const h = Math.round((maxY - minY + 1) * zoom);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(16, 15, 22, 0.85)';
  ctx.strokeRect(left - 1.5, top - 1.5, w + 3, h + 3);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.strokeRect(left - 0.5, top - 0.5, w + 1, h + 1);
}
