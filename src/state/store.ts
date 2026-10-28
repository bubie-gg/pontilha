import { create } from 'zustand';
import { blendOver, sameColor } from '../core/color';
import {
  type Doc,
  type Frame,
  type Layer,
  MAX_FRAMES,
  MAX_SIZE,
  celOf,
  clampDuration,
  createDoc,
  createFrame,
  createLayer,
  frameIndex,
  nextLayerName,
  showFrame,
} from '../core/doc';
import { PixelEditor } from '../core/editor';
import { type ColorScope, scopeCels } from '../core/palette';
import { scaleNearest } from '../core/png';
import { type DocState, type Entry, type Focus, History, snapshot } from '../core/history';
import {
  type Anchor,
  type Flip,
  type Rect,
  type Turn,
  anchorOffset,
  clearRegion,
  clipRect,
  contentBounds,
  copyRegion,
  flipRegion,
  relocate,
  rotateRegion,
  sameRect,
  shiftCel,
  turnedRect,
} from '../core/transform';
import { DEFAULT_PALETTE } from '../core/palette';
import { DEFAULT_SETTINGS, type ToolId, type ToolSettings } from '../core/tools';

/** Zoom steps in device pixels per image pixel. Integers keep every pixel the same size on screen. */
export const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];

export interface View {
  zoom: number;
  /** Screen position of the image's top-left corner, in device pixels. */
  panX: number;
  panY: number;
  width: number;
  height: number;
  dpr: number;
}

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

/** Copied pixels and where they came from, so pasting puts them back in the same place. */
export interface Clip {
  pixels: Uint32Array;
  rect: Rect;
}

/** Which layer and cel a selection operation works on; by default the active layer in the frame on screen. */
export interface Target {
  layer: Layer;
  cel: Uint32Array;
}

export interface Notice {
  text: string;
  tone: 'info' | 'error';
  id: number;
}

export interface AppState {
  doc: Doc;
  activeLayerId: string;
  /** Bumped whenever pixels or layers change. */
  version: number;
  fileName: string;
  filePath: string | null;
  dirty: boolean;
  tool: ToolId;
  /** Tool to return to when a temporary eyedropper (Alt) is released. */
  heldTool: ToolId | null;
  settings: ToolSettings;
  primary: number;
  secondary: number;
  palette: number[];
  showGrid: boolean;
  view: View;
  needsFit: boolean;
  hover: { x: number; y: number } | null;
  /** Space is held, so dragging moves the view. */
  panKey: boolean;
  canUndo: boolean;
  canRedo: boolean;
  notice: Notice | null;
  dialog: 'new' | 'export' | 'canvas' | 'recolor' | 'ramp' | null;
  confirm: ConfirmRequest | null;
  /** Port scripts use to drive this window, or null when control is off. */
  controlPort: number | null;
  /** The animation is playing in the editor. */
  playing: boolean;
  loopMode: 'loop' | 'pingpong';
  /** Shows the neighbouring frames faintly under the one being edited. */
  onionSkin: boolean;
  /** Area that selection operations act on, or null for none. Always inside the image. */
  selection: Rect | null;
  clipboard: Clip | null;
}

export const UNTITLED = 'Sem título';

export const history = new History();

const firstDoc = createDoc(32, 32);

export const useApp = create<AppState>(() => ({
  doc: firstDoc,
  activeLayerId: firstDoc.layers[0].id,
  version: 0,
  fileName: UNTITLED,
  filePath: null,
  dirty: false,
  tool: 'pencil',
  heldTool: null,
  settings: DEFAULT_SETTINGS,
  primary: DEFAULT_PALETTE[1],
  secondary: DEFAULT_PALETTE[6],
  palette: DEFAULT_PALETTE,
  showGrid: true,
  view: { zoom: 16, panX: 0, panY: 0, width: 0, height: 0, dpr: 1 },
  needsFit: true,
  hover: null,
  panKey: false,
  canUndo: false,
  canRedo: false,
  notice: null,
  dialog: null,
  confirm: null,
  controlPort: null,
  playing: false,
  loopMode: 'loop',
  onionSkin: false,
  selection: null,
  clipboard: null,
}));

const get = useApp.getState;
const set = useApp.setState;

