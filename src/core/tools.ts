import type { Doc, Layer } from './doc';
import { PixelEditor } from './editor';
import type { Entry } from './history';
import { type BrushShape, brushOffsets, floodFill, line, rectCells, snapToPerfectAngle } from './raster';

export type ToolId = 'pencil' | 'eraser' | 'line' | 'rect' | 'fill' | 'eyedropper' | 'select';

export interface ToolSettings {
  brushSize: number;
  brushShape: BrushShape;
  /** Removes the doubled corner pixels freehand 1px strokes leave behind. */
  pixelPerfect: boolean;
  /** Line tool snaps to perfect angles; Shift inverts this while dragging. */
  perfectAngle: boolean;
  rectFilled: boolean;
  fillContiguous: boolean;
  sampleAllLayers: boolean;
}

export const DEFAULT_SETTINGS: ToolSettings = {
  brushSize: 1,
  brushShape: 'square',
  pixelPerfect: true,
  perfectAngle: false,
  rectFilled: false,
  fillContiguous: true,
  sampleAllLayers: true,
};

export interface Session {
  move(x: number, y: number, shift: boolean): void;
  end(): Entry | null;
}

export function startSession(
  tool: Exclude<ToolId, 'eyedropper' | 'select'>,
  doc: Doc,
  layer: Layer,
  color: number,
  settings: ToolSettings,
  x: number,
  y: number,
  shift: boolean,
): Session {
  const editor = new PixelEditor(layer, doc.width, doc.height);
  const offsets = brushOffsets(settings.brushSize, settings.brushShape);
  const ink = tool === 'eraser' ? 0 : color;
  const stamp = (px: number, py: number) => {
    for (const [ox, oy] of offsets) editor.set(px + ox, py + oy, ink);
  };

  switch (tool) {
    case 'pencil':
    case 'eraser':
      return freehand(editor, stamp, ink, settings.pixelPerfect && settings.brushSize === 1, x, y);

    case 'line': {
      const draw = (ex: number, ey: number, snap: boolean) => {
        editor.revertAll();
        const [tx, ty] = snap ? snapToPerfectAngle(x, y, ex, ey) : [ex, ey];
        line(x, y, tx, ty, stamp);
      };
      draw(x, y, false);
      return {
        move: (ex, ey, sh) => draw(ex, ey, settings.perfectAngle !== sh),
        end: () => editor.toEntry(),
      };
    }

    case 'rect': {
      const draw = (ex: number, ey: number, square: boolean) => {
        editor.revertAll();
        let tx = ex;
        let ty = ey;
        if (square) {
          const side = Math.max(Math.abs(ex - x), Math.abs(ey - y));
          tx = x + (Math.sign(ex - x) || 1) * side;
          ty = y + (Math.sign(ey - y) || 1) * side;
        }
        rectCells(x, y, tx, ty, settings.rectFilled, settings.brushSize, (px, py) => editor.set(px, py, ink));
      };
      draw(x, y, shift);
      return { move: draw, end: () => editor.toEntry() };
    }

    case 'fill': {
      for (const i of floodFill(layer.pixels, doc.width, doc.height, x, y, settings.fillContiguous)) {
        editor.setIndex(i, ink);
      }
      return { move: () => {}, end: () => editor.toEntry() };
    }
  }
}

function freehand(
  editor: PixelEditor,
  stamp: (x: number, y: number) => void,
  ink: number,
  pixelPerfect: boolean,
  x: number,
  y: number,
): Session {
  let lastX = x;
  let lastY = y;
  // Pixel-perfect bookkeeping: the stroke's path and how often each pixel appears in it.
  const path: Array<[number, number]> = [];
  const visits = new Map<number, number>();
  const key = (px: number, py: number) => py * editor.width + px;

  const plot = (px: number, py: number) => {
    if (!pixelPerfect) {
      stamp(px, py);
      return;
    }
    editor.set(px, py, ink);
    path.push([px, py]);
    visits.set(key(px, py), (visits.get(key(px, py)) ?? 0) + 1);
    if (path.length < 3) return;
    const a = path[path.length - 3];
    const b = path[path.length - 2];
    const c = path[path.length - 1];
    const diagonal = Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1;
    if (!diagonal) return;
    // b is the corner of an L between two diagonal neighbours: drop it.
    path.splice(path.length - 2, 1);
    const k = key(b[0], b[1]);
    const left = (visits.get(k) ?? 1) - 1;
    visits.set(k, left);
    if (left === 0) editor.restore(b[0], b[1]);
  };

  plot(x, y);
  return {
    move(nx, ny) {
      if (nx === lastX && ny === lastY) return;
      line(lastX, lastY, nx, ny, (px, py) => {
        if (px !== lastX || py !== lastY) plot(px, py);
      });
      lastX = nx;
      lastY = ny;
    },
    end: () => editor.toEntry(),
  };
}
