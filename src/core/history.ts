import { type Doc, type Layer, markAllDirty } from './doc';

export interface LayerState {
  layer: Layer;
  name: string;
  visible: boolean;
  opacity: number;
}

export type Entry =
  | { kind: 'pixels'; layer: Layer; indices: Uint32Array; before: Uint32Array; after: Uint32Array }
  | { kind: 'layers'; before: LayerState[]; after: LayerState[]; activeBefore: string; activeAfter: string }
  | { kind: 'group'; entries: Entry[] };

export function snapshotLayers(doc: Doc): LayerState[] {
  return doc.layers.map((layer) => ({
    layer,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
  }));
}

function restoreLayers(doc: Doc, states: LayerState[]) {
  doc.layers = states.map((s) => {
    s.layer.name = s.name;
    s.layer.visible = s.visible;
    s.layer.opacity = s.opacity;
    return s.layer;
  });
}

/** Applies an entry in one direction and returns the layer that should become active, if any. */
function apply(doc: Doc, entry: Entry, undo: boolean): string | undefined {
  switch (entry.kind) {
    case 'pixels': {
      const values = undo ? entry.before : entry.after;
      const px = entry.layer.pixels;
      for (let i = 0; i < entry.indices.length; i++) px[entry.indices[i]] = values[i];
      markAllDirty(entry.layer);
      return undefined;
    }
    case 'layers':
      restoreLayers(doc, undo ? entry.before : entry.after);
      return undo ? entry.activeBefore : entry.activeAfter;
    case 'group': {
      let active: string | undefined;
      const list = undo ? [...entry.entries].reverse() : entry.entries;
      for (const e of list) active = apply(doc, e, undo) ?? active;
      return active;
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
  abortGroup(doc: Doc): { activeLayerId?: string } {
    if (this.groupDepth === 0) return {};
    this.groupDepth--;
    if (this.groupDepth > 0) return {};
    const entries = this.grouped;
    this.grouped = [];
    let activeLayerId: string | undefined;
    for (const entry of [...entries].reverse()) activeLayerId = apply(doc, entry, true) ?? activeLayerId;
    return { activeLayerId };
  }

  undo(doc: Doc): { activeLayerId?: string } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return { activeLayerId: apply(doc, entry, true) };
  }

  redo(doc: Doc): { activeLayerId?: string } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return { activeLayerId: apply(doc, entry, false) };
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