export function activeLayer(): Layer {
  const { doc, activeLayerId } = get();
  return doc.layers.find((l) => l.id === activeLayerId) ?? doc.layers[doc.layers.length - 1];
}

function changed(extra: Partial<AppState> = {}) {
  set((s) => ({ version: s.version + 1, ...extra }));
}

function recorded(entry: Entry, extra: Partial<AppState> = {}) {
  history.push(entry);
  changed({ dirty: true, canUndo: true, canRedo: false, ...extra });
}

/** Runs a change to the layers or frames and records it as one undo step. */
function changeLayers(mutate: (doc: Doc, active: string) => string | void) {
  const { doc, activeLayerId } = get();
  const before = snapshot(doc);
  const activeAfter = mutate(doc, activeLayerId) ?? activeLayerId;
  recorded(
    { kind: 'structure', before, after: snapshot(doc), activeBefore: activeLayerId, activeAfter },
    { activeLayerId: activeAfter },
  );
}

/** After undo, redo or a rolled-back group: shows the frame, layer and selection that changed. */
function settle(focus: Focus, extra: Partial<AppState> = {}) {
  const { doc } = get();
  if (focus.frame && focus.frame !== doc.frame && doc.frames.some((f) => f.id === focus.frame)) showFrame(doc, focus.frame);
  doc.layers = [...doc.layers];
  doc.frames = [...doc.frames];
  changed({
    ...extra,
    ...(focus.layer ? { activeLayerId: focus.layer } : {}),
    ...(focus.selection !== undefined ? { selection: focus.selection } : {}),
  });
}

/**
 * Replaces every cel with `make(cel)` on a width × height canvas, as one undo step.
 * The selection is dropped: it would point at the wrong pixels.
 */
function reshape(width: number, height: number, make: (cel: Uint32Array, w: number, h: number) => Uint32Array) {
  const { doc, activeLayerId, selection } = get();
  const before = snapshot(doc);
  for (const layer of doc.layers) {
    const cels = new Map<string, Uint32Array>();
    for (const f of doc.frames) cels.set(f.id, make(celOf(doc, layer, f.id), doc.width, doc.height));
    layer.cels = cels;
  }
  doc.width = width;
  doc.height = height;
  doc.layers = [...doc.layers];
  doc.frames = [...doc.frames];
  showFrame(doc, doc.frame);
  const entries: Entry[] = [{ kind: 'structure', before, after: snapshot(doc), activeBefore: activeLayerId, activeAfter: activeLayerId }];
  if (selection) entries.push({ kind: 'selection', before: selection, after: null });
  recorded(entries.length === 1 ? entries[0] : { kind: 'group', entries }, { selection: null });
  actions.fitView();
}

function checkSize(width: number, height: number): boolean {
  const ok = Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= MAX_SIZE && height <= MAX_SIZE;
  if (!ok) actions.notify(`O tamanho precisa ficar entre 1 e ${MAX_SIZE} px de cada lado.`, 'error');
  return ok;
}

function defaultTarget(): Target {
  const layer = activeLayer();
  return { layer, cel: layer.pixels };
}

/** Records a pixel change together with the selection it leaves behind, as one undo step. */
function recordSelectionEdit(entry: Entry | null, before: Rect | null, after: Rect | null) {
  const entries: Entry[] = entry ? [entry] : [];
  if (!sameRect(before, after)) entries.push({ kind: 'selection', before, after });
  if (entries.length === 0) return;
  recorded(entries.length === 1 ? entries[0] : { kind: 'group', entries }, { selection: after });
}

/**
 * Replaces the selected pixels (or the whole layer when nothing is selected) with
 * `make(pixels)`, placed at the rectangle it returns. The selection follows them.
 */
function transformRegion(target: Target, make: (pixels: Uint32Array, region: Rect) => { pixels: Uint32Array; to: Rect }) {
  const { doc, selection } = get();
  const region = selection ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const { pixels, to } = make(copyRegion(target.cel, doc.width, region), region);
  const editor = new PixelEditor(target.layer, doc.width, doc.height, target.cel);
  relocate(editor, region, pixels, to);
  recordSelectionEdit(editor.toEntry(), selection, selection && clipRect(to, doc.width, doc.height));
}

function frameById(id?: string): Frame {
  const { doc } = get();
  return doc.frames.find((f) => f.id === (id ?? doc.frame)) ?? doc.frames[0];
}

