import { type Doc, type Frame, type Layer, celOf, markAllDirty, showFrame } from './doc';
import type { Selection } from './transform';

export interface LayerState {
  layer: Layer;
  name: string;
  visible: boolean;
  opacity: number;
  cels: Map<string, Uint32Array>;
}

/**
 * Size, layers, frames and the frame on screen. Cels are shared, not copied: their
 * pixels are tracked by pixel entries, and resizing swaps in new cels instead of
 * changing the old ones.
 */
export interface DocState {
  width: number;
  height: number;
  layers: LayerState[];
  frames: Frame[];
  frame: string;
}

export type Entry =
  | { kind: 'pixels'; layer: Layer; frame: string; indices: Uint32Array; before: Uint32Array; after: Uint32Array }
  | { kind: 'structure'; before: DocState; after: DocState; activeBefore: string; activeAfter: string }
  /** The selection moving with the pixels it holds, so undo puts it back too. */
  | { kind: 'selection'; before: Selection | null; after: Selection | null }
  | { kind: 'group'; entries: Entry[] };

/** What undo or redo touched, so the editor can show it: a layer to activate, a frame to go to, a selection. */
export interface Focus {
  layer?: string;
  frame?: string;
  /** Present only when the entry changed the selection; null means nothing selected. */
  selection?: Selection | null;
}

export function snapshot(doc: Doc): DocState {
  return {
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map((layer) => ({
      layer,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      cels: new Map(layer.cels),
    })),
    frames: doc.frames.map((f) => ({ ...f })),
    frame: doc.frame,
  };
}

function restore(doc: Doc, state: DocState) {
  doc.width = state.width;
  doc.height = state.height;
  doc.layers = state.layers.map((s) => {
    s.layer.name = s.name;
    s.layer.visible = s.visible;
    s.layer.opacity = s.opacity;
    s.layer.cels = new Map(s.cels);
    return s.layer;
  });
  doc.frames = state.frames.map((f) => ({ ...f }));
  showFrame(doc, state.frame);
}

/** Applies an entry in one direction and returns what it touched. */
function apply(doc: Doc, entry: Entry, undo: boolean): Focus {
  switch (entry.kind) {
    case 'pixels': {
      const values = undo ? entry.before : entry.after;
      const px = celOf(doc, entry.layer, entry.frame);
      for (let i = 0; i < entry.indices.length; i++) px[entry.indices[i]] = values[i];
      markAllDirty(entry.layer);
      return { frame: entry.frame };
    }
    case 'structure':
      restore(doc, undo ? entry.before : entry.after);
      return { layer: undo ? entry.activeBefore : entry.activeAfter, frame: doc.frame };
    case 'selection':
      return { selection: undo ? entry.before : entry.after };
    case 'group': {
      const focus: Focus = {};
      const list = undo ? [...entry.entries].reverse() : entry.entries;
      for (const e of list) Object.assign(focus, apply(doc, e, undo));
      return focus;
    }
  }
}

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private groupDepth = 0;
  private grouped: Entry[] = [];

  constructor(private readonly limit = 300) {}

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  push(entry: Entry) {
    if (this.groupDepth > 0) {
      this.grouped.push(entry);
      return;
    }
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Until the matching endGroup, pushed entries are collected into a single undo step. */
  beginGroup() {
    this.groupDepth++;
  }

  /** Closes a group; returns true if it recorded an undo step. */
  endGroup(): boolean {
    if (this.groupDepth === 0) return false;
    this.groupDepth--;
    if (this.groupDepth > 0 || this.grouped.length === 0) return false;
    const entries = this.grouped;
    this.grouped = [];
    this.push(entries.length === 1 ? entries[0] : { kind: 'group', entries });
    return true;
  }

  /** Closes a group without recording it, reverting everything applied inside it. */
  abortGroup(doc: Doc): Focus {
    if (this.groupDepth === 0) return {};
    this.groupDepth--;
    if (this.groupDepth > 0) return {};
    const entries = this.grouped;
    this.grouped = [];
    const focus: Focus = {};
    for (const entry of [...entries].reverse()) Object.assign(focus, apply(doc, entry, true));
    return focus;
  }

  undo(doc: Doc): Focus | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return apply(doc, entry, true);
  }

  redo(doc: Doc): Focus | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return apply(doc, entry, false);
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
