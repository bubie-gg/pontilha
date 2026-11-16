import { type FrameRange, docFromFrames, renderGif, renderSheet, sheetGrid, sliceSheet } from '../core/animation';
import { fromBase64, toBase64 } from '../core/base64';
import { parseHex, sameColor, toHex } from '../core/color';
import {
  type Frame,
  type Layer,
  type Tag,
  MAX_FRAMES,
  MAX_SIZE,
  celOf,
  clampDuration,
  composite,
  createDoc,
  frameIndex,
  tagRange,
} from '../core/doc';
import { PixelEditor } from '../core/editor';
import {
  type WaveDirection,
  type WaveShape,
  blobify,
  edgeDistance,
  loopOffset,
  offPalette,
  paintedMask,
  particlesAt,
  posterize,
  rotate,
  shadeSides,
  wave,
} from '../core/effects';
import type { Entry } from '../core/history';
import { encodePng, scaleNearest } from '../core/png';
import { type ColorScope, PRESETS, hueShiftRamp, scopeCels, usedColors } from '../core/palette';
import { type Recipe, parseProject, serializeProject } from '../core/project';
import {
  type Point,
  brushOffsets,
  burstCells,
  ellipseCells,
  floodFill,
  line,
  outlineIndices,
  polygonCells,
  rectCells,
  regularPolygonPoints,
  snapToPerfectAngle,
  starCells,
} from '../core/raster';
import type { ToolId } from '../core/tools';
import { ANCHORS, type Anchor, type Selection, contentBounds, selectedCount, shiftCel } from '../core/transform';
import { decodeImage } from '../platform/files';
import { type Target, ZOOM_LEVELS, actions, activeLayer, useApp } from '../state/store';

/**
 * Commands scripts and agents can run over the control port. Every command that
 * changes the image records exactly one undo step; `batch` records one for all.
 */

export class CommandError extends Error {}

export type Params = Record<string, unknown>;

interface Command {
  summary: string;
  /** Parameter list as shown by `commands.list`; `?` marks optional ones. */
  params: string;
  /** Read-only commands don't announce themselves in the status bar. */
  readOnly?: boolean;
  run: (p: Params) => unknown;
}

const VERSION = '0.1.0';

function fail(message: string): never {
  throw new CommandError(message);
}

function has(p: Params, key: string) {
  return p[key] !== undefined && p[key] !== null;
}

function num(p: Params, key: string, fallback?: number): number {
  if (!has(p, key)) {
    if (fallback === undefined) fail(`the "${key}" parameter is required`);
    return fallback;
  }
  const v = p[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`"${key}" must be a number, got ${JSON.stringify(v)}`);
  return v;
}

const int = (p: Params, key: string, fallback?: number) => Math.round(num(p, key, fallback));

function bool(p: Params, key: string, fallback: boolean): boolean {
  if (!has(p, key)) return fallback;
  if (typeof p[key] !== 'boolean') fail(`"${key}" must be true or false`);
  return p[key] as boolean;
}

function text(p: Params, key: string, fallback?: string): string {
  if (!has(p, key)) {
    if (fallback === undefined) fail(`the "${key}" parameter is required`);
    return fallback;
  }
  if (typeof p[key] !== 'string') fail(`"${key}" must be text`);
  return p[key] as string;
}

function colorValue(value: unknown, key: string): number {
  if (value === null || value === 'transparent') return 0;
  if (typeof value !== 'string') fail(`"${key}" must be a color like "#c93c4a" or "transparent"`);
  const c = parseHex(value);
  if (c === null) fail(`invalid color in "${key}": ${value}. Use #rrggbb, #rrggbbaa or "transparent".`);
  return c;
}

function requiredColor(p: Params, key: string): number {
  if (p[key] === undefined) fail(`the "${key}" parameter is required`);
  return colorValue(p[key], key);
}

/** `color` param, defaulting to the current primary colour. */
function color(p: Params, key = 'color'): number {
  return p[key] === undefined ? useApp.getState().primary : colorValue(p[key], key);
}

function layerRef(ref: unknown): Layer {
  const { doc } = useApp.getState();
  const layer = doc.layers.find((l) => l.id === ref) ?? doc.layers.find((l) => l.name === ref);
  if (!layer) fail(`layer not found: ${JSON.stringify(ref)}. Layers: ${doc.layers.map((l) => l.name).join(', ')}`);
  return layer;
}

function frameRef(ref: unknown): Frame {
  const { doc } = useApp.getState();
  const frame =
    typeof ref === 'number' && Number.isInteger(ref) ? doc.frames[ref - 1] : doc.frames.find((f) => f.id === ref);
  if (!frame) fail(`frame not found: ${JSON.stringify(ref)}. Use its number (1 to ${doc.frames.length}) or its id.`);
  return frame;
}

/** `frame` param (number from 1, or id), defaulting to the frame on screen. */
function targetFrame(p: Params): Frame {
  const { doc } = useApp.getState();
  return has(p, 'frame') ? frameRef(p.frame) : doc.frames[frameIndex(doc)];
}

/** `layer` and `frame` params as the cel a selection command works on. */
function selectionTarget(p: Params): Target {
  const { doc } = useApp.getState();
  const layer = targetLayer(p);
  return { layer, cel: celOf(doc, layer, targetFrame(p).id) };
}

/** A selection for JSON: its box and how many pixels it holds; `shaped` when it isn't the whole box. */
function selectionInfo(sel: Selection | null) {
  return sel && { x: sel.x, y: sel.y, w: sel.w, h: sel.h, pixels: selectedCount(sel), shaped: !!sel.mask };
}

const currentSelection = () => selectionInfo(useApp.getState().selection);

function tagRef(ref: unknown): Tag {
  const { doc } = useApp.getState();
  const tag = doc.tags.find((t) => t.id === ref) ?? doc.tags.find((t) => t.name === ref);
  if (!tag) fail(`tag not found: ${JSON.stringify(ref)}. Tags: ${doc.tags.map((t) => t.name).join(', ') || 'none'}`);
  return tag;
}

/** `tag` param as the frames to export, or every frame without it. */
function exportRange(p: Params): FrameRange | undefined {
  if (!has(p, 'tag')) return undefined;
  return tagRange(useApp.getState().doc, tagRef(p.tag)) ?? fail('this tag lost one of its end frames');
}

function tagInfo(tag: Tag) {
  const range = tagRange(useApp.getState().doc, tag);
  return { id: tag.id, name: tag.name, from: range ? range[0] + 1 : null, to: range ? range[1] + 1 : null };
}

function frameInfo(frame: Frame, index: number) {
  return { id: frame.id, number: index + 1, duration: frame.duration };
}

function colorScope(p: Params): ColorScope {
  const scope = text(p, 'scope', 'all');
  if (scope !== 'all' && scope !== 'layer' && scope !== 'frame') fail('scope must be "all", "layer" or "frame"');
  return scope;
}

/** `layer` param (id or name), defaulting to the active layer. */
function targetLayer(p: Params): Layer {
  return has(p, 'layer') ? layerRef(p.layer) : activeLayer();
}

function layerInfo(layer: Layer, index: number) {
  let painted = 0;
  for (const px of layer.pixels) if (px >>> 24) painted++;
  return { id: layer.id, name: layer.name, index, visible: layer.visible, opacity: layer.opacity, painted };
}

function inspect() {
  const s = useApp.getState();
  return {
    width: s.doc.width,
    height: s.doc.height,
    fileName: s.fileName,
    dirty: s.dirty,
    activeLayer: activeLayer().name,
    layers: s.doc.layers.map(layerInfo).reverse(),
    frame: frameIndex(s.doc) + 1,
    frames: s.doc.frames.map(frameInfo),
    tags: s.doc.tags.map(tagInfo),
    selection: selectionInfo(s.selection),
    primary: toHex(s.primary),
    secondary: toHex(s.secondary),
    palette: s.palette.map(toHex),
    tool: s.tool,
    canUndo: s.canUndo,
    canRedo: s.canRedo,
    recipes: s.recipes.map((r) => ({ name: r.name, steps: r.steps.length })),
    recording: recording?.name ?? null,
  };
}

/**
 * `onlyOn` limits painting to pixels that were, before this command, already
 * painted ("painted"), empty ("transparent") or of one colour. It is how shading
 * stays inside a shape: paint the shape, then paint shadows only on its colour.
 */
function maskFor(p: Params, cel: Uint32Array): ((index: number) => boolean) | null {
  if (!has(p, 'onlyOn')) return null;
  const before = cel.slice();
  if (p.onlyOn === 'painted') return (i) => before[i] >>> 24 !== 0;
  if (p.onlyOn === 'transparent') return (i) => before[i] >>> 24 === 0;
  const only = colorValue(p.onlyOn, 'onlyOn');
  return (i) => sameColor(before[i], only);
}

/** Draws through a PixelEditor on the target layer and frame, and records the result as one undo step. */
function paint(p: Params, draw: (editor: PixelEditor, width: number, height: number) => void) {
  const { doc } = useApp.getState();
  const layer = targetLayer(p);
  const cel = celOf(doc, layer, targetFrame(p).id);
  const editor = new PixelEditor(layer, doc.width, doc.height, cel);
  editor.allow = maskFor(p, cel);
  draw(editor, doc.width, doc.height);
  const entry = editor.toEntry();
  actions.commit(entry);
  return { layer: layer.name, changed: entry?.kind === 'pixels' ? entry.indices.length : 0 };
}

