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
    if (fallback === undefined) fail(`o parâmetro "${key}" é obrigatório`);
    return fallback;
  }
  const v = p[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`"${key}" precisa ser um número, recebi ${JSON.stringify(v)}`);
  return v;
}

const int = (p: Params, key: string, fallback?: number) => Math.round(num(p, key, fallback));

function bool(p: Params, key: string, fallback: boolean): boolean {
  if (!has(p, key)) return fallback;
  if (typeof p[key] !== 'boolean') fail(`"${key}" precisa ser true ou false`);
  return p[key] as boolean;
}

function text(p: Params, key: string, fallback?: string): string {
  if (!has(p, key)) {
    if (fallback === undefined) fail(`o parâmetro "${key}" é obrigatório`);
    return fallback;
  }
  if (typeof p[key] !== 'string') fail(`"${key}" precisa ser texto`);
  return p[key] as string;
}

function colorValue(value: unknown, key: string): number {
  if (value === null || value === 'transparent') return 0;
  if (typeof value !== 'string') fail(`"${key}" precisa ser uma cor como "#c93c4a" ou "transparent"`);
  const c = parseHex(value);
  if (c === null) fail(`cor inválida em "${key}": ${value}. Use #rrggbb, #rrggbbaa ou "transparent".`);
  return c;
}

function requiredColor(p: Params, key: string): number {
  if (p[key] === undefined) fail(`o parâmetro "${key}" é obrigatório`);
  return colorValue(p[key], key);
}

/** `color` param, defaulting to the current primary colour. */
function color(p: Params, key = 'color'): number {
  return p[key] === undefined ? useApp.getState().primary : colorValue(p[key], key);
}

function layerRef(ref: unknown): Layer {
  const { doc } = useApp.getState();
  const layer = doc.layers.find((l) => l.id === ref) ?? doc.layers.find((l) => l.name === ref);
  if (!layer) fail(`camada não encontrada: ${JSON.stringify(ref)}. Camadas: ${doc.layers.map((l) => l.name).join(', ')}`);
  return layer;
}

function frameRef(ref: unknown): Frame {
  const { doc } = useApp.getState();
  const frame =
    typeof ref === 'number' && Number.isInteger(ref) ? doc.frames[ref - 1] : doc.frames.find((f) => f.id === ref);
  if (!frame) fail(`quadro não encontrado: ${JSON.stringify(ref)}. Use o número (1 a ${doc.frames.length}) ou o id.`);
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
  if (!tag) fail(`trecho não encontrado: ${JSON.stringify(ref)}. Trechos: ${doc.tags.map((t) => t.name).join(', ') || 'nenhum'}`);
  return tag;
}

/** `tag` param as the frames to export, or every frame without it. */
function exportRange(p: Params): FrameRange | undefined {
  if (!has(p, 'tag')) return undefined;
  return tagRange(useApp.getState().doc, tagRef(p.tag)) ?? fail('esse trecho perdeu um dos quadros das pontas');
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
  if (scope !== 'all' && scope !== 'layer' && scope !== 'frame') fail('scope precisa ser "all", "layer" ou "frame"');
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
    if (b < a) fail('to precisa vir depois de from');
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
  if (count > MAX_FRAMES) fail(`o máximo é ${MAX_FRAMES} quadros`);
  while (useApp.getState().doc.frames.length < count) {
    const { doc } = useApp.getState();
    actions.selectFrame(doc.frames[doc.frames.length - 1].id);
    if (!actions.addFrame({ copy: true })) fail('não foi possível criar os quadros');
  }
}

/** `frames` param: grow the animation to that many frames first (copying the last one). */
function framesParam(p: Params) {
  if (!has(p, 'frames')) return;
  const n = int(p, 'frames');
  if (n < 1) fail('frames precisa ser pelo menos 1');
  ensureFrames(n);
}

/** `palette` (list of colours) or `preset` (name), defaulting to the editor's palette. */
function paletteParam(p: Params): number[] {
  if (has(p, 'preset')) return presetRef(p.preset).colors;
  if (has(p, 'palette')) {
    if (!Array.isArray(p.palette) || p.palette.length === 0) fail('palette precisa ser uma lista de cores');
    return p.palette.map((c, i) => colorValue(c, `palette[${i}]`)).filter((c) => c >>> 24);
  }
  const { palette } = useApp.getState();
  if (palette.length === 0) fail('a paleta está vazia; passe palette ou preset');
  return palette;
}

function presetRef(name: unknown) {
  const preset = typeof name === 'string' ? PRESETS[name.toLowerCase()] : undefined;
  if (!preset) fail(`paleta desconhecida: ${JSON.stringify(name)}. Conhecidas: ${Object.keys(PRESETS).join(', ')}`);
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
  if (!Array.isArray(list) || list.length === 0) fail(`${key} precisa ser uma lista de cores`);
  return list.map((c, i) => colorValue(c, `${key}[${i}]`));
}

function choice<T extends string>(p: Params, key: string, options: readonly T[], fallback: T): T {
  const v = text(p, key, fallback);
  if (!options.includes(v as T)) fail(`${key} precisa ser um de: ${options.join(', ')}`);
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
    fail('a imagem aberta tem alterações não salvas. Salve antes ou passe discard: true para descartá-las.');
  }
}

function checkSize(width: number, height: number) {
  if (width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) {
    fail(`tamanho ${width} × ${height} fora do limite de 1 a ${MAX_SIZE} px`);
  }
}