function clampZoomIndex(zoom: number) {
  let best = 0;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    if (Math.abs(ZOOM_LEVELS[i] - zoom) < Math.abs(ZOOM_LEVELS[best] - zoom)) best = i;
  }
  return best;
}

export const actions = {
  touch: () => changed(),

  notify(text: string, tone: Notice['tone'] = 'info') {
    set({ notice: { text, tone, id: Date.now() } });
  },

  confirm(message: string, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      set({
        confirm: {
          message,
          confirmLabel,
          resolve: (ok) => {
            set({ confirm: null });
            resolve(ok);
          },
        },
      });
    });
  },

  openDialog: (dialog: AppState['dialog']) => set({ dialog }),

  // History

  commit(entry: Entry | null) {
    if (entry) recorded(entry);
    else changed();
  },

  undo() {
    const { doc } = get();
    const size = `${doc.width}x${doc.height}`;
    const focus = history.undo(doc);
    if (focus) settle(focus, { dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
    if (`${doc.width}x${doc.height}` !== size) actions.fitView();
  },

  redo() {
    const { doc } = get();
    const size = `${doc.width}x${doc.height}`;
    const focus = history.redo(doc);
    if (focus) settle(focus, { dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
    if (`${doc.width}x${doc.height}` !== size) actions.fitView();
  },

  // Documents

  loadDoc(doc: Doc, opts: { activeLayerId?: string; palette?: number[]; fileName: string; filePath: string | null; dirty?: boolean }) {
    history.clear();
    showFrame(doc, doc.frames.some((f) => f.id === doc.frame) ? doc.frame : doc.frames[0].id);
    changed({
      doc,
      activeLayerId: opts.activeLayerId ?? doc.layers[doc.layers.length - 1].id,
      palette: opts.palette && opts.palette.length > 0 ? opts.palette : get().palette,
      fileName: opts.fileName,
      filePath: opts.filePath,
      dirty: opts.dirty ?? false,
      canUndo: false,
      canRedo: false,
      needsFit: true,
      hover: null,
      playing: false,
      selection: null,
    });
    actions.fitView();
  },

  newDoc(width: number, height: number) {
    actions.loadDoc(createDoc(width, height), { fileName: UNTITLED, filePath: null });
  },

  // Tools and colours

  setTool: (tool: ToolId) => set({ tool, heldTool: null }),

  holdEyedropper(on: boolean) {
    const { tool, heldTool } = get();
    if (on && tool !== 'eyedropper') set({ tool: 'eyedropper', heldTool: tool });
    if (!on && heldTool) set({ tool: heldTool, heldTool: null });
  },

  setSettings: (patch: Partial<ToolSettings>) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  setBrushSize(size: number) {
    actions.setSettings({ brushSize: Math.min(32, Math.max(1, Math.round(size))) });
  },

  setPrimary: (primary: number) => set({ primary }),
  setSecondary: (secondary: number) => set({ secondary }),
  swapColors: () => set((s) => ({ primary: s.secondary, secondary: s.primary })),

  addToPalette(color: number) {
    if (get().palette.includes(color)) {
      actions.notify('Essa cor já está na paleta.');
      return;
    }
    set((s) => ({ palette: [...s.palette, color], dirty: true }));
  },

  /** Appends colours missing from the palette; returns how many were new. */
  addColors(colors: number[]): number {
    const fresh = colors.filter((c, i) => c >>> 24 && colors.indexOf(c) === i && !get().palette.includes(c));
    if (fresh.length) set((s) => ({ palette: [...s.palette, ...fresh], dirty: true }));
    return fresh.length;
  },

  /**
   * Swaps one colour for another in every layer and frame (or only the active
   * layer, or only the frame on screen), as one undo step. Returns pixels changed.
   */
  replaceColor(from: number, to: number, scope: ColorScope = 'all', at: { layer?: string; frame?: string } = {}): number {
    const { doc, activeLayerId } = get();
    const entries: Entry[] = [];
    let count = 0;
    for (const { layer, cel } of scopeCels(doc, scope, at.layer ?? activeLayerId, at.frame ?? doc.frame)) {
      const editor = new PixelEditor(layer, doc.width, doc.height, cel);
      for (let i = 0; i < cel.length; i++) if (sameColor(cel[i], from)) editor.setIndex(i, to);
      const entry = editor.toEntry();
      if (entry?.kind !== 'pixels') continue;
      entries.push(entry);
      count += entry.indices.length;
    }
    if (entries.length) recorded(entries.length === 1 ? entries[0] : { kind: 'group', entries });
    return count;
  },

  removeFromPalette(color: number) {
    set((s) => ({ palette: s.palette.filter((c) => c !== color), dirty: true }));
  },

  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),

  // Layers

  setActiveLayer: (activeLayerId: string) => set({ activeLayerId }),

  addLayer(opts: { name?: string; opacity?: number; visible?: boolean; pixels?: Uint32Array } = {}) {
    let created: Layer | undefined;
    changeLayers((doc, active) => {
      const layer = createLayer(doc, opts.name?.trim() || nextLayerName(doc), opts.pixels);
      if (opts.opacity !== undefined) layer.opacity = opts.opacity;
      if (opts.visible !== undefined) layer.visible = opts.visible;
      const index = doc.layers.findIndex((l) => l.id === active);
      doc.layers = doc.layers.toSpliced(index + 1, 0, layer);
      created = layer;
      return layer.id;
    });
    return created!;
  },

  /** Changes name, opacity or visibility of a layer as one undo step. */
  updateLayer(id: string, patch: { name?: string; opacity?: number; visible?: boolean }) {
    const layer = get().doc.layers.find((l) => l.id === id);
    if (!layer) return;
    changeLayers((doc) => {
      if (patch.name !== undefined && patch.name.trim()) layer.name = patch.name.trim();
      if (patch.opacity !== undefined) layer.opacity = Math.min(1, Math.max(0, patch.opacity));
      if (patch.visible !== undefined) layer.visible = patch.visible;
      doc.layers = [...doc.layers];
    });
  },

  /**
   * Runs `work` as a transaction: everything it records becomes one undo step,
   * and if it throws, everything it changed is reverted.
   */
  async group<T>(work: () => Promise<T> | T): Promise<T> {
    const wasDirty = get().dirty;
    history.beginGroup();
    try {
      const result = await work();
      history.endGroup();
      return result;
    } catch (err) {
      settle(history.abortGroup(get().doc), { dirty: wasDirty });
      throw err;
    } finally {
      set({ canUndo: history.canUndo, canRedo: history.canRedo });
    }
  },

  duplicateLayer() {
    changeLayers((doc, active) => {
      const index = doc.layers.findIndex((l) => l.id === active);
      const source = doc.layers[index];
      const copy = createLayer(doc, `${source.name} cópia`);
      for (const f of doc.frames) copy.cels.set(f.id, celOf(doc, source, f.id).slice());
      copy.pixels = copy.cels.get(doc.frame)!;
      copy.opacity = source.opacity;
      copy.visible = source.visible;
      doc.layers = doc.layers.toSpliced(index + 1, 0, copy);
      return copy.id;
    });
  },

  deleteLayer() {
    const { doc } = get();
    if (doc.layers.length === 1) {
      actions.notify('A imagem precisa de pelo menos uma camada.');
      return;
    }
    changeLayers((d, active) => {
      const index = d.layers.findIndex((l) => l.id === active);
      d.layers = d.layers.toSpliced(index, 1);
      return d.layers[Math.max(0, index - 1)].id;
    });
  },

  moveLayer(direction: 1 | -1) {
    const { doc, activeLayerId } = get();
    const index = doc.layers.findIndex((l) => l.id === activeLayerId);
    const target = index + direction;
    if (target < 0 || target >= doc.layers.length) return;
    changeLayers((d) => {
      const layers = [...d.layers];
      [layers[index], layers[target]] = [layers[target], layers[index]];
      d.layers = layers;
    });
  },

  mergeDown() {
    const { doc, activeLayerId } = get();
    const index = doc.layers.findIndex((l) => l.id === activeLayerId);
    if (index <= 0) {
      actions.notify('Não há camada abaixo para mesclar.');
      return;
    }
    const upper = doc.layers[index];
    const lower = doc.layers[index - 1];
    if (!upper.visible) {
      actions.notify('Mostre a camada antes de mesclar.');
      return;
    }
    // Every frame merges, so the animation keeps looking the same.
    const pixels: Entry[] = [];
    for (const f of doc.frames) {
      const top = celOf(doc, upper, f.id);
      const bottom = celOf(doc, lower, f.id);
      const editor = new PixelEditor(lower, doc.width, doc.height, bottom);
      for (let i = 0; i < top.length; i++) {
        if (top[i] >>> 24) editor.setIndex(i, blendOver(bottom[i], top[i], upper.opacity));
      }
      const entry = editor.toEntry();
      if (entry) pixels.push(entry);
    }
    const before = snapshot(doc);
    doc.layers = doc.layers.toSpliced(index, 1);
    const layers: Entry = {
      kind: 'structure',
      before,
      after: snapshot(doc),
      activeBefore: activeLayerId,
      activeAfter: lower.id,
    };
    recorded({ kind: 'group', entries: [...pixels, layers] }, { activeLayerId: lower.id });
  },

  toggleVisibility(id: string) {
    const { doc } = get();
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    layer.visible = !layer.visible;
    doc.layers = [...doc.layers];
    changed({ dirty: true });
  },

  renameLayer(id: string, name: string) {
    const trimmed = name.trim();
    const layer = get().doc.layers.find((l) => l.id === id);
    if (!layer || !trimmed || trimmed === layer.name) return;
    changeLayers(() => {
      layer.name = trimmed;
    });
  },

  /** Live opacity while a slider is dragged; call commitOpacity when it is released. */
  previewOpacity(id: string, opacity: number) {
    const { doc } = get();
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    layer.opacity = opacity;
    doc.layers = [...doc.layers];
    changed();
  },

  commitOpacity(id: string, from: number) {
    const { doc, activeLayerId } = get();
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer || layer.opacity === from) return;
    const after = snapshot(doc);
    const before: DocState = { ...after, layers: after.layers.map((s) => (s.layer === layer ? { ...s, opacity: from } : s)) };
    recorded({ kind: 'structure', before, after, activeBefore: activeLayerId, activeAfter: activeLayerId });
  },

  // Selection

  /** Selects a rectangle (clipped to the image), or nothing. Not an undo step, like picking a layer. */
  select(rect: Rect | null) {
    const { doc } = get();
    set({ selection: rect && clipRect(rect, doc.width, doc.height) });
  },

  selectAll() {
    const { doc } = get();
    set({ selection: { x: 0, y: 0, w: doc.width, h: doc.height } });
  },

  /** Moves the selected pixels (or the whole layer) by dx, dy. What leaves the image is lost. */
  moveSelection(dx: number, dy: number, target = defaultTarget()) {
    if (dx === 0 && dy === 0) return;
    transformRegion(target, (pixels, r) => ({ pixels, to: { ...r, x: r.x + dx, y: r.y + dy } }));
  },

  flipSelection(flip: Flip, target = defaultTarget()) {
    transformRegion(target, (pixels, r) => ({ pixels: flipRegion(pixels, r.w, r.h, flip), to: r }));
  },

  /** Quarter turn about the selection's centre. Without a selection the image must be square. */
  rotateSelection(turn: Turn, target = defaultTarget()): boolean {
    const { doc, selection } = get();
    if (!selection && doc.width !== doc.height) {
      actions.notify('Para girar uma imagem que não é quadrada, selecione a área a girar.', 'error');
      return false;
    }
    transformRegion(target, (pixels, r) => ({ pixels: rotateRegion(pixels, r.w, r.h, turn), to: turnedRect(r) }));
    return true;
  },

  /** Empties the selected pixels. */
  clearSelection(target = defaultTarget()) {
    const { doc, selection } = get();
    if (!selection) return;
    const editor = new PixelEditor(target.layer, doc.width, doc.height, target.cel);
    clearRegion(editor, selection);
    actions.commit(editor.toEntry());
  },

  /** Copies the selection (or the whole layer). Returns what was copied. */
  copy(target = defaultTarget()): Clip {
    const { doc, selection } = get();
    const rect = selection ?? { x: 0, y: 0, w: doc.width, h: doc.height };
    const clip = { pixels: copyRegion(target.cel, doc.width, rect), rect };
    set({ clipboard: clip });
    return clip;
  },

  cut(target = defaultTarget()): Clip {
    const clip = actions.copy(target);
    const { doc, selection } = get();
    const editor = new PixelEditor(target.layer, doc.width, doc.height, target.cel);
    clearRegion(editor, clip.rect);
    recordSelectionEdit(editor.toEntry(), selection, selection);
    return clip;
  },

  /** Paints the clipboard where it was copied from (or at x, y) and selects it, ready to be dragged. */
  paste(at: { x?: number; y?: number } = {}, target = defaultTarget()): Rect | null {
    const { doc, selection, clipboard } = get();
    if (!clipboard) {
      actions.notify('Nada copiado ainda. Selecione uma área e use Ctrl+C.');
      return null;
    }
    const to = { ...clipboard.rect, x: at.x ?? clipboard.rect.x, y: at.y ?? clipboard.rect.y };
    const editor = new PixelEditor(target.layer, doc.width, doc.height, target.cel);
    relocate(editor, null, clipboard.pixels, to);
    const after = clipRect(to, doc.width, doc.height);
    recordSelectionEdit(editor.toEntry(), selection, after);
    return after;
  },

  /** Ends a drag of the selected pixels: records the move and where the selection landed. */
  finishMove(entry: Entry | null, before: Rect, to: Rect) {
    const { doc } = get();
    recordSelectionEdit(entry, before, clipRect(to, doc.width, doc.height));
    changed();
  },

  // Image size. Every layer and frame changes together.

  /** New canvas size, with the image pinned to `anchor`. Shrinking cuts what no longer fits. */
  resizeCanvas(width: number, height: number, anchor: Anchor = 'center'): boolean {
    const { doc } = get();
    if (!checkSize(width, height)) return false;
    if (width === doc.width && height === doc.height) return false;
    const { dx, dy } = anchorOffset(anchor, doc.width, doc.height, width, height);
    reshape(width, height, (cel, w, h) => shiftCel(cel, w, h, width, height, dx, dy));
    return true;
  },

  /** Cuts the image down to `rect` (the selection by default). */
  cropTo(rect: Rect | null = get().selection): boolean {
    const { doc } = get();
    const r = rect && clipRect(rect, doc.width, doc.height);
    if (!r) {
      actions.notify('Selecione a área que deve ficar.');
      return false;
    }
    if (r.w === doc.width && r.h === doc.height) return false;
    reshape(r.w, r.h, (cel, w, h) => shiftCel(cel, w, h, r.w, r.h, -r.x, -r.y));
    return true;
  },

  /** Cuts away the empty border around everything painted, in every layer and frame. */
  trim(): Rect | null {
    const bounds = contentBounds(get().doc);
    if (!bounds) {
      actions.notify('A imagem está vazia: não há o que recortar.');
      return null;
    }
    actions.cropTo(bounds);
    return bounds;
  },

  /** Enlarges the art: each pixel becomes a factor × factor block. */
  scaleImage(factor: number): boolean {
    const { doc } = get();
    if (!Number.isInteger(factor) || factor < 2) return false;
    if (!checkSize(doc.width * factor, doc.height * factor)) return false;
    reshape(doc.width * factor, doc.height * factor, (cel, w, h) => scaleNearest(cel, w, h, factor));
    return true;
  },

  // Frames

  /** Shows another frame. Not an undo step, like picking a layer. */
  selectFrame(id: string) {
    const { doc } = get();
    if (id === doc.frame || !doc.frames.some((f) => f.id === id)) return;
    showFrame(doc, id);
    changed();
  },

  togglePlay() {
    const { playing, doc } = get();
    if (!playing && doc.frames.length < 2) {
      actions.notify('Crie mais um quadro para tocar a animação.');
      return;
    }
    set({ playing: !playing });
  },

  setLoopMode: (loopMode: AppState['loopMode']) => set({ loopMode }),
  toggleOnionSkin: () => set((s) => ({ onionSkin: !s.onionSkin })),

  /** Moves the frame on screen by `step`, wrapping around the ends. */
  stepFrame(step: number) {
    const { doc } = get();
    const n = doc.frames.length;
    actions.selectFrame(doc.frames[(((frameIndex(doc) + step) % n) + n) % n].id);
  },

  /** Adds an empty frame after the current one (or a copy of it) and shows it. */
  addFrame(opts: { copy?: boolean; duration?: number } = {}): Frame | null {
    const { doc } = get();
    if (doc.frames.length >= MAX_FRAMES) {
      actions.notify(`A animação já tem o máximo de ${MAX_FRAMES} quadros.`, 'error');
      return null;
    }
    const source = frameById();
    const frame = createFrame(clampDuration(opts.duration ?? source.duration));
    changeLayers((d) => {
      for (const layer of d.layers) {
        layer.cels.set(frame.id, opts.copy ? celOf(d, layer, source.id).slice() : new Uint32Array(d.width * d.height));
      }
      d.frames = d.frames.toSpliced(frameIndex(d, source.id) + 1, 0, frame);
      showFrame(d, frame.id);
    });
    return frame;
  },

  deleteFrame(id?: string) {
    const { doc } = get();
    if (doc.frames.length === 1) {
      actions.notify('A animação precisa de pelo menos um quadro.');
      return;
    }
    const frame = frameById(id);
    changeLayers((d) => {
      const index = frameIndex(d, frame.id);
      for (const layer of d.layers) layer.cels.delete(frame.id);
      d.frames = d.frames.toSpliced(index, 1);
      if (d.frame === frame.id) showFrame(d, d.frames[Math.max(0, index - 1)].id);
    });
  },

  /** Puts a frame at position `to` (0 = first). */
  moveFrame(id: string, to: number) {
    const { doc } = get();
    const from = frameIndex(doc, id);
    const target = Math.min(doc.frames.length - 1, Math.max(0, Math.round(to)));
    if (from < 0 || from === target) return;
    changeLayers((d) => {
      const frames = d.frames.toSpliced(from, 1);
      d.frames = frames.toSpliced(target, 0, d.frames[from]);
    });
  },

  /** Changes one frame's duration, or every frame's when `id` is null, as one undo step. */
  setFrameDuration(id: string | null, ms: number) {
    const duration = clampDuration(ms);
    const target = (f: Frame) => id === null || f.id === id;
    if (get().doc.frames.every((f) => !target(f) || f.duration === duration)) return;
    changeLayers((d) => {
      d.frames = d.frames.map((f) => (target(f) ? { ...f, duration } : f));
    });
  },

  // View

  setViewportSize(width: number, height: number, dpr: number) {
    const { view, needsFit } = get();
    // Keep the image centred on the same screen point when the window resizes.
    const panX = Math.round(view.panX + (width - view.width) / 2);
    const panY = Math.round(view.panY + (height - view.height) / 2);
    set({ view: { ...view, width, height, dpr, panX, panY } });
    if (needsFit) actions.fitView();
  },

  fitView() {
    const { doc, view } = get();
    if (view.width === 0) return;
    let zoom = ZOOM_LEVELS[0];
    for (const z of ZOOM_LEVELS) if (doc.width * z <= view.width * 0.8 && doc.height * z <= view.height * 0.8) zoom = z;
    set({
      needsFit: false,
      view: {
        ...view,
        zoom,
        panX: Math.round((view.width - doc.width * zoom) / 2),
        panY: Math.round((view.height - doc.height * zoom) / 2),
      },
    });
  },

  /** Sets the zoom while keeping the image point under (anchorX, anchorY) in place. */
  zoomTo(zoom: number, anchorX?: number, anchorY?: number) {
    const { view } = get();
    const ax = anchorX ?? view.width / 2;
    const ay = anchorY ?? view.height / 2;
    const docX = (ax - view.panX) / view.zoom;
    const docY = (ay - view.panY) / view.zoom;
    set({ view: { ...view, zoom, panX: Math.round(ax - docX * zoom), panY: Math.round(ay - docY * zoom) } });
  },

  zoomStep(direction: 1 | -1, anchorX?: number, anchorY?: number) {
    const index = clampZoomIndex(get().view.zoom) + direction;
    const zoom = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index))];
    actions.zoomTo(zoom, anchorX, anchorY);
  },

  /** 100% means one image pixel per CSS pixel. */
  zoomActual() {
    const { dpr } = get().view;
    actions.zoomTo(ZOOM_LEVELS[clampZoomIndex(dpr)]);
  },

  panBy(dx: number, dy: number) {
    const { view } = get();
    set({ view: { ...view, panX: Math.round(view.panX + dx), panY: Math.round(view.panY + dy) } });
  },

  setHover(hover: AppState['hover']) {
    const prev = get().hover;
    if (prev?.x === hover?.x && prev?.y === hover?.y) return;
    set({ hover });
  },
};
