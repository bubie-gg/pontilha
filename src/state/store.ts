import { create } from 'zustand';
import { blendOver } from '../core/color';
import { type Doc, type Layer, createDoc, createLayer, markAllDirty, nextLayerName } from '../core/doc';
import { PixelEditor } from '../core/editor';
import { type Entry, History, type LayerState, snapshotLayers } from '../core/history';
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
  dialog: 'new' | 'export' | null;
  confirm: ConfirmRequest | null;
  /** Port scripts use to drive this window, or null when control is off. */
  controlPort: number | null;
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

/** Runs a change to the layer list and records it as one undo step. */
function changeLayers(mutate: (doc: Doc, active: string) => string | void) {
  const { doc, activeLayerId } = get();
  const before = snapshotLayers(doc);
  const activeAfter = mutate(doc, activeLayerId) ?? activeLayerId;
  recorded(
    { kind: 'layers', before, after: snapshotLayers(doc), activeBefore: activeLayerId, activeAfter },
    { activeLayerId: activeAfter },
  );
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
    const result = history.undo(get().doc);
    if (!result) return;
    get().doc.layers = [...get().doc.layers];
    changed({
      dirty: true,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      ...(result.activeLayerId ? { activeLayerId: result.activeLayerId } : {}),
    });
  },

  redo() {
    const result = history.redo(get().doc);
    if (!result) return;
    get().doc.layers = [...get().doc.layers];
    changed({
      dirty: true,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      ...(result.activeLayerId ? { activeLayerId: result.activeLayerId } : {}),
    });
  },

  // Documents

  loadDoc(doc: Doc, opts: { activeLayerId?: string; palette?: number[]; fileName: string; filePath: string | null; dirty?: boolean }) {
    history.clear();
    for (const layer of doc.layers) markAllDirty(layer);
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

  removeFromPalette(color: number) {
    set((s) => ({ palette: s.palette.filter((c) => c !== color), dirty: true }));
  },

  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),

  // Layers

  setActiveLayer: (activeLayerId: string) => set({ activeLayerId }),

  addLayer(opts: { name?: string; opacity?: number; visible?: boolean; pixels?: Uint32Array } = {}) {
    let created: Layer | undefined;
    changeLayers((doc, active) => {
      const layer = createLayer(doc.width, doc.height, opts.name?.trim() || nextLayerName(doc), opts.pixels);
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
      const { activeLayerId } = history.abortGroup(get().doc);
      get().doc.layers = [...get().doc.layers];
      changed({ dirty: wasDirty, ...(activeLayerId ? { activeLayerId } : {}) });
      throw err;
    } finally {
      set({ canUndo: history.canUndo, canRedo: history.canRedo });
    }
  },

  duplicateLayer() {
    changeLayers((doc, active) => {
      const index = doc.layers.findIndex((l) => l.id === active);
      const source = doc.layers[index];
      const copy = createLayer(doc.width, doc.height, `${source.name} cópia`, source.pixels.slice());
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
    const editor = new PixelEditor(lower, doc.width, doc.height);
    for (let i = 0; i < upper.pixels.length; i++) {
      if (upper.pixels[i] >>> 24) editor.setIndex(i, blendOver(lower.pixels[i], upper.pixels[i], upper.opacity));
    }
    const pixels = editor.toEntry();
    const before = snapshotLayers(doc);
    doc.layers = doc.layers.toSpliced(index, 1);
    const layers: Entry = {
      kind: 'layers',
      before,
      after: snapshotLayers(doc),
      activeBefore: activeLayerId,
      activeAfter: lower.id,
    };
    recorded({ kind: 'group', entries: pixels ? [pixels, layers] : [layers] }, { activeLayerId: lower.id });
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
    const after = snapshotLayers(doc);
    const before: LayerState[] = after.map((s) => (s.layer === layer ? { ...s, opacity: from } : s));
    recorded({ kind: 'layers', before, after, activeBefore: activeLayerId, activeAfter: activeLayerId });
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