/** Paints several cels and records them all as one undo step. `draw` gets each editor and its index in the list. */
function paintCels(
  p: Params,
  cels: Array<{ layer: Layer; frame: Frame }>,
  draw: (editor: PixelEditor, index: number, width: number, height: number) => void,
) {
  const { doc } = useApp.getState();
  const entries: Entry[] = [];
  let changed = 0;
  cels.forEach(({ layer, frame }, index) => {
    const cel = celOf(doc, layer, frame.id);
    const editor = new PixelEditor(layer, doc.width, doc.height, cel);
    editor.allow = maskFor(p, cel);
    draw(editor, index, doc.width, doc.height);
    const entry = editor.toEntry();
    if (entry?.kind !== 'pixels') return;
    entries.push(entry);
    changed += entry.indices.length;
  });
  actions.commit(entries.length === 0 ? null : entries.length === 1 ? entries[0] : { kind: 'group', entries });
  return { changed, cels: cels.length };
}

/** Writes whole new pixels into a cel through an editor, so only real changes are recorded. */
function writeAll(editor: PixelEditor, pixels: Uint32Array) {
  for (let i = 0; i < pixels.length; i++) if (editor.cel[i] !== pixels[i]) editor.setIndex(i, pixels[i]);
}

/** Frames an animation command covers: a tag's, from..to (numbers from 1), or every frame. */
function frameSpan(p: Params): Frame[] {
  const { doc } = useApp.getState();
  if (has(p, 'tag')) {
    const [a, b] = exportRange(p)!;
    return doc.frames.slice(a, b + 1);
  }
  if (has(p, 'from') || has(p, 'to')) {
    const a = has(p, 'from') ? frameIndex(doc, frameRef(p.from).id) : 0;
    const b = has(p, 'to') ? frameIndex(doc, frameRef(p.to).id) : doc.frames.length - 1;
    if (b < a) fail('to must come after from');
    return doc.frames.slice(a, b + 1);
  }
  return doc.frames;
}

/** Frames a whole-cel effect paints: the one on screen (or frame), or with allFrames/tag every frame in the span. */
function effectFrames(p: Params): Frame[] {
  return bool(p, 'allFrames', false) || has(p, 'tag') || has(p, 'from') || has(p, 'to') ? frameSpan(p) : [targetFrame(p)];
}

/** Adds copies of the last frame until the animation has `count` frames. */
function ensureFrames(count: number) {
  if (count > MAX_FRAMES) fail(`the maximum is ${MAX_FRAMES} frames`);
  while (useApp.getState().doc.frames.length < count) {
    const { doc } = useApp.getState();
    actions.selectFrame(doc.frames[doc.frames.length - 1].id);
    if (!actions.addFrame({ copy: true })) fail('could not create the frames');
  }
}

/** `frames` param: grow the animation to that many frames first (copying the last one). */
function framesParam(p: Params) {
  if (!has(p, 'frames')) return;
  const n = int(p, 'frames');
  if (n < 1) fail('frames must be at least 1');
  ensureFrames(n);
}

/** `palette` (list of colours) or `preset` (name), defaulting to the editor's palette. */
function paletteParam(p: Params): number[] {
  if (has(p, 'preset')) return presetRef(p.preset).colors;
  if (has(p, 'palette')) {
    if (!Array.isArray(p.palette) || p.palette.length === 0) fail('palette must be a list of colors');
    return p.palette.map((c, i) => colorValue(c, `palette[${i}]`)).filter((c) => c >>> 24);
  }
  const { palette } = useApp.getState();
  if (palette.length === 0) fail('the palette is empty; pass palette or preset');
  return palette;
}

function presetRef(name: unknown) {
  const preset = typeof name === 'string' ? PRESETS[name.toLowerCase()] : undefined;
  if (!preset) fail(`unknown palette: ${JSON.stringify(name)}. Known: ${Object.keys(PRESETS).join(', ')}`);
  return preset;
}

/** `on` param: the shape an effect works on, as a mask of a cel: painted pixels (default) or one colour. */
function regionOf(p: Params, cel: Uint32Array): Uint8Array {
  if (!has(p, 'on') || p.on === 'painted') return paintedMask(cel);
  const only = colorValue(p.on, 'on');
  const mask = new Uint8Array(cel.length);
  for (let i = 0; i < cel.length; i++) mask[i] = sameColor(cel[i], only) && cel[i] >>> 24 ? 1 : 0;
  return mask;
}

function colorList(p: Params, key: string): number[] {
  const list = p[key];
  if (!Array.isArray(list) || list.length === 0) fail(`${key} must be a list of colors`);
  return list.map((c, i) => colorValue(c, `${key}[${i}]`));
}

function choice<T extends string>(p: Params, key: string, options: readonly T[], fallback: T): T {
  const v = text(p, key, fallback);
  if (!options.includes(v as T)) fail(`${key} must be one of: ${options.join(', ')}`);
  return v as T;
}

// Recipes: while one is recording, every command that changes the image is kept, in order.

/**
 * The recipe being recorded. `units` counts the steps each undo step added (a batch
 * is one undo step but several recipe steps), so undo and redo move whole units.
 */
let recording: (Recipe & { units: number[]; undone: Array<Recipe['steps']> }) | null = null;
let replaying = false;

const NOT_RECORDED = ['recipe.', 'project.', 'image.', 'history.'];

function record(method: string, params: Params) {
  if (!recording || replaying || NOT_RECORDED.some((prefix) => method.startsWith(prefix))) return;
  recording.steps.push({ method, params: structuredClone(params) });
  recording.undone = [];
}

/** Runs `work` (one undo step) and groups the recipe steps it recorded into one unit; mirrors undo and redo. */
async function recordUnit<T>(method: string, work: () => Promise<T>): Promise<T> {
  const before = recording?.steps.length ?? 0;
  const result = await work();
  if (!recording || replaying) return result;
  if (method === 'history.undo') {
    const n = recording.units.pop();
    if (n) recording.undone.push(recording.steps.splice(recording.steps.length - n, n));
  } else if (method === 'history.redo') {
    const steps = recording.undone.pop();
    if (steps) {
      recording.steps.push(...steps);
      recording.units.push(steps.length);
    }
  } else if (recording.steps.length > before) {
    recording.units.push(recording.steps.length - before);
  }
  return result;
}

/** Params with every colour found in `swap` (old → new) replaced, at any depth. */
function swapColors(value: unknown, swap: Map<number, string>): unknown {
  if (typeof value === 'string') {
    const c = parseHex(value);
    return c !== null && swap.has(c) ? swap.get(c) : value;
  }
  if (Array.isArray(value)) return value.map((v) => swapColors(v, swap));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapColors(v, swap)]));
  }
  return value;
}

function guardUnsaved(p: Params) {
  if (useApp.getState().dirty && !bool(p, 'discard', false)) {
    fail('the open image has unsaved changes. Save first or pass discard: true to discard them.');
  }
}

function checkSize(width: number, height: number) {
  if (width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) {
    fail(`size ${width} × ${height} is outside the 1 to ${MAX_SIZE} px limit`);
  }
}

