import { toCss } from '../core/color';
import { brushOffsets } from '../core/raster';
import type { AppState } from '../state/store';
import { checkerTile, layerCanvas } from './layerCache';

const FELT = '#5b5a61';
const SHADOW = 'rgba(22, 21, 28, 0.5)';
const GRID = 'rgba(36, 34, 46, 0.2)';

const BRUSH_TOOLS = new Set(['pencil', 'eraser', 'line', 'rect']);

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

  drawCursor(ctx, s);
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