const ASCII_KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const COMMANDS: Record<string, Command> = {
  'app.info': {
    summary: 'Versão do app e nomes dos comandos.',
    params: '',
    readOnly: true,
    run: () => ({ app: 'pontilha', version: VERSION, commands: Object.keys(COMMANDS).concat('batch') }),
  },

  'commands.list': {
    summary: 'Lista os comandos com parâmetros. filter procura no nome e na descrição.',
    params: 'filter?',
    readOnly: true,
    run: (p) => {
      const filter = text(p, 'filter', '').toLowerCase();
      return Object.entries(COMMANDS)
        .filter(([id, c]) => !filter || id.includes(filter) || c.summary.toLowerCase().includes(filter))
        .map(([id, c]) => ({ id, params: c.params, summary: c.summary }))
        .concat(
          !filter || 'batch'.includes(filter)
            ? [{ id: 'batch', params: 'commands: [{method, params}], label?', summary: 'Executa vários comandos como um único passo de desfazer. Se um falhar, nada é aplicado.' }]
            : [],
        );
    },
  },

  // Document

  'doc.inspect': {
    summary: 'Tamanho, camadas (a de cima primeiro), cores, paleta e estado do histórico.',
    params: '',
    readOnly: true,
    run: inspect,
  },

  'doc.new': {
    summary: 'Cria uma imagem vazia. Recusa se houver alterações não salvas, a menos que discard seja true.',
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
    summary: 'Desenha a imagem (ou uma camada) como texto: uma letra por cor, ponto para transparente.',
    params: 'layer?, frame?, x?, y?, w?, h?',
    readOnly: true,
    run: (p) => {
      const { doc } = useApp.getState();
      const x0 = int(p, 'x', 0);
      const y0 = int(p, 'y', 0);
      const w = Math.min(int(p, 'w', doc.width - x0), doc.width - x0);
      const h = Math.min(int(p, 'h', doc.height - y0), doc.height - y0);
      if (w * h > 128 * 128) fail('região grande demais para texto; peça no máximo 128 × 128 com x, y, w, h');
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
    summary: 'Cria uma camada acima da ativa e a torna ativa.',
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
    summary: 'Cria uma camada com uma imagem PNG (base64), posicionada em x, y. Útil para referências a 50%.',
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
        name: has(p, 'name') ? text(p, 'name') : 'Referência',
        opacity: num(p, 'opacity', 1),
        visible: bool(p, 'visible', true),
        pixels,
      });
      return { ...layerInfo(layer, useApp.getState().doc.layers.indexOf(layer)), imageWidth: image.width, imageHeight: image.height };
    },
  },

  'layer.select': {
    summary: 'Torna ativa a camada indicada por nome ou id.',
    params: 'layer',
    run: (p) => {
      if (!has(p, 'layer')) fail('o parâmetro "layer" é obrigatório');
      const layer = layerRef(p.layer);
      actions.setActiveLayer(layer.id);
      return { active: layer.name };
    },
  },

  'layer.setProps': {
    summary: 'Muda nome, opacidade (0 a 1) ou visibilidade de uma camada.',
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
    summary: 'Exclui uma camada (a imagem mantém pelo menos uma).',
    params: 'layer?',
    run: (p) => {
      const layer = targetLayer(p);
      if (useApp.getState().doc.layers.length === 1) fail('a imagem precisa de pelo menos uma camada');
      actions.setActiveLayer(layer.id);
      actions.deleteLayer();
      return { deleted: layer.name, active: activeLayer().name };
    },
  },

  'layer.duplicate': {
    summary: 'Duplica uma camada logo acima dela.',
    params: 'layer?',
    run: (p) => {
      actions.setActiveLayer(targetLayer(p).id);
      actions.duplicateLayer();
      const copy = activeLayer();
      return layerInfo(copy, useApp.getState().doc.layers.indexOf(copy));
    },
  },

  'layer.move': {
    summary: 'Sobe ou desce uma camada uma posição.',
    params: 'layer?, direction: "up" | "down"',
    run: (p) => {
      const direction = text(p, 'direction');
      if (direction !== 'up' && direction !== 'down') fail('direction precisa ser "up" ou "down"');
      const layer = targetLayer(p);
      actions.setActiveLayer(layer.id);
      actions.moveLayer(direction === 'up' ? 1 : -1);
      return { layer: layer.name, index: useApp.getState().doc.layers.indexOf(layer) };
    },
  },

  'layer.mergeDown': {
    summary: 'Mescla uma camada visível com a de baixo.',
    params: 'layer?',
    run: (p) => {
      const layer = targetLayer(p);
      const { doc } = useApp.getState();
      if (doc.layers.indexOf(layer) === 0) fail('não há camada abaixo para mesclar');
      if (!layer.visible) fail('mostre a camada antes de mesclar');
      actions.setActiveLayer(layer.id);
      actions.mergeDown();
      return { active: activeLayer().name };
    },
  },

  'layer.clear': {
    summary: 'Apaga todos os pixels de uma camada no quadro atual (ou em frame).',
    params: 'layer?, frame?',
    run: (p) =>
      paint(p, (editor, width, height) => {
        for (let i = 0; i < width * height; i++) editor.setIndex(i, 0);
      }),
  },

  // Frames. Every layer has an image in every frame; draw commands paint on the frame on screen unless given frame.

  'frame.new': {
    summary: 'Cria um quadro logo depois do atual e passa a mostrá-lo. copy true copia o quadro atual; sem copy ele começa vazio.',
    params: 'copy?, duration?',
    run: (p) => {
      const frame = actions.addFrame({ copy: bool(p, 'copy', false), duration: has(p, 'duration') ? num(p, 'duration') : undefined });
      if (!frame) fail('a animação já tem o máximo de quadros');
      const { doc } = useApp.getState();
      return frameInfo(frame, frameIndex(doc, frame.id));
    },
  },

  'frame.select': {
    summary: 'Mostra outro quadro: os desenhos seguintes vão para ele.',
    params: 'frame',
    run: (p) => {
      if (!has(p, 'frame')) fail('o parâmetro "frame" é obrigatório');
      const frame = frameRef(p.frame);
      actions.selectFrame(frame.id);
      return frameInfo(frame, frameIndex(useApp.getState().doc, frame.id));
    },
  },

  'frame.delete': {
    summary: 'Exclui um quadro, o atual se frame não for dado (a animação mantém pelo menos um).',
    params: 'frame?',
    run: (p) => {
      const frame = targetFrame(p);
      if (useApp.getState().doc.frames.length === 1) fail('a animação precisa de pelo menos um quadro');
      actions.deleteFrame(frame.id);
      const { doc } = useApp.getState();
      return { deleted: frame.id, frame: frameIndex(doc) + 1, frames: doc.frames.length };
    },
  },

  'frame.move': {
    summary: 'Leva um quadro para a posição to (1 = primeiro).',
    params: 'frame?, to',
    run: (p) => {
      const frame = targetFrame(p);
      actions.moveFrame(frame.id, int(p, 'to') - 1);
      return frameInfo(frame, frameIndex(useApp.getState().doc, frame.id));
    },
  },

  'frame.setDuration': {
    summary: 'Quanto tempo um quadro fica na tela, em milissegundos (10 a 60000). all true muda todos os quadros.',
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
      'Muda o tamanho da tela sem esticar a arte. anchor diz onde a imagem atual fica: center (padrão), top-left, top, top-right, left, right, bottom-left, bottom ou bottom-right. Encolher corta o que não cabe.',
    params: 'width, height, anchor?',
    run: (p) => {
      const width = int(p, 'width');
      const height = int(p, 'height');
      checkSize(width, height);
      const anchor = text(p, 'anchor', 'center') as Anchor;
      if (!ANCHORS.includes(anchor)) fail(`anchor precisa ser um de: ${ANCHORS.join(', ')}`);
      actions.resizeCanvas(width, height, anchor);
      return inspect();
    },
  },

  'canvas.crop': {
    summary: 'Recorta a imagem no retângulo x, y, w, h (sem eles, na seleção).',
    params: 'x?, y?, w?, h?',
    run: (p) => {
      const rect =
        has(p, 'w') || has(p, 'h')
          ? { x: int(p, 'x', 0), y: int(p, 'y', 0), w: int(p, 'w'), h: int(p, 'h') }
          : useApp.getState().selection;
      if (!rect) fail('passe x, y, w, h ou selecione a área antes');
      if (rect.w < 1 || rect.h < 1) fail('w e h precisam ser pelo menos 1');
      const { doc } = useApp.getState();
      if (rect.x >= doc.width || rect.y >= doc.height || rect.x + rect.w <= 0 || rect.y + rect.h <= 0) {
        fail('o retângulo fica fora da imagem');
      }
      actions.cropTo(rect);
      return inspect();
    },
  },

  'canvas.trim': {
    summary: 'Corta as bordas vazias, deixando só o que está pintado em alguma camada ou quadro.',
    params: '',
    run: () => {
      const bounds = contentBounds(useApp.getState().doc);
      if (!bounds) fail('a imagem está vazia');
      actions.cropTo(bounds);
      return { ...inspect(), kept: bounds };
    },
  },

  'canvas.scale': {
    summary: 'Amplia a arte: cada pixel vira um bloco factor × factor (2 a 16), sem borrar.',
    params: 'factor',
    run: (p) => {
      const factor = int(p, 'factor');
      if (factor < 2 || factor > 16) fail('factor precisa ser de 2 a 16');
      const { doc } = useApp.getState();
      checkSize(doc.width * factor, doc.height * factor);
      actions.scaleImage(factor);
      return inspect();
    },
  },

  // Selection. Without a selection, move, flip, rotate, copy and cut act on the whole layer.

  'select.rect': {
    summary: 'Seleciona um retângulo (cortado nas bordas da imagem). add true soma à seleção atual.',
    params: 'x, y, w, h, add?',
    run: (p) => {
      const w = int(p, 'w');
      const h = int(p, 'h');
      if (w < 1 || h < 1) fail('w e h precisam ser pelo menos 1');
      const before = useApp.getState().selection;
      actions.select({ x: int(p, 'x'), y: int(p, 'y'), w, h }, bool(p, 'add', false));
      const { selection } = useApp.getState();
      if (!selection || selection === before) fail('o retângulo fica fora da imagem');
      return { selection: selectionInfo(selection) };
    },
  },

  'select.color': {
    summary:
      'Varinha mágica: seleciona os pixels da cor em (x, y), só a área conectada a ele (padrão) ou com contiguous false a mesma cor na camada toda. add true soma à seleção atual. Lê a camada e o quadro indicados.',
    params: 'x, y, contiguous?, add?, layer?, frame?',
    run: (p) => {
      const { doc } = useApp.getState();
      const x = int(p, 'x');
      const y = int(p, 'y');
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) fail(`(${x}, ${y}) fica fora da imagem`);
      const selection = actions.selectColor(x, y, { contiguous: bool(p, 'contiguous', true), add: bool(p, 'add', false) }, selectionTarget(p));
      return { selection: selectionInfo(selection) };
    },
  },

  'select.all': {
    summary: 'Seleciona a imagem inteira.',
    params: '',
    run: () => {
      actions.selectAll();
      return { selection: currentSelection() };
    },
  },

  'select.none': {
    summary: 'Desfaz a seleção.',
    params: '',
    run: () => {
      actions.select(null);
      return { selection: null };
    },
  },

  'selection.move': {
    summary: 'Move os pixels selecionados (e a seleção) dx, dy pixels. O que sair da imagem se perde.',
    params: 'dx, dy, layer?, frame?',
    run: (p) => {
      actions.moveSelection(int(p, 'dx', 0), int(p, 'dy', 0), selectionTarget(p));
      return { selection: currentSelection() };
    },
  },

  'selection.flip': {
    summary: 'Espelha os pixels selecionados.',
    params: 'axis: "horizontal" | "vertical", layer?, frame?',
    run: (p) => {
      const axis = text(p, 'axis');
      if (axis !== 'horizontal' && axis !== 'vertical') fail('axis precisa ser "horizontal" ou "vertical"');
      actions.flipSelection(axis, selectionTarget(p));
      return { selection: currentSelection() };
    },
  },

  'selection.rotate': {
    summary: 'Gira os pixels selecionados 90° em torno do centro da seleção. Sem seleção, só em imagens quadradas.',
    params: 'direction: "cw" | "ccw", layer?, frame?',
    run: (p) => {
      const direction = text(p, 'direction');
      if (direction !== 'cw' && direction !== 'ccw') fail('direction precisa ser "cw" (horário) ou "ccw" (anti-horário)');
      if (!actions.rotateSelection(direction, selectionTarget(p))) fail('a imagem não é quadrada; selecione a área a girar');
      return { selection: currentSelection() };
    },
  },

  'selection.clear': {
    summary: 'Apaga os pixels selecionados.',
    params: 'layer?, frame?',
    run: (p) => {
      if (!useApp.getState().selection) fail('nada selecionado; use select.rect antes, ou layer.clear para a camada toda');
      actions.clearSelection(selectionTarget(p));
      return { selection: currentSelection() };
    },
  },

  'clipboard.copy': {
    summary: 'Copia os pixels selecionados de uma camada e quadro.',
    params: 'layer?, frame?',
    readOnly: true,
    run: (p) => ({ copied: selectionInfo(actions.copy(selectionTarget(p)).rect) }),
  },

  'clipboard.cut': {
    summary: 'Copia e apaga os pixels selecionados.',
    params: 'layer?, frame?',
    run: (p) => ({ copied: selectionInfo(actions.cut(selectionTarget(p)).rect) }),
  },

  'clipboard.paste': {
    summary:
      'Cola o que foi copiado no mesmo lugar de onde saiu (ou com o canto em x, y) e seleciona. Pixels transparentes não cobrem o que está embaixo. Útil para levar uma parte para outro quadro.',
    params: 'x?, y?, layer?, frame?',
    run: (p) => {
      if (!useApp.getState().clipboard) fail('nada copiado ainda; use clipboard.copy antes');
      const at = { x: has(p, 'x') ? int(p, 'x') : undefined, y: has(p, 'y') ? int(p, 'y') : undefined };
      return { selection: selectionInfo(actions.paste(at, selectionTarget(p))) };
    },
  },

  // Tags: named stretches of frames, for playback and export.

  'tag.add': {
    summary: 'Dá nome a um trecho da animação, do quadro from ao to (números a partir de 1, ou ids; os dois entram).',
    params: 'name, from, to',
    run: (p) => {
      const name = text(p, 'name').trim();
      if (!name) fail('name não pode ser vazio');
      if (useApp.getState().doc.tags.some((t) => t.name === name)) fail(`já existe um trecho chamado "${name}"`);
      if (!has(p, 'from') || !has(p, 'to')) fail('from e to são obrigatórios');
      return tagInfo(actions.addTag(name, frameRef(p.from).id, frameRef(p.to).id));
    },
  },

  'tag.delete': {
    summary: 'Apaga um trecho (por nome ou id). Os quadros continuam.',
    params: 'tag',
    run: (p) => {
      if (!has(p, 'tag')) fail('o parâmetro "tag" é obrigatório');
      const tag = tagRef(p.tag);
      actions.deleteTag(tag.id);
      return { deleted: tag.name, tags: useApp.getState().doc.tags.map(tagInfo) };
    },
  },

  // Colours

  'color.set': {
    summary: 'Define a cor principal e/ou secundária, usadas quando um desenho não informa color.',
    params: 'primary?, secondary?',
    run: (p) => {
      if (has(p, 'primary')) actions.setPrimary(colorValue(p.primary, 'primary'));
      if (has(p, 'secondary')) actions.setSecondary(colorValue(p.secondary, 'secondary'));
      const s = useApp.getState();
      return { primary: toHex(s.primary), secondary: toHex(s.secondary) };
    },
  },

  'palette.set': {
    summary: 'Troca a paleta inteira.',
    params: 'colors: string[]',
    run: (p) => {
      if (!Array.isArray(p.colors) || p.colors.length === 0) fail('colors precisa ser uma lista de cores');
      const colors = [...new Set(p.colors.map((c, i) => colorValue(c, `colors[${i}]`)))].filter((c) => c >>> 24);
      useApp.setState({ palette: colors, dirty: true });
      return { palette: colors.map(toHex) };
    },
  },

  'palette.add': {
    summary: 'Acrescenta uma cor à paleta.',
    params: 'color',
    run: (p) => {
      const c = requiredColor(p, 'color');
      if (!useApp.getState().palette.includes(c)) useApp.setState((s) => ({ palette: [...s.palette, c], dirty: true }));
      return { palette: useApp.getState().palette.map(toHex) };
    },
  },

  'palette.ramp': {
    summary:
      'Rampa de cores em volta de color (padrão: a principal), da mais escura à mais clara: sombras mais escuras, saturadas e puxando para o azul; luzes mais claras, menos saturadas e puxando para o amarelo. shift é o giro de matiz por passo, em graus. add false só calcula.',
    params: 'color?, steps?, shift?, add?',
    run: (p) => {
      const steps = int(p, 'steps', 5);
      if (steps < 2 || steps > 12) fail('steps precisa ser de 2 a 12');
      const shift = num(p, 'shift', 12);
      if (shift < 0 || shift > 45) fail('shift precisa ser de 0 a 45 graus');
      const ramp = hueShiftRamp(color(p), steps, shift);
      const added = bool(p, 'add', true) ? actions.addColors(ramp) : 0;
      return { ramp: ramp.map(toHex), added };
    },
  },

  'palette.preset': {
    summary: `Troca a paleta por uma conhecida: ${Object.keys(PRESETS).join(', ')}. add true acrescenta em vez de trocar.`,
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
      'Confere se a arte usa só cores da paleta (a do editor, palette ou preset). Lista as cores de fora e quantos pixels usam cada uma; semitransparentes também contam como fora.',
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
    summary: 'Cores pintadas e quantos pixels usam cada uma, da mais usada para a menos. scope: all (padrão), layer (a camada em todos os quadros) ou frame (o quadro em todas as camadas).',
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
      'Troca uma cor por outra em todas as camadas e quadros, num passo de desfazer. scope layer limita à camada (todos os quadros); frame, ao quadro (todas as camadas). Bom para recolorir uma animação inteira.',
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
    summary: 'Pinta pixels soltos. Cada item é [x, y] ou [x, y, cor]; "transparent" apaga.',
    params: 'pixels: [[x, y, color?], ...], color?, onlyOn?, layer?, frame?',
    run: (p) => {
      if (!Array.isArray(p.pixels)) fail('pixels precisa ser uma lista de [x, y] ou [x, y, cor]');
      const fallback = color(p);
      const list = p.pixels.map((item, i) => {
        if (!Array.isArray(item) || item.length < 2) fail(`pixels[${i}] precisa ser [x, y] ou [x, y, cor]`);
        const [x, y, c] = item;
        if (typeof x !== 'number' || typeof y !== 'number') fail(`pixels[${i}] precisa ter x e y numéricos`);
        return [Math.round(x), Math.round(y), c === undefined ? fallback : colorValue(c, `pixels[${i}][2]`)] as const;
      });
      return paint(p, (editor) => {
        for (const [x, y, c] of list) editor.set(x, y, c);
      });
    },
  },

  'draw.line': {
    summary: 'Linha de (x0, y0) a (x1, y1), incluindo as pontas. perfectAngle trava em 0°, 45°, 90° e 2:1.',
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
      'Retângulo com canto em (x, y), largura w e altura h. Contorno por padrão; filled preenche. radius arredonda os cantos (frações valem).',
    params: 'x, y, w, h, color?, filled?, thickness?, radius?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const x = int(p, 'x');
      const y = int(p, 'y');
      const w = int(p, 'w');
      const h = int(p, 'h');
      if (w < 1 || h < 1) fail('w e h precisam ser pelo menos 1');
      const radius = num(p, 'radius', 0);
      if (radius < 0) fail('radius não pode ser negativo');
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
    summary: 'Elipse ou círculo dentro da caixa (x, y, w, h). Contorno limpo de 1 px por padrão; filled preenche.',
    params: 'x, y, w, h, color?, filled?, thickness?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const w = int(p, 'w');
      const h = int(p, 'h');
      if (w < 1 || h < 1) fail('w e h precisam ser pelo menos 1');
      return paint(p, (editor) =>
        ellipseCells(int(p, 'x'), int(p, 'y'), w, h, bool(p, 'filled', false), Math.max(1, int(p, 'thickness', 1)), (px, py) =>
          editor.set(px, py, c),
        ),
      );
    },
  },

  'draw.fill': {
    summary: 'Balde de tinta a partir de (x, y). contiguous false troca a mesma cor na camada toda.',
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
      'Carimba um desenho em texto com o canto em (x, y). Cada caractere de rows vira a cor do legend; "." e espaço são pulados.',
    params: 'x, y, rows: string[], legend: {caractere: cor}, onlyOn?, layer?, frame?',
    run: (p) => {
      if (!Array.isArray(p.rows) || p.rows.some((r) => typeof r !== 'string')) fail('rows precisa ser uma lista de textos');
      const legend = p.legend;
      if (!legend || typeof legend !== 'object' || Array.isArray(legend)) fail('legend precisa ser um objeto {caractere: cor}');
      const colors = new Map<string, number>();
      for (const [k, v] of Object.entries(legend as Record<string, unknown>)) {
        if ([...k].length !== 1) fail(`as chaves do legend precisam ter um caractere, recebi "${k}"`);
        colors.set(k, colorValue(v, `legend["${k}"]`));
      }
      const x0 = int(p, 'x', 0);
      const y0 = int(p, 'y', 0);
      const rows = p.rows as string[];
      for (const row of rows) {
        for (const ch of row) {
          if (ch !== '.' && ch !== ' ' && !colors.has(ch)) fail(`o caractere "${ch}" aparece em rows mas não está no legend`);
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
      'Polígono pelos pontos [[x, y], ...] (frações valem) ou regular com cx, cy, radius, sides e rotation em graus (padrão -90: vértice em cima). Preenchido por padrão.',
    params: 'points? | cx, cy, radius, sides, rotation?; color?, filled?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      let points: Point[];
      if (has(p, 'points')) {
        if (!Array.isArray(p.points) || p.points.length < 2) fail('points precisa ter pelo menos 2 pontos [x, y]');
        points = p.points.map((pt, i) => {
          if (!Array.isArray(pt) || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') fail(`points[${i}] precisa ser [x, y]`);
          return [pt[0], pt[1]] as const;
        });
      } else {
        const sides = int(p, 'sides');
        if (sides < 3 || sides > 64) fail('sides precisa estar entre 3 e 64');
        points = regularPolygonPoints(num(p, 'cx'), num(p, 'cy'), num(p, 'radius'), sides, num(p, 'rotation', -90));
      }
      return paint(p, (editor) => polygonCells(points, bool(p, 'filled', true), (x, y) => editor.set(x, y, c)));
    },
  },

  'draw.star': {
    summary:
      'Estrela centrada em (cx, cy); use meio pixel (15.5) para centralizar numa imagem de lado par. Com light e dark, cada faceta recebe um tom pela direção da luz (lightAngle em graus, padrão -135: de cima à esquerda), como um chanfro.',
    params: 'cx, cy, outer, inner?, points?, rotation?, color?, light?, dark?, lightAngle?, onlyOn?, layer?, frame?',
    run: (p) => {
      const base = color(p);
      const tips = int(p, 'points', 5);
      if (tips < 3 || tips > 24) fail('points precisa estar entre 3 e 24');
      const outer = num(p, 'outer');
      if (outer <= 0) fail('outer precisa ser maior que zero');
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
      'Estouro de fogos: raios retos de inner a outer a partir de (cx, cy). colors vai do centro à ponta (gradiente). dash [aceso, apagado] em pixels tracejam os raios; alternate (0 a 1) encurta os raios ímpares.',
    params: 'cx, cy, outer, inner?, rays?, rotation?, colors?: string[], color?, dash?: [on, off], alternate?, onlyOn?, layer?, frame?',
    run: (p) => {
      const outer = num(p, 'outer');
      const inner = num(p, 'inner', 0);
      if (outer <= inner) fail('outer precisa ser maior que inner');
      const rays = int(p, 'rays', 12);
      if (rays < 2 || rays > 96) fail('rays precisa estar entre 2 e 96');
      const colors = has(p, 'colors')
        ? (Array.isArray(p.colors) && p.colors.length > 0 ? p.colors : fail('colors precisa ser uma lista de cores')).map((c, i) =>
            colorValue(c, `colors[${i}]`),
          )
        : [color(p)];
      let dash: [number, number] | null = null;
      if (has(p, 'dash')) {
        if (!Array.isArray(p.dash) || p.dash.length !== 2 || typeof p.dash[0] !== 'number' || typeof p.dash[1] !== 'number' || p.dash[0] <= 0) {
          fail('dash precisa ser [aceso, apagado] em pixels, com aceso > 0');
        }
        dash = [p.dash[0], p.dash[1]];
      }
      const alternate = num(p, 'alternate', 1);
      if (alternate < 0 || alternate > 1) fail('alternate precisa estar entre 0 e 1');
      return paint(p, (editor) =>
        burstCells(num(p, 'cx'), num(p, 'cy'), inner, outer, rays, num(p, 'rotation', -90), dash, alternate, (x, y, t) =>
          editor.set(x, y, colors[Math.min(colors.length - 1, Math.floor(t * colors.length))]),
        ),
      );
    },
  },

  'effect.outline': {
    summary: 'Contorna o que está desenhado na camada com uma cor. corners true inclui as diagonais. allFrames true (ou tag, from/to) contorna cada quadro.',
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
    summary: 'Troca uma cor por outra em toda a camada.',
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
      'Força a arte numa paleta: cada pixel vira a cor mais próxima (a paleta do editor, palette ou preset) e fica opaco; abaixo de meia transparência some. dither (0 a 1) quebra degradês num xadrez ordenado. scope: all (padrão), layer ou frame. Bom como último passo.',
    params: 'palette? | preset?, dither?, scope?, layer?, frame?',
    run: (p) => {
      const { doc } = useApp.getState();
      const palette = paletteParam(p);
      const dither = num(p, 'dither', 0);
      if (dither < 0 || dither > 1) fail('dither precisa estar entre 0 e 1');
      const cels = scopeCels(doc, colorScope(p), targetLayer(p).id, targetFrame(p).id).map(({ layer, frame }) => ({
        layer,
        frame: frameRef(frame),
      }));
      return paintCels({}, cels, (editor, _i, width) => writeAll(editor, posterize(editor.cel, width, palette, dither)));
    },
  },

  'effect.shade': {
    summary:
      'Luz e sombra pela borda da forma, como um chanfro: pixels a até size px da borda virada para a luz recebem light, e a até darkSize px da borda oposta recebem dark. angle é de onde vem a luz em graus (padrão -135: cima à esquerda; 0 direita, 90 baixo). on limita à forma de uma cor (padrão: tudo que está pintado).',
    params: 'light?, dark?, angle?, size?, darkSize?, on?, onlyOn?, layer?, frame?, allFrames?, tag?',
    run: (p) => {
      if (!has(p, 'light') && !has(p, 'dark')) fail('passe light, dark ou os dois');
      const light = has(p, 'light') ? colorValue(p.light, 'light') : null;
      const dark = has(p, 'dark') ? colorValue(p.dark, 'dark') : null;
      const size = int(p, 'size', 1);
      const darkSize = int(p, 'darkSize', size);
      if (size < 0 || darkSize < 0 || size > 64 || darkSize > 64) fail('size e darkSize precisam ser de 0 a 64');
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
      'Faixas de cor pela distância até a borda da forma (SDF): colors vai da borda para dentro, cada faixa com width px. origin "center" conta do miolo para fora (brilho interno). Pixels além da última faixa ficam como estão. on limita à forma de uma cor.',
    params: 'colors: string[], width?, origin?: "edge" | "center", on?, onlyOn?, layer?, frame?, allFrames?, tag?',
    run: (p) => {
      const colors = colorList(p, 'colors');
      const band = num(p, 'width', 1);
      if (band <= 0) fail('width precisa ser maior que zero');
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
      'Arredonda e funde formas como gosma: borra radius px e corta em threshold (0 a 1, padrão 0.5). Formas próximas se juntam, cantos arredondam, pontas finas somem. Pixels novos pegam a cor do pixel pintado mais perto.',
    params: 'radius, threshold?, layer?, frame?, allFrames?, tag?',
    run: (p) => {
      const radius = int(p, 'radius');
      if (radius < 1 || radius > 16) fail('radius precisa ser de 1 a 16');
      const threshold = num(p, 'threshold', 0.5);
      if (threshold <= 0 || threshold >= 1) fail('threshold precisa estar entre 0 e 1 (sem incluir)');
      const layer = targetLayer(p);
      return paintCels({}, effectFrames(p).map((frame) => ({ layer, frame })), (editor, _i, width, height) =>
        writeAll(editor, blobify(editor.cel, width, height, radius, threshold)),
      );
    },
  },

  'effect.wave': {
    summary:
      'Ondula a camada: direction "vertical" sobe e desce cada coluna (barra de fantasma, água), "horizontal" desloca cada linha (bandeira, calor). amp em px, wavelength em px entre cristas, phase de 0 a 1. start é a linha (ou coluna) onde a onda começa, crescendo ao longo de ramp px. animate true usa o quadro base (frame, padrão o atual) como fonte e anima a fase em todos os quadros do trecho (tag, from/to ou todos), cycles voltas por loop; frames cria quadros até esse total antes.',
    params: 'direction?, amp, wavelength, phase?, start?, ramp?, layer?, frame?, animate?, cycles?, frames?, tag?, from?, to?',
    run: (p) =>
      actions.group(() => {
        const direction = choice<WaveDirection>(p, 'direction', ['vertical', 'horizontal'], 'vertical');
        const amp = num(p, 'amp');
        const wavelength = num(p, 'wavelength');
        if (wavelength <= 0) fail('wavelength precisa ser maior que zero');
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
      'Gira a camada angle graus (positivo = horário) em volta de (cx, cy), padrão o centro da imagem. Cada pixel novo pega a cor da maioria das amostras dele, então as bordas ficam limpas e nenhuma cor nova aparece (como RotSprite). Gire antes de contornar: o contorno fica mais limpo depois.',
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
      'Máscara de recorte: apaga da camada os pixels onde a camada by está vazia (invert true: onde by está pintada). Serve para a sombra ou o brilho não passarem da forma de baixo. Usa o mesmo quadro nas duas camadas.',
    params: 'by, invert?, layer?, frame?, allFrames?, tag?',
    run: (p) => {
      if (!has(p, 'by')) fail('o parâmetro "by" é obrigatório: a camada cuja forma recorta');
      const by = layerRef(p.by);
      const layer = targetLayer(p);
      if (by === layer) fail('by precisa ser outra camada');
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
      'Balança uma camada no loop sem redesenhar: desloca o desenho de cada quadro do trecho (tag, from/to ou todos) amp px numa onda; onde a camada está vazia num quadro, usa o do primeiro quadro do trecho (base fixa um quadro como fonte de todos). axis "y" (padrão) ou "x"; cycles voltas por loop (inteiro fecha o loop); phase de 0 a 1 atrasa a camada em relação às outras (acompanhamento: rosto 0, acessório 0.1); shape sine, bounce (pulo para um lado só) ou square. frames cria quadros até esse total antes.',
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
        if (span.length < 2) fail('o trecho precisa de pelo menos 2 quadros; passe frames para criar');
        const { doc } = useApp.getState();
        const painted = (cel: Uint32Array) => cel.some((c) => c >>> 24);
        const first = celOf(doc, layer, (has(p, 'base') ? frameRef(p.base) : span[0]).id).slice();
        if (!painted(first)) fail(`a camada "${layer.name}" está vazia no quadro base`);
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
      'Partículas que flutuam em loop (poeira, brilhos, bolhas, neve) em todos os quadros do trecho: count pontos nascem em momentos sorteados dentro da caixa x, y, w, h (padrão: a imagem toda), andam drift [dx, dy] px durante a vida, balançam wobble px para o lado e vivem life (0 a 1) do loop. colors vai do nascimento ao fim. seed fixa o sorteio. clear true apaga a camada nesses quadros antes. Use numa camada só para elas.',
    params: 'count, colors? | color?, seed?, x?, y?, w?, h?, drift?: [dx, dy], wobble?, life?, clear?, onlyOn?, layer?, frames?, tag?, from?, to?',
    run: (p) =>
      actions.group(() => {
        const count = int(p, 'count');
        if (count < 1 || count > 2000) fail('count precisa ser de 1 a 2000');
        const colors = has(p, 'colors') ? colorList(p, 'colors') : [color(p)];
        let drift: [number, number] = [0, -4];
        if (has(p, 'drift')) {
          if (!Array.isArray(p.drift) || p.drift.length !== 2 || p.drift.some((v) => typeof v !== 'number')) fail('drift precisa ser [dx, dy]');
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
    summary: 'Desfaz o último passo.',
    params: '',
    run: () => {
      actions.undo();
      return { canUndo: useApp.getState().canUndo, canRedo: useApp.getState().canRedo };
    },
  },

  'history.redo': {
    summary: 'Refaz o último passo desfeito.',
    params: '',
    run: () => {
      actions.redo();
      return { canUndo: useApp.getState().canUndo, canRedo: useApp.getState().canRedo };
    },
  },

  'tool.set': {
    summary: 'Escolhe a ferramenta ativa na interface.',
    params: 'tool: pencil | eraser | line | rect | fill | eyedropper',
    run: (p) => {
      const tool = text(p, 'tool') as ToolId;
      if (!['pencil', 'eraser', 'line', 'rect', 'fill', 'eyedropper'].includes(tool)) fail(`ferramenta desconhecida: ${tool}`);
      actions.setTool(tool);
      return { tool };
    },
  },

  'view.fit': {
    summary: 'Ajusta o zoom para a imagem caber na janela.',
    params: '',
    readOnly: true,
    run: () => {
      actions.fitView();
      return { zoom: useApp.getState().view.zoom };
    },
  },

  'view.zoom': {
    summary: 'Zoom em porcentagem, por exemplo 800.',
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
    summary: 'Mostra ou esconde a grade de pixels.',
    params: 'on',
    readOnly: true,
    run: (p) => {
      if (useApp.getState().showGrid !== bool(p, 'on', true)) actions.toggleGrid();
      return { grid: useApp.getState().showGrid };
    },
  },

  'view.tile': {
    summary: 'Modo tile: mostra a imagem repetida em volta (só na tela), para conferir se as bordas emendam.',
    params: 'on',
    readOnly: true,
    run: (p) => {
      if (useApp.getState().tileMode !== bool(p, 'on', true)) actions.toggleTileMode();
      return { tile: useApp.getState().tileMode };
    },
  },

  'view.isoGrid': {
    summary: 'Grade isométrica 2:1 (só na tela) com ladrilhos de size pixels de largura e metade de altura; size 0 esconde.',
    params: 'size',
    readOnly: true,
    run: (p) => {
      const size = int(p, 'size');
      if (size < 0 || size > 512 || size % 2 !== 0) fail('size precisa ser par, de 0 a 512 (0 esconde)');
      actions.setIsoGrid(size);
      return { isoGrid: useApp.getState().isoGrid };
    },
  },

  // Output. Files are written by the caller, so the app never needs file system access for scripts.

  'render.png': {
    summary: 'PNG em base64 da imagem visível (ou de uma camada), ampliado por scale sem borrar.',
    params: 'scale?, layer?, frame?',
    readOnly: true,
    run: async (p) => {
      const { doc } = useApp.getState();
      const scale = int(p, 'scale', 1);
      if (scale < 1 || doc.width * scale > 8192 || doc.height * scale > 8192) fail('scale fora do limite (até 8192 px por lado)');
      const frame = targetFrame(p).id;
      const source = has(p, 'layer') ? celOf(doc, layerRef(p.layer), frame) : composite(doc, frame);
      const pixels = scaleNearest(source, doc.width, doc.height, scale);
      const png = await encodePng(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), doc.width * scale, doc.height * scale);
      return { png: toBase64(png), width: doc.width * scale, height: doc.height * scale };
    },
  },

  'render.sheet': {
    summary:
      'Folha de sprites em PNG (base64): os quadros lado a lado (layout "row") ou numa grade quase quadrada ("grid"). tag limita a um trecho.',
    params: 'scale?, layout?: "row" | "grid", tag?',
    readOnly: true,
    run: async (p) => {
      const { doc } = useApp.getState();
      const scale = int(p, 'scale', 1);
      const layout = text(p, 'layout', 'row');
      if (layout !== 'row' && layout !== 'grid') fail('layout precisa ser "row" ou "grid"');
      const range = exportRange(p);
      const { cols, rows } = sheetGrid(range ? range[1] - range[0] + 1 : doc.frames.length, layout);
      if (scale < 1 || cols * doc.width * scale > 16384 || rows * doc.height * scale > 16384) {
        fail('folha grande demais (até 16384 px por lado); use scale menor ou layout "grid"');
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
      'GIF animado (base64) com os quadros e suas durações, repetindo para sempre. pingpong true vai e volta; tag limita a um trecho. GIF guarda até 256 cores e transparência total ou nenhuma.',
    params: 'scale?, pingpong?, tag?',
    readOnly: true,
    run: (p) => {
      const { doc } = useApp.getState();
      const scale = int(p, 'scale', 1);
      if (scale < 1 || doc.width * scale > 4096 || doc.height * scale > 4096) fail('scale fora do limite (até 4096 px por lado)');
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
    summary: 'Conteúdo do arquivo .pontilha (camadas, paleta) para quem chamou salvar.',
    params: '',
    readOnly: true,
    run: async () => {
      const s = useApp.getState();
      return { text: await serializeProject(s.doc, s.palette, s.activeLayerId, s.recipes), fileName: s.fileName };
    },
  },

  'project.markSaved': {
    summary: 'Informa que o projeto foi salvo pelo script, com o nome do arquivo.',
    params: 'fileName',
    readOnly: true,
    run: (p) => {
      useApp.setState({ dirty: false, fileName: text(p, 'fileName') });
      return { fileName: useApp.getState().fileName };
    },
  },

  'project.load': {
    summary: 'Abre o conteúdo de um arquivo .pontilha. Recusa se houver alterações não salvas, a menos que discard seja true.',
    params: 'text, fileName?, discard?',
    run: async (p) => {
      guardUnsaved(p);
      const project = await parseProject(text(p, 'text'));
      actions.loadDoc(project.doc, {
        activeLayerId: project.activeLayerId,
        palette: project.palette,
        recipes: project.recipes,
        fileName: text(p, 'fileName', 'projeto.pontilha'),
        filePath: null,
      });
      return inspect();
    },
  },

  'image.loadSheet': {
    summary:
      'Abre uma folha de sprites PNG (base64) como animação nova: recorta em quadros de frameWidth × frameHeight, da esquerda para a direita e de cima para baixo, sem as células vazias do fim. Mesma regra de discard do doc.new.',
    params: 'png, frameWidth, frameHeight, duration?, fileName?, discard?',
    run: async (p) => {
      guardUnsaved(p);
      const image = await decodeImage(fromBase64(text(p, 'png')));
      const fw = int(p, 'frameWidth');
      const fh = int(p, 'frameHeight');
      checkSize(fw, fh);
      if (fw > image.width || fh > image.height) fail(`o quadro ${fw} × ${fh} é maior que a folha ${image.width} × ${image.height}`);
      const cells = sliceSheet(image.pixels, image.width, image.height, fw, fh);
      if (cells.length > MAX_FRAMES) fail(`a folha daria ${cells.length} quadros; o máximo é ${MAX_FRAMES}`);
      actions.loadDoc(docFromFrames(cells, fw, fh, clampDuration(num(p, 'duration', 100))), {
        fileName: text(p, 'fileName', 'folha.pontilha'),
        filePath: null,
        dirty: true,
      });
      return inspect();
    },
  },

  'image.load': {
    summary: 'Abre um PNG (base64) como imagem nova de uma camada. Mesma regra de discard do doc.new.',
    params: 'png, fileName?, discard?',
    run: async (p) => {
      guardUnsaved(p);
      const image = await decodeImage(fromBase64(text(p, 'png')));
      checkSize(image.width, image.height);
      actions.loadDoc(
        createDoc(image.width, image.height, image.pixels),
        { fileName: text(p, 'fileName', 'imagem.pontilha'), filePath: null },
      );
      return inspect();
    },
  },

  // Recipes: record the commands that build a piece, then play them back, for instance in other colours.

  'recipe.start': {
    summary:
      'Começa a gravar uma receita: os comandos que mudam a imagem passam a ser guardados em ordem (não entram project.*, image.* e recipe.*). Desfazer tira o último passo gravado. Termine com recipe.stop.',
    params: 'name',
    readOnly: true,
    run: (p) => {
      const name = text(p, 'name').trim();
      if (!name) fail('name não pode ser vazio');
      if (recording) fail(`já há uma receita gravando: "${recording.name}". Use recipe.stop antes.`);
      recording = { name, steps: [], units: [], undone: [] };
      return { recording: name };
    },
  },

  'recipe.stop': {
    summary: 'Para de gravar e guarda a receita no projeto (substitui uma de mesmo nome). discard true joga fora.',
    params: 'discard?',
    run: (p) => {
      if (!recording) fail('nenhuma receita está gravando');
      const { name, steps } = recording;
      recording = null;
      if (bool(p, 'discard', false)) return { discarded: name };
      if (steps.length === 0) fail('a receita não tem passos; nada foi guardado');
      useApp.setState((s) => ({ recipes: [...s.recipes.filter((r) => r.name !== name), { name, steps }], dirty: true }));
      return { saved: name, steps: steps.length };
    },
  },

  'recipe.list': {
    summary: 'Receitas guardadas no projeto, com os passos. steps false mostra só nomes e contagem.',
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
      'Guarda uma receita escrita à mão: steps é uma lista de {method, params}, como num batch ({id, params}, o formato dos arquivos de receita em examples/, também vale).',
    params: 'name, steps',
    run: (p) => {
      const name = text(p, 'name').trim();
      if (!name) fail('name não pode ser vazio');
      if (!Array.isArray(p.steps) || p.steps.length === 0) fail('steps precisa ser uma lista de {method, params}');
      const steps = p.steps.map((st, i) => {
        const method = (st as Params | null)?.method ?? (st as Params | null)?.id;
        if (typeof method !== 'string' || !COMMANDS[method]) fail(`steps[${i}]: comando desconhecido ${JSON.stringify(method)}`);
        if (NOT_RECORDED.some((prefix) => method.startsWith(prefix))) fail(`steps[${i}]: ${method} não pode entrar numa receita`);
        return { method, params: structuredClone(((st as Params).params ?? {}) as Record<string, unknown>) };
      });
      useApp.setState((s) => ({ recipes: [...s.recipes.filter((r) => r.name !== name), { name, steps }], dirty: true }));
      return { saved: name, steps: steps.length };
    },
  },

  'recipe.delete': {
    summary: 'Apaga uma receita do projeto.',
    params: 'name',
    run: (p) => {
      const name = text(p, 'name');
      if (!useApp.getState().recipes.some((r) => r.name === name)) fail(`receita não encontrada: ${name}`);
      useApp.setState((s) => ({ recipes: s.recipes.filter((r) => r.name !== name), dirty: true }));
      return { deleted: name };
    },
  },

  'recipe.run': {
    summary:
      'Executa uma receita como um passo de desfazer. colors {"#antiga": "#nova"} troca cores em todos os parâmetros: a mesma peça em outra paleta. Se a receita começa com doc.new, cria a imagem antes (discard vale para ela). Se um passo falhar, nada é aplicado.',
    params: 'name, colors?: {de: para}, discard?',
    run: async (p) => {
      const name = text(p, 'name');
      const recipe = useApp.getState().recipes.find((r) => r.name === name);
      if (!recipe) fail(`receita não encontrada: ${name}. Receitas: ${useApp.getState().recipes.map((r) => r.name).join(', ') || 'nenhuma'}`);
      const swap = new Map<number, string>();
      if (has(p, 'colors')) {
        if (typeof p.colors !== 'object' || Array.isArray(p.colors)) fail('colors precisa ser um objeto {"#de": "#para"}');
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
        if (steps.slice(first).some((st) => st.method === 'doc.new')) fail('doc.new só pode ser o primeiro passo de uma receita');
        await actions.group(async () => {
          for (const [i, st] of steps.slice(first).entries()) {
            try {
              await runOne(st.method, st.params);
            } catch (err) {
              throw new CommandError(`passo ${i + first + 1} (${st.method}): ${message(err)}. Nada da receita foi aplicado.`);
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
  if (typeof method !== 'string') fail('method precisa ser o nome de um comando');
  const command = COMMANDS[method];
  if (!command) fail(`comando desconhecido: ${method}. Use commands.list para ver os disponíveis.`);
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
    fail('params precisa ser um objeto');
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
    if (!Array.isArray(list)) fail('batch precisa de commands: [{method, params}, ...]');
    const recorded = recording?.steps.length;
    const results = await recordUnit('batch', () => actions.group(async () => {
      const out: unknown[] = [];
      for (const [i, item] of list.entries()) {
        const m = (item as Params | null)?.method;
        if (m === 'batch' || (typeof m === 'string' && m.startsWith('history.'))) {
          fail(`comando ${i + 1}: ${String(m)} não pode ser usado dentro de batch`);
        }
        try {
          out.push(await runOne(m, (item as Params | null)?.params));
        } catch (err) {
          if (recording && recorded !== undefined) recording.steps.length = recorded;
          throw new CommandError(`comando ${i + 1} (${String(m)}): ${message(err)}. Nada do lote foi aplicado.`);
        }
      }
      return out;
    }));
    return { ok: true, result: results };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