const ASCII_KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const COMMANDS: Record<string, Command> = {
  'app.info': {
    summary: 'App version and command names.',
    params: '',
    readOnly: true,
    run: () => ({ app: 'pontilha', version: VERSION, commands: Object.keys(COMMANDS).concat('batch') }),
  },

  'commands.list': {
    summary: 'Lists the commands with their parameters. filter searches the name and the description.',
    params: 'filter?',
    readOnly: true,
    run: (p) => {
      const filter = text(p, 'filter', '').toLowerCase();
      return Object.entries(COMMANDS)
        .filter(([id, c]) => !filter || id.includes(filter) || c.summary.toLowerCase().includes(filter))
        .map(([id, c]) => ({ id, params: c.params, summary: c.summary }))
        .concat(
          !filter || 'batch'.includes(filter)
            ? [{ id: 'batch', params: 'commands: [{method, params}], label?', summary: 'Runs several commands as a single undo step. If one fails, nothing is applied.' }]
            : [],
        );
    },
  },

  // Document

  'doc.inspect': {
    summary: 'Size, layers (top first), colors, palette and history state.',
    params: '',
    readOnly: true,
    run: inspect,
  },

  'doc.new': {
    summary: 'Creates an empty image. Refuses if there are unsaved changes, unless discard is true.',
    params: 'width, height, name?, discard?',
    run: (p) => {
      const width = int(p, 'width');
      const height = int(p, 'height');
      checkSize(width, height);
      guardUnsaved(p);
      actions.newDoc(width, height);
      if (has(p, 'name')) useApp.setState({ fileName: text(p, 'name') });
      return inspect();
    },
  },

  'doc.ascii': {
    summary: 'Draws the image (or one layer) as text: one letter per color, a dot for transparent.',
    params: 'layer?, frame?, x?, y?, w?, h?',
    readOnly: true,
    run: (p) => {
      const { doc } = useApp.getState();
      const x0 = int(p, 'x', 0);
      const y0 = int(p, 'y', 0);
      const w = Math.min(int(p, 'w', doc.width - x0), doc.width - x0);
      const h = Math.min(int(p, 'h', doc.height - y0), doc.height - y0);
      if (w * h > 128 * 128) fail('region too large for text; ask for at most 128 × 128 with x, y, w, h');
      const frame = targetFrame(p).id;
      const pixels = has(p, 'layer') ? celOf(doc, layerRef(p.layer), frame) : composite(doc, frame);
      const keys = new Map<number, string>();
      const rows: string[] = [];
      for (let y = y0; y < y0 + h; y++) {
        let row = '';
        for (let x = x0; x < x0 + w; x++) {
          const c = pixels[y * doc.width + x];
          if (c >>> 24 === 0) {
            row += '.';
            continue;
          }
          if (!keys.has(c)) keys.set(c, ASCII_KEYS[keys.size] ?? '?');
          row += keys.get(c);
        }
        rows.push(row);
      }
      return { rows, legend: Object.fromEntries([...keys].map(([c, k]) => [k, toHex(c)])) };
    },
  },

  // Layers

  'layer.new': {
    summary: 'Creates a layer above the active one and makes it active.',
    params: 'name?, opacity?, visible?',
    run: (p) => {
      const layer = actions.addLayer({
        name: has(p, 'name') ? text(p, 'name') : undefined,
        opacity: has(p, 'opacity') ? num(p, 'opacity') : undefined,
        visible: has(p, 'visible') ? bool(p, 'visible', true) : undefined,
      });
      return layerInfo(layer, useApp.getState().doc.layers.indexOf(layer));
    },
  },

  'layer.import': {
    summary: 'Creates a layer from a PNG image (base64), placed at x, y. Useful for references at 50%.',
    params: 'png, name?, x?, y?, opacity?, visible?',
    run: async (p) => {
      const { doc } = useApp.getState();
      const image = await decodeImage(fromBase64(text(p, 'png')));
      const ox = int(p, 'x', 0);
      const oy = int(p, 'y', 0);
      const pixels = new Uint32Array(doc.width * doc.height);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const tx = x + ox;
          const ty = y + oy;
          if (tx >= 0 && ty >= 0 && tx < doc.width && ty < doc.height) pixels[ty * doc.width + tx] = image.pixels[y * image.width + x];
        }
      }
      const layer = actions.addLayer({
        name: has(p, 'name') ? text(p, 'name') : 'Reference',
        opacity: num(p, 'opacity', 1),
        visible: bool(p, 'visible', true),
        pixels,
      });
      return { ...layerInfo(layer, useApp.getState().doc.layers.indexOf(layer)), imageWidth: image.width, imageHeight: image.height };
    },
  },

  'layer.select': {
    summary: 'Makes the layer given by name or id active.',
    params: 'layer',
    run: (p) => {
      if (!has(p, 'layer')) fail('the "layer" parameter is required');
      const layer = layerRef(p.layer);
      actions.setActiveLayer(layer.id);
      return { active: layer.name };
    },
  },

  'layer.setProps': {
    summary: 'Changes the name, opacity (0 to 1) or visibility of a layer.',
    params: 'layer?, name?, opacity?, visible?',
    run: (p) => {
      const layer = targetLayer(p);
      actions.updateLayer(layer.id, {
        name: has(p, 'name') ? text(p, 'name') : undefined,
        opacity: has(p, 'opacity') ? num(p, 'opacity') : undefined,
        visible: has(p, 'visible') ? bool(p, 'visible', true) : undefined,
      });
      return layerInfo(layer, useApp.getState().doc.layers.indexOf(layer));
    },
  },

  'layer.delete': {
    summary: 'Deletes a layer (the image keeps at least one).',
    params: 'layer?',
    run: (p) => {
      const layer = targetLayer(p);
      if (useApp.getState().doc.layers.length === 1) fail('the image needs at least one layer');
      actions.setActiveLayer(layer.id);
      actions.deleteLayer();
      return { deleted: layer.name, active: activeLayer().name };
    },
  },

  'layer.duplicate': {
    summary: 'Duplicates a layer right above it.',
    params: 'layer?',
    run: (p) => {
      actions.setActiveLayer(targetLayer(p).id);
      actions.duplicateLayer();
      const copy = activeLayer();
      return layerInfo(copy, useApp.getState().doc.layers.indexOf(copy));
    },
  },

  'layer.move': {
    summary: 'Moves a layer up or down one position.',
    params: 'layer?, direction: "up" | "down"',
    run: (p) => {
      const direction = text(p, 'direction');
      if (direction !== 'up' && direction !== 'down') fail('direction must be "up" or "down"');
      const layer = targetLayer(p);
      actions.setActiveLayer(layer.id);
      actions.moveLayer(direction === 'up' ? 1 : -1);
      return { layer: layer.name, index: useApp.getState().doc.layers.indexOf(layer) };
    },
  },

  'layer.mergeDown': {
    summary: 'Merges a visible layer with the one below.',
    params: 'layer?',
    run: (p) => {
      const layer = targetLayer(p);
      const { doc } = useApp.getState();
      if (doc.layers.indexOf(layer) === 0) fail('there is no layer below to merge with');
      if (!layer.visible) fail('show the layer before merging');
      actions.setActiveLayer(layer.id);
      actions.mergeDown();
      return { active: activeLayer().name };
    },
  },

  'layer.clear': {
    summary: 'Erases every pixel of a layer in the current frame (or in frame).',
    params: 'layer?, frame?',
    run: (p) =>
      paint(p, (editor, width, height) => {
        for (let i = 0; i < width * height; i++) editor.setIndex(i, 0);
      }),
  },

  // Frames. Every layer has an image in every frame; draw commands paint on the frame on screen unless given frame.

  'frame.new': {
    summary: 'Creates a frame right after the current one and shows it. copy true copies the current frame; without copy it starts empty.',
    params: 'copy?, duration?',
    run: (p) => {
      const frame = actions.addFrame({ copy: bool(p, 'copy', false), duration: has(p, 'duration') ? num(p, 'duration') : undefined });
      if (!frame) fail('the animation already has the maximum number of frames');
      const { doc } = useApp.getState();
      return frameInfo(frame, frameIndex(doc, frame.id));
    },
  },

  'frame.select': {
    summary: 'Shows another frame: the following drawing goes to it.',
    params: 'frame',
    run: (p) => {
      if (!has(p, 'frame')) fail('the "frame" parameter is required');
      const frame = frameRef(p.frame);
      actions.selectFrame(frame.id);
      return frameInfo(frame, frameIndex(useApp.getState().doc, frame.id));
    },
  },

  'frame.delete': {
    summary: 'Deletes a frame, the current one if frame is not given (the animation keeps at least one).',
    params: 'frame?',
    run: (p) => {
      const frame = targetFrame(p);
      if (useApp.getState().doc.frames.length === 1) fail('the animation needs at least one frame');
      actions.deleteFrame(frame.id);
      const { doc } = useApp.getState();
      return { deleted: frame.id, frame: frameIndex(doc) + 1, frames: doc.frames.length };
    },
  },

  'frame.move': {
    summary: 'Moves a frame to position to (1 = first).',
    params: 'frame?, to',
    run: (p) => {
      const frame = targetFrame(p);
      actions.moveFrame(frame.id, int(p, 'to') - 1);
      return frameInfo(frame, frameIndex(useApp.getState().doc, frame.id));
    },
  },

  'frame.setDuration': {
    summary: 'How long a frame stays on screen, in milliseconds (10 to 60000). all true changes every frame.',
    params: 'duration, frame?, all?',
    run: (p) => {
      const duration = num(p, 'duration');
      actions.setFrameDuration(bool(p, 'all', false) ? null : targetFrame(p).id, duration);
      return { frames: useApp.getState().doc.frames.map(frameInfo) };
    },
  },

  // Image size. Every layer and frame changes together, as one undo step; the selection is dropped.

  'canvas.resize': {
    summary:
      'Changes the canvas size without stretching the art. anchor says where the current image goes: center (default), top-left, top, top-right, left, right, bottom-left, bottom or bottom-right. Shrinking cuts off what does not fit.',
    params: 'width, height, anchor?',
    run: (p) => {
      const width = int(p, 'width');
      const height = int(p, 'height');
      checkSize(width, height);
      const anchor = text(p, 'anchor', 'center') as Anchor;
      if (!ANCHORS.includes(anchor)) fail(`anchor must be one of: ${ANCHORS.join(', ')}`);
      actions.resizeCanvas(width, height, anchor);
      return inspect();
    },
  },

  'canvas.crop': {
    summary: 'Crops the image to the rectangle x, y, w, h (without them, to the selection).',
    params: 'x?, y?, w?, h?',
    run: (p) => {
      const rect =
        has(p, 'w') || has(p, 'h')
          ? { x: int(p, 'x', 0), y: int(p, 'y', 0), w: int(p, 'w'), h: int(p, 'h') }
          : useApp.getState().selection;
      if (!rect) fail('pass x, y, w, h or select the area first');
      if (rect.w < 1 || rect.h < 1) fail('w and h must be at least 1');
      const { doc } = useApp.getState();
      if (rect.x >= doc.width || rect.y >= doc.height || rect.x + rect.w <= 0 || rect.y + rect.h <= 0) {
        fail('the rectangle is outside the image');
      }
      actions.cropTo(rect);
      return inspect();
    },
  },

  'canvas.trim': {
    summary: 'Trims the empty borders, keeping only what is painted in some layer or frame.',
    params: '',
    run: () => {
      const bounds = contentBounds(useApp.getState().doc);
      if (!bounds) fail('the image is empty');
      actions.cropTo(bounds);
      return { ...inspect(), kept: bounds };
    },
  },

  'canvas.scale': {
    summary: 'Scales the art up: each pixel becomes a factor × factor block (2 to 16), with no blurring.',
    params: 'factor',
    run: (p) => {
      const factor = int(p, 'factor');
      if (factor < 2 || factor > 16) fail('factor must be 2 to 16');
      const { doc } = useApp.getState();
      checkSize(doc.width * factor, doc.height * factor);
      actions.scaleImage(factor);
      return inspect();
    },
  },

  // Selection. Without a selection, move, flip, rotate, copy and cut act on the whole layer.

  'select.rect': {
    summary: 'Selects a rectangle (clipped to the image edges). add true adds to the current selection.',
    params: 'x, y, w, h, add?',
    run: (p) => {
      const w = int(p, 'w');
      const h = int(p, 'h');
      if (w < 1 || h < 1) fail('w and h must be at least 1');
      const before = useApp.getState().selection;
      actions.select({ x: int(p, 'x'), y: int(p, 'y'), w, h }, bool(p, 'add', false));
      const { selection } = useApp.getState();
      if (!selection || selection === before) fail('the rectangle is outside the image');
      return { selection: selectionInfo(selection) };
    },
  },

  'select.color': {
    summary:
      'Magic wand: selects the pixels of the color at (x, y), only the area connected to it (default) or, with contiguous false, the same color across the layer. add true adds to the current selection. Reads the given layer and frame.',
    params: 'x, y, contiguous?, add?, layer?, frame?',
    run: (p) => {
      const { doc } = useApp.getState();
      const x = int(p, 'x');
      const y = int(p, 'y');
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) fail(`(${x}, ${y}) is outside the image`);
      const selection = actions.selectColor(x, y, { contiguous: bool(p, 'contiguous', true), add: bool(p, 'add', false) }, selectionTarget(p));
      return { selection: selectionInfo(selection) };
    },
  },

  'select.all': {
    summary: 'Selects the whole image.',
    params: '',
    run: () => {
      actions.selectAll();
      return { selection: currentSelection() };
    },
  },

  'select.none': {
    summary: 'Clears the selection.',
    params: '',
    run: () => {
      actions.select(null);
      return { selection: null };
    },
  },

  'selection.move': {
    summary: 'Moves the selected pixels (and the selection) by dx, dy pixels. Whatever leaves the image is lost.',
    params: 'dx, dy, layer?, frame?',
    run: (p) => {
      actions.moveSelection(int(p, 'dx', 0), int(p, 'dy', 0), selectionTarget(p));
      return { selection: currentSelection() };
    },
  },

  'selection.flip': {
    summary: 'Flips the selected pixels.',
    params: 'axis: "horizontal" | "vertical", layer?, frame?',
    run: (p) => {
      const axis = text(p, 'axis');
      if (axis !== 'horizontal' && axis !== 'vertical') fail('axis must be "horizontal" or "vertical"');
      actions.flipSelection(axis, selectionTarget(p));
      return { selection: currentSelection() };
    },
  },

  'selection.rotate': {
    summary: 'Rotates the selected pixels 90° around the selection center. Without a selection, only on square images.',
    params: 'direction: "cw" | "ccw", layer?, frame?',
    run: (p) => {
      const direction = text(p, 'direction');
      if (direction !== 'cw' && direction !== 'ccw') fail('direction must be "cw" (clockwise) or "ccw" (counterclockwise)');
      if (!actions.rotateSelection(direction, selectionTarget(p))) fail('the image is not square; select the area to rotate');
      return { selection: currentSelection() };
    },
  },

  'selection.clear': {
    summary: 'Erases the selected pixels.',
    params: 'layer?, frame?',
    run: (p) => {
      if (!useApp.getState().selection) fail('nothing selected; use select.rect first, or layer.clear for the whole layer');
      actions.clearSelection(selectionTarget(p));
      return { selection: currentSelection() };
    },
  },

  'clipboard.copy': {
    summary: 'Copies the selected pixels of a layer and frame.',
    params: 'layer?, frame?',
    readOnly: true,
    run: (p) => ({ copied: selectionInfo(actions.copy(selectionTarget(p)).rect) }),
  },

  'clipboard.cut': {
    summary: 'Copies and erases the selected pixels.',
    params: 'layer?, frame?',
    run: (p) => ({ copied: selectionInfo(actions.cut(selectionTarget(p)).rect) }),
  },

  'clipboard.paste': {
    summary:
      'Pastes what was copied in the same place it came from (or with its corner at x, y) and selects it. Transparent pixels do not cover what is underneath. Useful for carrying a part to another frame.',
    params: 'x?, y?, layer?, frame?',
    run: (p) => {
      if (!useApp.getState().clipboard) fail('nothing copied yet; use clipboard.copy first');
      const at = { x: has(p, 'x') ? int(p, 'x') : undefined, y: has(p, 'y') ? int(p, 'y') : undefined };
      return { selection: selectionInfo(actions.paste(at, selectionTarget(p))) };
    },
  },

  // Tags: named stretches of frames, for playback and export.

  'tag.add': {
    summary: 'Names a stretch of the animation (a tag), from frame from to frame to (numbers from 1, or ids; both are included).',
    params: 'name, from, to',
    run: (p) => {
      const name = text(p, 'name').trim();
      if (!name) fail('name cannot be empty');
      if (useApp.getState().doc.tags.some((t) => t.name === name)) fail(`a tag named "${name}" already exists`);
      if (!has(p, 'from') || !has(p, 'to')) fail('from and to are required');
      return tagInfo(actions.addTag(name, frameRef(p.from).id, frameRef(p.to).id));
    },
  },

  'tag.delete': {
    summary: 'Deletes a tag (by name or id). The frames stay.',
    params: 'tag',
    run: (p) => {
      if (!has(p, 'tag')) fail('the "tag" parameter is required');
      const tag = tagRef(p.tag);
      actions.deleteTag(tag.id);
      return { deleted: tag.name, tags: useApp.getState().doc.tags.map(tagInfo) };
    },
  },

  // Colours

  'color.set': {
    summary: 'Sets the primary and/or secondary color, used when a drawing command gives no color.',
    params: 'primary?, secondary?',
    run: (p) => {
      if (has(p, 'primary')) actions.setPrimary(colorValue(p.primary, 'primary'));
      if (has(p, 'secondary')) actions.setSecondary(colorValue(p.secondary, 'secondary'));
      const s = useApp.getState();
      return { primary: toHex(s.primary), secondary: toHex(s.secondary) };
    },
  },

  'palette.set': {
    summary: 'Replaces the whole palette.',
    params: 'colors: string[]',
    run: (p) => {
      if (!Array.isArray(p.colors) || p.colors.length === 0) fail('colors must be a list of colors');
      const colors = [...new Set(p.colors.map((c, i) => colorValue(c, `colors[${i}]`)))].filter((c) => c >>> 24);
      useApp.setState({ palette: colors, dirty: true });
      return { palette: colors.map(toHex) };
    },
  },

  'palette.add': {
    summary: 'Adds a color to the palette.',
    params: 'color',
    run: (p) => {
      const c = requiredColor(p, 'color');
      if (!useApp.getState().palette.includes(c)) useApp.setState((s) => ({ palette: [...s.palette, c], dirty: true }));
      return { palette: useApp.getState().palette.map(toHex) };
    },
  },

  'palette.ramp': {
    summary:
      'Color ramp around color (default: the primary), darkest to lightest: darker, more saturated shadows leaning toward blue; lighter, less saturated highlights leaning toward yellow. shift is the hue shift per step, in degrees. add false only computes it.',
    params: 'color?, steps?, shift?, add?',
    run: (p) => {
      const steps = int(p, 'steps', 5);
      if (steps < 2 || steps > 12) fail('steps must be 2 to 12');
      const shift = num(p, 'shift', 12);
      if (shift < 0 || shift > 45) fail('shift must be 0 to 45 degrees');
      const ramp = hueShiftRamp(color(p), steps, shift);
      const added = bool(p, 'add', true) ? actions.addColors(ramp) : 0;
      return { ramp: ramp.map(toHex), added };
    },
  },

  'palette.preset': {
    summary: `Replaces the palette with a known one: ${Object.keys(PRESETS).join(', ')}. add true appends instead of replacing.`,
    params: 'name, add?',
    run: (p) => {
      const preset = presetRef(text(p, 'name'));
      if (bool(p, 'add', false)) actions.addColors(preset.colors);
      else useApp.setState({ palette: [...preset.colors], dirty: true });
      return { name: preset.label, palette: useApp.getState().palette.map(toHex) };
    },
  },

  'color.check': {
    summary:
      'Checks that the art only uses palette colors (the editor’s, palette or preset). Lists the colors outside it and how many pixels use each; semi-transparent ones also count as outside.',
    params: 'palette? | preset?, scope?, layer?, frame?',
    readOnly: true,
    run: (p) => {
      const { doc } = useApp.getState();
      const palette = paletteParam(p);
      const off = new Map<number, number>();
      for (const { cel } of scopeCels(doc, colorScope(p), targetLayer(p).id, targetFrame(p).id)) offPalette(cel, palette, off);
      const colors = [...off].sort((a, b) => b[1] - a[1]).map(([c, pixels]) => ({ color: toHex(c), pixels }));
      return { ok: colors.length === 0, pixels: colors.reduce((n, c) => n + c.pixels, 0), colors };
    },
  },

  'color.used': {
    summary: 'Painted colors and how many pixels use each, most used first. scope: all (default), layer (the layer in every frame) or frame (the frame in every layer).',
    params: 'scope?, layer?, frame?',
    readOnly: true,
    run: (p) => {
      const { doc } = useApp.getState();
      const scope = colorScope(p);
      return { colors: usedColors(doc, scope, targetLayer(p).id, targetFrame(p).id).map(({ color: c, pixels }) => ({ color: toHex(c), pixels })) };
    },
  },

  'color.replaceAll': {
    summary:
      'Replaces one color with another in every layer and frame, as one undo step. scope layer limits it to the layer (every frame); frame, to the frame (every layer). Good for recoloring a whole animation.',
    params: 'from, to, scope?, layer?, frame?',
    run: (p) => {
      const from = requiredColor(p, 'from');
      const to = requiredColor(p, 'to');
      const changed = actions.replaceColor(from, to, colorScope(p), { layer: targetLayer(p).id, frame: targetFrame(p).id });
      return { changed };
    },
  },

  // Drawing. Coordinates are image pixels, (0, 0) at the top-left.

  'draw.pixels': {
    summary: 'Paints individual pixels. Each item is [x, y] or [x, y, color]; "transparent" erases.',
    params: 'pixels: [[x, y, color?], ...], color?, onlyOn?, layer?, frame?',
    run: (p) => {
      if (!Array.isArray(p.pixels)) fail('pixels must be a list of [x, y] or [x, y, color]');
      const fallback = color(p);
      const list = p.pixels.map((item, i) => {
        if (!Array.isArray(item) || item.length < 2) fail(`pixels[${i}] must be [x, y] or [x, y, color]`);
        const [x, y, c] = item;
        if (typeof x !== 'number' || typeof y !== 'number') fail(`pixels[${i}] must have numeric x and y`);
        return [Math.round(x), Math.round(y), c === undefined ? fallback : colorValue(c, `pixels[${i}][2]`)] as const;
      });
      return paint(p, (editor) => {
        for (const [x, y, c] of list) editor.set(x, y, c);
      });
    },
  },

  'draw.line': {
    summary: 'Line from (x0, y0) to (x1, y1), including both ends. perfectAngle snaps to 0°, 45°, 90° and 2:1.',
    params: 'x0, y0, x1, y1, color?, size?, perfectAngle?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const x0 = int(p, 'x0');
      const y0 = int(p, 'y0');
      let x1 = int(p, 'x1');
      let y1 = int(p, 'y1');
      if (bool(p, 'perfectAngle', false)) [x1, y1] = snapToPerfectAngle(x0, y0, x1, y1);
      const offsets = brushOffsets(Math.max(1, int(p, 'size', 1)), 'square');
      return paint(p, (editor) =>
        line(x0, y0, x1, y1, (x, y) => {
          for (const [ox, oy] of offsets) editor.set(x + ox, y + oy, c);
        }),
      );
    },
  },

  'draw.rect': {
    summary:
      'Rectangle with its corner at (x, y), width w and height h. Outline by default; filled fills it. radius rounds the corners (fractions allowed).',
    params: 'x, y, w, h, color?, filled?, thickness?, radius?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const x = int(p, 'x');
      const y = int(p, 'y');
      const w = int(p, 'w');
      const h = int(p, 'h');
      if (w < 1 || h < 1) fail('w and h must be at least 1');
      const radius = num(p, 'radius', 0);
      if (radius < 0) fail('radius cannot be negative');
      return paint(p, (editor) =>
        rectCells(
          x,
          y,
          x + w - 1,
          y + h - 1,
          bool(p, 'filled', false),
          Math.max(1, int(p, 'thickness', 1)),
          (px, py) => editor.set(px, py, c),
          radius,
        ),
      );
    },
  },

  'draw.ellipse': {
    summary: 'Ellipse or circle inside the box (x, y, w, h). Clean 1 px outline by default; filled fills it.',
    params: 'x, y, w, h, color?, filled?, thickness?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const w = int(p, 'w');
      const h = int(p, 'h');
      if (w < 1 || h < 1) fail('w and h must be at least 1');
      return paint(p, (editor) =>
        ellipseCells(int(p, 'x'), int(p, 'y'), w, h, bool(p, 'filled', false), Math.max(1, int(p, 'thickness', 1)), (px, py) =>
          editor.set(px, py, c),
        ),
      );
    },
  },

  'draw.fill': {
    summary: 'Paint bucket from (x, y). contiguous false replaces the same color across the layer.',
    params: 'x, y, color?, contiguous?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const x = int(p, 'x');
      const y = int(p, 'y');
      return paint(p, (editor, width, height) => {
        for (const i of floodFill(editor.cel, width, height, x, y, bool(p, 'contiguous', true))) editor.setIndex(i, c);
      });
    },
  },

  'draw.pattern': {
    summary:
      'Stamps a text drawing with its corner at (x, y). Each character in rows becomes its legend color; "." and space are skipped.',
    params: 'x, y, rows: string[], legend: {character: color}, onlyOn?, layer?, frame?',
    run: (p) => {
      if (!Array.isArray(p.rows) || p.rows.some((r) => typeof r !== 'string')) fail('rows must be a list of strings');
      const legend = p.legend;
      if (!legend || typeof legend !== 'object' || Array.isArray(legend)) fail('legend must be an object {character: color}');
      const colors = new Map<string, number>();
      for (const [k, v] of Object.entries(legend as Record<string, unknown>)) {
        if ([...k].length !== 1) fail(`legend keys must be one character, got "${k}"`);
        colors.set(k, colorValue(v, `legend["${k}"]`));
      }
      const x0 = int(p, 'x', 0);
      const y0 = int(p, 'y', 0);
      const rows = p.rows as string[];
      for (const row of rows) {
        for (const ch of row) {
          if (ch !== '.' && ch !== ' ' && !colors.has(ch)) fail(`the character "${ch}" appears in rows but is not in the legend`);
        }
      }
      return paint(p, (editor) =>
        rows.forEach((row, dy) =>
          [...row].forEach((ch, dx) => {
            const c = colors.get(ch);
            if (c !== undefined) editor.set(x0 + dx, y0 + dy, c);
          }),
        ),
      );
    },
  },

  'draw.polygon': {
    summary:
      'Polygon through the points [[x, y], ...] (fractions allowed), or regular with cx, cy, radius, sides and rotation in degrees (default -90: vertex on top). Filled by default.',
    params: 'points? | cx, cy, radius, sides, rotation?; color?, filled?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      let points: Point[];
      if (has(p, 'points')) {
        if (!Array.isArray(p.points) || p.points.length < 2) fail('points must have at least 2 points [x, y]');
        points = p.points.map((pt, i) => {
          if (!Array.isArray(pt) || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') fail(`points[${i}] must be [x, y]`);
          return [pt[0], pt[1]] as const;
        });
      } else {
        const sides = int(p, 'sides');
        if (sides < 3 || sides > 64) fail('sides must be between 3 and 64');
        points = regularPolygonPoints(num(p, 'cx'), num(p, 'cy'), num(p, 'radius'), sides, num(p, 'rotation', -90));
      }
      return paint(p, (editor) => polygonCells(points, bool(p, 'filled', true), (x, y) => editor.set(x, y, c)));
    },
  },

  'draw.star': {
    summary:
      'Star centered at (cx, cy); use a half pixel (15.5) to center it on an even-sized image. With light and dark, each facet gets a tone from the light direction (lightAngle in degrees, default -135: from the top left), like a bevel.',
    params: 'cx, cy, outer, inner?, points?, rotation?, color?, light?, dark?, lightAngle?, onlyOn?, layer?, frame?',
    run: (p) => {
      const base = color(p);
      const tips = int(p, 'points', 5);
      if (tips < 3 || tips > 24) fail('points must be between 3 and 24');
      const outer = num(p, 'outer');
      if (outer <= 0) fail('outer must be greater than zero');
      const inner = num(p, 'inner', outer * 0.42);
      const rotation = num(p, 'rotation', -90);
      const light = has(p, 'light') ? colorValue(p.light, 'light') : base;
      const dark = has(p, 'dark') ? colorValue(p.dark, 'dark') : base;
      const toward = (num(p, 'lightAngle', -135) * Math.PI) / 180;
      const step = 180 / tips;
      return paint(p, (editor) =>
        starCells(num(p, 'cx'), num(p, 'cy'), outer, inner, tips, rotation, (x, y, facet) => {
          const facing = Math.cos(((rotation + step * (facet + 0.5)) * Math.PI) / 180 - toward);
          editor.set(x, y, facing > 0.3 ? light : facing < -0.6 ? dark : base);
        }),
      );
    },
  },

  'draw.burst': {
    summary:
      'Firework burst: straight rays from inner to outer around (cx, cy). colors goes from the center to the tip (gradient). dash [on, off] in pixels dashes the rays; alternate (0 to 1) shortens the odd rays.',
    params: 'cx, cy, outer, inner?, rays?, rotation?, colors?: string[], color?, dash?: [on, off], alternate?, onlyOn?, layer?, frame?',
    run: (p) => {
      const outer = num(p, 'outer');
      const inner = num(p, 'inner', 0);
      if (outer <= inner) fail('outer must be greater than inner');
      const rays = int(p, 'rays', 12);
      if (rays < 2 || rays > 96) fail('rays must be between 2 and 96');
      const colors = has(p, 'colors')
        ? (Array.isArray(p.colors) && p.colors.length > 0 ? p.colors : fail('colors must be a list of colors')).map((c, i) =>
            colorValue(c, `colors[${i}]`),
          )
        : [color(p)];
      let dash: [number, number] | null = null;
      if (has(p, 'dash')) {
        if (!Array.isArray(p.dash) || p.dash.length !== 2 || typeof p.dash[0] !== 'number' || typeof p.dash[1] !== 'number' || p.dash[0] <= 0) {
          fail('dash must be [on, off] in pixels, with on > 0');
        }
        dash = [p.dash[0], p.dash[1]];
      }
      const alternate = num(p, 'alternate', 1);
      if (alternate < 0 || alternate > 1) fail('alternate must be between 0 and 1');
      return paint(p, (editor) =>
        burstCells(num(p, 'cx'), num(p, 'cy'), inner, outer, rays, num(p, 'rotation', -90), dash, alternate, (x, y, t) =>
          editor.set(x, y, colors[Math.min(colors.length - 1, Math.floor(t * colors.length))]),
        ),
      );
    },
  },

  'effect.outline': {
    summary: 'Outlines what is drawn on the layer with a color. corners true includes the diagonals. allFrames true (or tag, from/to) outlines every frame.',
    params: 'color, corners?, layer?, frame?, allFrames?, tag?, from?, to?',
    run: (p) => {
      const c = requiredColor(p, 'color');
      const layer = targetLayer(p);
      return paintCels(p, effectFrames(p).map((frame) => ({ layer, frame })), (editor, _i, width, height) => {
        for (const i of outlineIndices(editor.cel, width, height, bool(p, 'corners', false))) editor.setIndex(i, c);
      });
    },
  },

  'effect.replaceColor': {
    summary: 'Replaces one color with another across the layer.',
    params: 'from, to, layer?, frame?',
    run: (p) => {
      const from = requiredColor(p, 'from');
      const to = requiredColor(p, 'to');
      return paint(p, (editor, width, height) => {
        const px = editor.cel;
        for (let i = 0; i < width * height; i++) if (sameColor(px[i], from)) editor.setIndex(i, to);
      });
    },
  },

  // Whole-cel effects. They work on the frame on screen (or frame); allFrames true, tag or from/to apply them to every frame in that stretch.

  'effect.posterize': {
    summary:
      'Forces the art into a palette: each pixel becomes the nearest color (the editor’s palette, palette or preset) and turns opaque; below half opacity it disappears. dither (0 to 1) breaks gradients into an ordered checker. scope: all (default), layer or frame. Good as a last step.',
    params: 'palette? | preset?, dither?, scope?, layer?, frame?',
    run: (p) => {
      const { doc } = useApp.getState();
      const palette = paletteParam(p);
      const dither = num(p, 'dither', 0);
      if (dither < 0 || dither > 1) fail('dither must be between 0 and 1');
      const cels = scopeCels(doc, colorScope(p), targetLayer(p).id, targetFrame(p).id).map(({ layer, frame }) => ({
        layer,
        frame: frameRef(frame),
      }));
      return paintCels({}, cels, (editor, _i, width) => writeAll(editor, posterize(editor.cel, width, palette, dither)));
    },
  },

  'effect.shade': {
    summary:
      'Light and shadow along the shape’s edge, like a bevel: pixels within size px of the edge facing the light get light, and those within darkSize px of the opposite edge get dark. angle is where the light comes from, in degrees (default -135: top left; 0 right, 90 down). on limits it to the shape of one color (default: everything painted).',
    params: 'light?, dark?, angle?, size?, darkSize?, on?, onlyOn?, layer?, frame?, allFrames?, tag?',
    run: (p) => {
      if (!has(p, 'light') && !has(p, 'dark')) fail('pass light, dark or both');
      const light = has(p, 'light') ? colorValue(p.light, 'light') : null;
      const dark = has(p, 'dark') ? colorValue(p.dark, 'dark') : null;
      const size = int(p, 'size', 1);
      const darkSize = int(p, 'darkSize', size);
      if (size < 0 || darkSize < 0 || size > 64 || darkSize > 64) fail('size and darkSize must be 0 to 64');
      const angle = num(p, 'angle', -135);
      const layer = targetLayer(p);
      return paintCels(p, effectFrames(p).map((frame) => ({ layer, frame })), (editor, _i, width, height) => {
        const sides = shadeSides(regionOf(p, editor.cel), width, height, angle, light === null ? 0 : size, dark === null ? 0 : darkSize);
        for (let i = 0; i < sides.length; i++) {
          if (sides[i] === 1) editor.setIndex(i, light!);
          else if (sides[i] === -1) editor.setIndex(i, dark!);
        }
      });
    },
  },

  'effect.bands': {
    summary:
      'Color bands by distance to the shape’s edge (SDF): colors go from the edge inward, each band width px wide. origin "center" counts from the core outward (inner glow). Pixels beyond the last band stay as they are. on limits it to the shape of one color.',
    params: 'colors: string[], width?, origin?: "edge" | "center", on?, onlyOn?, layer?, frame?, allFrames?, tag?',
    run: (p) => {
      const colors = colorList(p, 'colors');
      const band = num(p, 'width', 1);
      if (band <= 0) fail('width must be greater than zero');
      const origin = choice(p, 'origin', ['edge', 'center'] as const, 'edge');
      const layer = targetLayer(p);
      return paintCels(p, effectFrames(p).map((frame) => ({ layer, frame })), (editor, _i, width, height) => {
        const dist = edgeDistance(regionOf(p, editor.cel), width, height);
        let max = 0;
        for (const d of dist) if (d > max) max = d;
        for (let i = 0; i < dist.length; i++) {
          if (dist[i] <= 0) continue;
          const k = Math.floor(((origin === 'edge' ? dist[i] - 1 : max - dist[i]) + 1e-9) / band);
          if (k < colors.length) editor.setIndex(i, colors[k]);
        }
      });
    },
  },

  'effect.blobify': {
    summary:
      'Rounds and melts shapes together like goo: blurs radius px and cuts at threshold (0 to 1, default 0.5). Nearby shapes merge, corners round off, thin tips disappear. New pixels take the color of the nearest painted pixel.',
    params: 'radius, threshold?, layer?, frame?, allFrames?, tag?',
    run: (p) => {
      const radius = int(p, 'radius');
      if (radius < 1 || radius > 16) fail('radius must be 1 to 16');
      const threshold = num(p, 'threshold', 0.5);
      if (threshold <= 0 || threshold >= 1) fail('threshold must be between 0 and 1 (exclusive)');
      const layer = targetLayer(p);
      return paintCels({}, effectFrames(p).map((frame) => ({ layer, frame })), (editor, _i, width, height) =>
        writeAll(editor, blobify(editor.cel, width, height, radius, threshold)),
      );
    },
  },

  'effect.wave': {
    summary:
      'Ripples the layer: direction "vertical" moves each column up and down (ghost hem, water), "horizontal" shifts each row (flag, heat haze). amp in px, wavelength in px between crests, phase from 0 to 1. start is the row (or column) where the wave begins, growing over ramp px. animate true uses the base frame (frame, default the current one) as the source and animates the phase over every frame in the span (tag, from/to or all), cycles turns per loop; frames first creates frames up to that total.',
    params: 'direction?, amp, wavelength, phase?, start?, ramp?, layer?, frame?, animate?, cycles?, frames?, tag?, from?, to?',
    run: (p) =>
      actions.group(() => {
        const direction = choice<WaveDirection>(p, 'direction', ['vertical', 'horizontal'], 'vertical');
        const amp = num(p, 'amp');
        const wavelength = num(p, 'wavelength');
        if (wavelength <= 0) fail('wavelength must be greater than zero');
        const opts = { direction, amp, wavelength, phase: num(p, 'phase', 0), start: has(p, 'start') ? num(p, 'start') : undefined, ramp: num(p, 'ramp', 1) };
        const layer = targetLayer(p);
        if (!bool(p, 'animate', false)) {
          return paintCels({}, [{ layer, frame: targetFrame(p) }], (editor, _i, width, height) => writeAll(editor, wave(editor.cel, width, height, opts)));
        }
        const base = targetFrame(p);
        framesParam(p);
        const { doc } = useApp.getState();
        const source = celOf(doc, layer, base.id).slice();
        const span = frameSpan(p);
        const cycles = num(p, 'cycles', 1);
        return paintCels({}, span.map((frame) => ({ layer, frame })), (editor, i, width, height) =>
          writeAll(editor, wave(source, width, height, { ...opts, phase: opts.phase + (cycles * i) / span.length })),
        );
      }),
  },

  'effect.rotate': {
    summary:
      'Rotates the layer by angle degrees (positive = clockwise) around (cx, cy), default the image center. Each new pixel takes the majority color of its samples, so edges stay clean and no new colors appear (like RotSprite). Rotate before outlining: the outline comes out cleaner afterwards.',
    params: 'angle, cx?, cy?, layer?, frame?, allFrames?, tag?',
    run: (p) => {
      const angle = num(p, 'angle');
      const layer = targetLayer(p);
      return paintCels({}, effectFrames(p).map((frame) => ({ layer, frame })), (editor, _i, width, height) =>
        writeAll(editor, rotate(editor.cel, width, height, angle, num(p, 'cx', width / 2), num(p, 'cy', height / 2))),
      );
    },
  },

  'effect.clip': {
    summary:
      'Clipping mask: erases the layer’s pixels where layer by is empty (invert true: where by is painted). Keeps shading or highlights from spilling past the shape below. Uses the same frame on both layers.',
    params: 'by, invert?, layer?, frame?, allFrames?, tag?',
    run: (p) => {
      if (!has(p, 'by')) fail('the "by" parameter is required: the layer whose shape clips');
      const by = layerRef(p.by);
      const layer = targetLayer(p);
      if (by === layer) fail('by must be another layer');
      const invert = bool(p, 'invert', false);
      const { doc } = useApp.getState();
      const frames = effectFrames(p);
      return paintCels({}, frames.map((frame) => ({ layer, frame })), (editor, i) => {
        const shape = celOf(doc, by, frames[i].id);
        for (let k = 0; k < shape.length; k++) if (!!(shape[k] >>> 24) === invert && editor.cel[k]) editor.setIndex(k, 0);
      });
    },
  },

  // Animation helpers: motion computed per frame so loops close without a jump.

  'anim.oscillate': {
    summary:
      'Bobs a layer through the loop without redrawing: offsets the drawing in each frame of the span (tag, from/to or all) by amp px along a wave; where the layer is empty in a frame, it uses the span’s first frame (base fixes one frame as the source for all). axis "y" (default) or "x"; cycles turns per loop (a whole number closes the loop); phase from 0 to 1 delays the layer relative to the others (follow-through: face 0, accessory 0.1); shape sine, bounce (a one-sided hop) or square. frames first creates frames up to that total.',
    params: 'amp, axis?, cycles?, phase?, shape?, layer?, base?, frames?, tag?, from?, to?',
    run: (p) =>
      actions.group(() => {
        const amp = num(p, 'amp');
        const axis = choice(p, 'axis', ['y', 'x'] as const, 'y');
        const shape = choice<WaveShape>(p, 'shape', ['sine', 'bounce', 'square'], 'sine');
        const cycles = num(p, 'cycles', 1);
        const phase = num(p, 'phase', 0);
        const layer = targetLayer(p);
        framesParam(p);
        const span = frameSpan(p);
        if (span.length < 2) fail('the span needs at least 2 frames; pass frames to create them');
        const { doc } = useApp.getState();
        const painted = (cel: Uint32Array) => cel.some((c) => c >>> 24);
        const first = celOf(doc, layer, (has(p, 'base') ? frameRef(p.base) : span[0]).id).slice();
        if (!painted(first)) fail(`layer "${layer.name}" is empty in the base frame`);
        const sources = span.map((f) => {
          const cel = celOf(doc, layer, f.id);
          return has(p, 'base') || !painted(cel) ? first : cel.slice();
        });
        const offsets: number[] = [];
        const result = paintCels({}, span.map((frame) => ({ layer, frame })), (editor, i, width, height) => {
          const d = loopOffset(i, span.length, amp, cycles, phase, shape);
          offsets.push(d);
          writeAll(editor, shiftCel(sources[i], width, height, width, height, axis === 'x' ? d : 0, axis === 'y' ? d : 0));
        });
        return { ...result, layer: layer.name, offsets };
      }),
  },

  'draw.particles': {
    summary:
      'Particles floating in a loop (dust, sparkles, bubbles, snow) across every frame of the span: count dots are born at random moments inside the box x, y, w, h (default: the whole image), travel drift [dx, dy] px over their life, sway wobble px sideways and live for life (0 to 1) of the loop. colors go from birth to end. seed fixes the randomness. clear true erases the layer in those frames first. Use a layer just for them.',
    params: 'count, colors? | color?, seed?, x?, y?, w?, h?, drift?: [dx, dy], wobble?, life?, clear?, onlyOn?, layer?, frames?, tag?, from?, to?',
    run: (p) =>
      actions.group(() => {
        const count = int(p, 'count');
        if (count < 1 || count > 2000) fail('count must be 1 to 2000');
        const colors = has(p, 'colors') ? colorList(p, 'colors') : [color(p)];
        let drift: [number, number] = [0, -4];
        if (has(p, 'drift')) {
          if (!Array.isArray(p.drift) || p.drift.length !== 2 || p.drift.some((v) => typeof v !== 'number')) fail('drift must be [dx, dy]');
          drift = [p.drift[0] as number, p.drift[1] as number];
        }
        framesParam(p);
        const { doc } = useApp.getState();
        const opts = {
          count,
          seed: int(p, 'seed', 1),
          x: num(p, 'x', 0),
          y: num(p, 'y', 0),
          w: num(p, 'w', doc.width),
          h: num(p, 'h', doc.height),
          drift,
          wobble: num(p, 'wobble', 1),
          life: num(p, 'life', 1),
          colors: colors.length,
        };
        const clear = bool(p, 'clear', false);
        const span = frameSpan(p);
        const layer = targetLayer(p);
        return paintCels(p, span.map((frame) => ({ layer, frame })), (editor, i, width, height) => {
          if (clear) for (let k = 0; k < width * height; k++) editor.setIndex(k, 0);
          for (const dot of particlesAt(opts, i, span.length)) editor.set(dot.x, dot.y, colors[dot.color]);
        });
      }),
  },

  // History and view

  'history.undo': {
    summary: 'Undoes the last step.',
    params: '',
    run: () => {
      actions.undo();
      return { canUndo: useApp.getState().canUndo, canRedo: useApp.getState().canRedo };
    },
  },

  'history.redo': {
    summary: 'Redoes the last undone step.',
    params: '',
    run: () => {
      actions.redo();
      return { canUndo: useApp.getState().canUndo, canRedo: useApp.getState().canRedo };
    },
  },

  'tool.set': {
    summary: 'Chooses the active tool in the interface.',
    params: 'tool: pencil | eraser | line | rect | fill | eyedropper',
    run: (p) => {
      const tool = text(p, 'tool') as ToolId;
      if (!['pencil', 'eraser', 'line', 'rect', 'fill', 'eyedropper'].includes(tool)) fail(`unknown tool: ${tool}`);
      actions.setTool(tool);
      return { tool };
    },
  },

  'view.fit': {
    summary: 'Sets the zoom so the image fits the window.',
    params: '',
    readOnly: true,
    run: () => {
      actions.fitView();
      return { zoom: useApp.getState().view.zoom };
    },
  },

  'view.zoom': {
    summary: 'Zoom as a percentage, for example 800.',
    params: 'percent',
    readOnly: true,
    run: (p) => {
      const target = (num(p, 'percent') / 100) * useApp.getState().view.dpr;
      const level = ZOOM_LEVELS.reduce((best, z) => (Math.abs(z - target) < Math.abs(best - target) ? z : best));
      actions.zoomTo(level);
      return { zoom: level };
    },
  },

  'view.grid': {
    summary: 'Shows or hides the pixel grid.',
    params: 'on',
    readOnly: true,
    run: (p) => {
      if (useApp.getState().showGrid !== bool(p, 'on', true)) actions.toggleGrid();
      return { grid: useApp.getState().showGrid };
    },
  },

  'view.tile': {
    summary: 'Tile mode: shows the image repeated around itself (on screen only), to check that the edges meet.',
    params: 'on',
    readOnly: true,
    run: (p) => {
      if (useApp.getState().tileMode !== bool(p, 'on', true)) actions.toggleTileMode();
      return { tile: useApp.getState().tileMode };
    },
  },

  'view.isoGrid': {
    summary: '2:1 isometric grid (on screen only) with tiles size pixels wide and half as tall; size 0 hides it.',
    params: 'size',
    readOnly: true,
    run: (p) => {
      const size = int(p, 'size');
      if (size < 0 || size > 512 || size % 2 !== 0) fail('size must be even, 0 to 512 (0 hides it)');
      actions.setIsoGrid(size);
      return { isoGrid: useApp.getState().isoGrid };
    },
  },

  // Output. Files are written by the caller, so the app never needs file system access for scripts.

  'render.png': {
    summary: 'Base64 PNG of the visible image (or of one layer), scaled up by scale with no blurring.',
    params: 'scale?, layer?, frame?',
    readOnly: true,
    run: async (p) => {
      const { doc } = useApp.getState();
      const scale = int(p, 'scale', 1);
      if (scale < 1 || doc.width * scale > 8192 || doc.height * scale > 8192) fail('scale out of range (up to 8192 px per side)');
      const frame = targetFrame(p).id;
      const source = has(p, 'layer') ? celOf(doc, layerRef(p.layer), frame) : composite(doc, frame);
      const pixels = scaleNearest(source, doc.width, doc.height, scale);
      const png = await encodePng(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), doc.width * scale, doc.height * scale);
      return { png: toBase64(png), width: doc.width * scale, height: doc.height * scale };
    },
  },

  'render.sheet': {
    summary:
      'Sprite sheet as PNG (base64): the frames side by side (layout "row") or in a nearly square grid ("grid"). tag limits it to one tag.',
    params: 'scale?, layout?: "row" | "grid", tag?',
    readOnly: true,
    run: async (p) => {
      const { doc } = useApp.getState();
      const scale = int(p, 'scale', 1);
      const layout = text(p, 'layout', 'row');
      if (layout !== 'row' && layout !== 'grid') fail('layout must be "row" or "grid"');
      const range = exportRange(p);
      const { cols, rows } = sheetGrid(range ? range[1] - range[0] + 1 : doc.frames.length, layout);
      if (scale < 1 || cols * doc.width * scale > 16384 || rows * doc.height * scale > 16384) {
        fail('sheet too large (up to 16384 px per side); use a smaller scale or layout "grid"');
      }
      const sheet = renderSheet(doc, layout, scale, range);
      const png = await encodePng(new Uint8Array(sheet.pixels.buffer), sheet.width, sheet.height);
      return {
        png: toBase64(png),
        width: sheet.width,
        height: sheet.height,
        columns: sheet.cols,
        rows: sheet.rows,
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
        durations: sheet.durations,
      };
    },
  },

  'render.gif': {
    summary:
      'Animated GIF (base64) with the frames and their durations, looping forever. pingpong true plays back and forth; tag limits it to one tag. GIF holds up to 256 colors and either full transparency or none.',
    params: 'scale?, pingpong?, tag?',
    readOnly: true,
    run: (p) => {
      const { doc } = useApp.getState();
      const scale = int(p, 'scale', 1);
      if (scale < 1 || doc.width * scale > 4096 || doc.height * scale > 4096) fail('scale out of range (up to 4096 px per side)');
      const range = exportRange(p);
      const gif = renderGif(doc, { scale, pingpong: bool(p, 'pingpong', false), range });
      return {
        gif: toBase64(gif.bytes),
        width: doc.width * scale,
        height: doc.height * scale,
        frames: range ? range[1] - range[0] + 1 : doc.frames.length,
        colors: gif.colors,
        reduced: gif.reduced,
      };
    },
  },

  'project.serialize': {
    summary: 'Contents of the .pontilha file (layers, palette) for the caller to save.',
    params: '',
    readOnly: true,
    run: async () => {
      const s = useApp.getState();
      return { text: await serializeProject(s.doc, s.palette, s.activeLayerId, s.recipes), fileName: s.fileName };
    },
  },

  'project.markSaved': {
    summary: 'Reports that the script saved the project, with the file name.',
    params: 'fileName',
    readOnly: true,
    run: (p) => {
      useApp.setState({ dirty: false, fileName: text(p, 'fileName') });
      return { fileName: useApp.getState().fileName };
    },
  },

  'project.load': {
    summary: 'Opens the contents of a .pontilha file. Refuses if there are unsaved changes, unless discard is true.',
    params: 'text, fileName?, discard?',
    run: async (p) => {
      guardUnsaved(p);
      const project = await parseProject(text(p, 'text'));
      actions.loadDoc(project.doc, {
        activeLayerId: project.activeLayerId,
        palette: project.palette,
        recipes: project.recipes,
        fileName: text(p, 'fileName', 'project.pontilha'),
        filePath: null,
      });
      return inspect();
    },
  },

  'image.loadSheet': {
    summary:
      'Opens a PNG sprite sheet (base64) as a new animation: slices it into frameWidth × frameHeight frames, left to right and top to bottom, leaving out empty cells at the end. Same discard rule as doc.new.',
    params: 'png, frameWidth, frameHeight, duration?, fileName?, discard?',
    run: async (p) => {
      guardUnsaved(p);
      const image = await decodeImage(fromBase64(text(p, 'png')));
      const fw = int(p, 'frameWidth');
      const fh = int(p, 'frameHeight');
      checkSize(fw, fh);
      if (fw > image.width || fh > image.height) fail(`the ${fw} × ${fh} frame is larger than the ${image.width} × ${image.height} sheet`);
      const cells = sliceSheet(image.pixels, image.width, image.height, fw, fh);
      if (cells.length > MAX_FRAMES) fail(`the sheet would give ${cells.length} frames; the maximum is ${MAX_FRAMES}`);
      actions.loadDoc(docFromFrames(cells, fw, fh, clampDuration(num(p, 'duration', 100))), {
        fileName: text(p, 'fileName', 'sheet.pontilha'),
        filePath: null,
        dirty: true,
      });
      return inspect();
    },
  },

  'image.load': {
    summary: 'Opens a PNG (base64) as a new single-layer image. Same discard rule as doc.new.',
    params: 'png, fileName?, discard?',
    run: async (p) => {
      guardUnsaved(p);
      const image = await decodeImage(fromBase64(text(p, 'png')));
      checkSize(image.width, image.height);
      actions.loadDoc(
        createDoc(image.width, image.height, image.pixels),
        { fileName: text(p, 'fileName', 'image.pontilha'), filePath: null },
      );
      return inspect();
    },
  },

  // Recipes: record the commands that build a piece, then play them back, for instance in other colours.

  'recipe.start': {
    summary:
      'Starts recording a recipe: commands that change the image are kept in order (project.*, image.* and recipe.* are left out). Undo removes the last recorded step. Finish with recipe.stop.',
    params: 'name',
    readOnly: true,
    run: (p) => {
      const name = text(p, 'name').trim();
      if (!name) fail('name cannot be empty');
      if (recording) fail(`a recipe is already recording: "${recording.name}". Use recipe.stop first.`);
      recording = { name, steps: [], units: [], undone: [] };
      return { recording: name };
    },
  },

  'recipe.stop': {
    summary: 'Stops recording and stores the recipe in the project (replacing one with the same name). discard true throws it away.',
    params: 'discard?',
    run: (p) => {
      if (!recording) fail('no recipe is recording');
      const { name, steps } = recording;
      recording = null;
      if (bool(p, 'discard', false)) return { discarded: name };
      if (steps.length === 0) fail('the recipe has no steps; nothing was stored');
      useApp.setState((s) => ({ recipes: [...s.recipes.filter((r) => r.name !== name), { name, steps }], dirty: true }));
      return { saved: name, steps: steps.length };
    },
  },

  'recipe.list': {
    summary: 'Recipes stored in the project, with their steps. steps false shows only names and counts.',
    params: 'steps?',
    readOnly: true,
    run: (p) => {
      const full = bool(p, 'steps', true);
      return {
        recording: recording ? { name: recording.name, steps: recording.steps.length } : null,
        recipes: useApp.getState().recipes.map((r) => (full ? r : { name: r.name, steps: r.steps.length })),
      };
    },
  },

  'recipe.save': {
    summary:
      'Stores a hand-written recipe: steps is a list of {method, params}, as in a batch ({id, params}, the format of the recipe files in examples/, also works).',
    params: 'name, steps',
    run: (p) => {
      const name = text(p, 'name').trim();
      if (!name) fail('name cannot be empty');
      if (!Array.isArray(p.steps) || p.steps.length === 0) fail('steps must be a list of {method, params}');
      const steps = p.steps.map((st, i) => {
        const method = (st as Params | null)?.method ?? (st as Params | null)?.id;
        if (typeof method !== 'string' || !COMMANDS[method]) fail(`steps[${i}]: unknown command ${JSON.stringify(method)}`);
        if (NOT_RECORDED.some((prefix) => method.startsWith(prefix))) fail(`steps[${i}]: ${method} cannot be part of a recipe`);
        return { method, params: structuredClone(((st as Params).params ?? {}) as Record<string, unknown>) };
      });
      useApp.setState((s) => ({ recipes: [...s.recipes.filter((r) => r.name !== name), { name, steps }], dirty: true }));
      return { saved: name, steps: steps.length };
    },
  },

  'recipe.delete': {
    summary: 'Deletes a recipe from the project.',
    params: 'name',
    run: (p) => {
      const name = text(p, 'name');
      if (!useApp.getState().recipes.some((r) => r.name === name)) fail(`recipe not found: ${name}`);
      useApp.setState((s) => ({ recipes: s.recipes.filter((r) => r.name !== name), dirty: true }));
      return { deleted: name };
    },
  },

  'recipe.run': {
    summary:
      'Runs a recipe as one undo step. colors {"#old": "#new"} swaps colors in every parameter: the same piece in another palette. If the recipe starts with doc.new, it creates the image first (discard applies to it). If a step fails, nothing is applied.',
    params: 'name, colors?: {from: to}, discard?',
    run: async (p) => {
      const name = text(p, 'name');
      const recipe = useApp.getState().recipes.find((r) => r.name === name);
      if (!recipe) fail(`recipe not found: ${name}. Recipes: ${useApp.getState().recipes.map((r) => r.name).join(', ') || 'none'}`);
      const swap = new Map<number, string>();
      if (has(p, 'colors')) {
        if (typeof p.colors !== 'object' || Array.isArray(p.colors)) fail('colors must be an object {"#from": "#to"}');
        for (const [from, to] of Object.entries(p.colors as Record<string, unknown>)) {
          swap.set(colorValue(from, 'colors'), toHex(colorValue(to, `colors["${from}"]`)));
        }
      }
      const steps = recipe.steps.map((st) => ({ method: st.method, params: swapColors(st.params, swap) as Params }));
      replaying = true;
      try {
        let first = 0;
        if (steps[0]?.method === 'doc.new') {
          await runOne('doc.new', { ...steps[0].params, discard: bool(p, 'discard', false) });
          first = 1;
        }
        if (steps.slice(first).some((st) => st.method === 'doc.new')) fail('doc.new can only be the first step of a recipe');
        await actions.group(async () => {
          for (const [i, st] of steps.slice(first).entries()) {
            try {
              await runOne(st.method, st.params);
            } catch (err) {
              throw new CommandError(`step ${i + first + 1} (${st.method}): ${message(err)}. Nothing from the recipe was applied.`);
            }
          }
        });
      } finally {
        replaying = false;
      }
      return { ran: name, steps: steps.length, swapped: swap.size };
    },
  },
};

export type Reply = { ok: true; result: unknown } | { ok: false; error: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function runOne(method: unknown, params: unknown): Promise<unknown> {
  if (typeof method !== 'string') fail('method must be the name of a command');
  const command = COMMANDS[method];
  if (!command) fail(`unknown command: ${method}. Use commands.list to see the available ones.`);
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
    fail('params must be an object');
  }
  if (!command.readOnly) actions.notify(`Script: ${method}`);
  const result = await command.run((params ?? {}) as Params);
  if (!command.readOnly) record(method, (params ?? {}) as Params);
  return result;
}

/**
 * Entry point for the control port: runs one command, or a batch as a single
 * undo step that is rolled back entirely if any command in it fails.
 */
export async function execute(method: string, params: unknown): Promise<Reply> {
  try {
    if (method !== 'batch') return { ok: true, result: await recordUnit(method, () => runOne(method, params)) };

    const list = (params as Params | null)?.commands;
    if (!Array.isArray(list)) fail('batch needs commands: [{method, params}, ...]');
    const recorded = recording?.steps.length;
    const results = await recordUnit('batch', () => actions.group(async () => {
      const out: unknown[] = [];
      for (const [i, item] of list.entries()) {
        const m = (item as Params | null)?.method;
        if (m === 'batch' || (typeof m === 'string' && m.startsWith('history.'))) {
          fail(`command ${i + 1}: ${String(m)} cannot be used inside batch`);
        }
        try {
          out.push(await runOne(m, (item as Params | null)?.params));
        } catch (err) {
          if (recording && recorded !== undefined) recording.steps.length = recorded;
          throw new CommandError(`command ${i + 1} (${String(m)}): ${message(err)}. Nothing from the batch was applied.`);
        }
      }
      return out;
    }));
    return { ok: true, result: results };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
