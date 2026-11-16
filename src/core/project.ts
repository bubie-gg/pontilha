import { fromBase64, toBase64 } from './base64';
import { parseHex, toHex } from './color';
import {
  DEFAULT_DURATION,
  type Doc,
  type Layer,
  MAX_FRAMES,
  MAX_SIZE,
  celOf,
  clampDuration,
  composite,
  createFrame,
  newLayerId,
  newTagId,
  showFrame,
  tagRange,
} from './doc';
import { thumbnail } from './effects';
import { encodePng, zlibDeflate, zlibInflate } from './png';

/**
 * On-disk `.pontilha` format: JSON with every cel stored as zlib-compressed raw RGBA.
 * Version 1 had no frames: one `rgba` per layer. Version 2 has `frames` and one
 * entry in `cels` per frame, in playback order. Both still open.
 */
interface ProjectFileV1 {
  app: 'pontilha';
  version: 1;
  width: number;
  height: number;
  palette: string[];
  activeLayer: number;
  layers: Array<{ name: string; visible: boolean; opacity: number; rgba: string }>;
}

interface ProjectFileV2 {
  app: 'pontilha';
  version: 2;
  width: number;
  height: number;
  palette: string[];
  activeLayer: number;
  activeFrame: number;
  frames: Array<{ duration: number }>;
  layers: Array<{ name: string; visible: boolean; opacity: number; cels: string[] }>;
  /** Named stretches of frames by index, both ends included. Optional: older files have none. */
  tags?: Array<{ name: string; from: number; to: number }>;
  /** Recorded command lists that can be replayed with other colours. Optional. */
  recipes?: Recipe[];
  /** PNG (base64) of the first frame, at most 128 px a side, for galleries. Ignored when opening. */
  thumbnail?: string;
}

/** A named list of commands, recorded while drawing, that `recipe.run` plays back. */
export interface Recipe {
  name: string;
  steps: Array<{ method: string; params: Record<string, unknown> }>;
}

export interface LoadedProject {
  doc: Doc;
  palette: number[];
  activeLayerId: string;
  recipes: Recipe[];
}

const encodeCel = async (cel: Uint32Array) =>
  toBase64(await zlibDeflate(new Uint8Array(cel.buffer, cel.byteOffset, cel.byteLength)));

async function thumbnailPng(doc: Doc): Promise<string> {
  const thumb = thumbnail(composite(doc, doc.frames[0].id), doc.width, doc.height);
  return toBase64(await encodePng(new Uint8Array(thumb.pixels.buffer), thumb.width, thumb.height));
}

export async function serializeProject(doc: Doc, palette: number[], activeLayerId: string, recipes: Recipe[] = []): Promise<string> {
  const layers = await Promise.all(
    doc.layers.map(async (layer) => ({
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      cels: await Promise.all(doc.frames.map((f) => encodeCel(celOf(doc, layer, f.id)))),
    })),
  );
  const file: ProjectFileV2 = {
    app: 'pontilha',
    version: 2,
    width: doc.width,
    height: doc.height,
    palette: palette.map(toHex),
    activeLayer: Math.max(0, doc.layers.findIndex((l) => l.id === activeLayerId)),
    activeFrame: Math.max(0, doc.frames.findIndex((f) => f.id === doc.frame)),
    frames: doc.frames.map((f) => ({ duration: f.duration })),
    layers,
    tags: doc.tags.flatMap((t) => {
      const range = tagRange(doc, t);
      return range ? [{ name: t.name, from: range[0], to: range[1] }] : [];
    }),
    ...(recipes.length ? { recipes } : {}),
    thumbnail: await thumbnailPng(doc),
  };
  return JSON.stringify(file);
}

export class ProjectError extends Error {}

export async function parseProject(text: string): Promise<LoadedProject> {
  let file: ProjectFileV1 | ProjectFileV2;
  try {
    file = JSON.parse(text);
  } catch {
    throw new ProjectError('the file is not a Pontilha project');
  }
  if (file?.app !== 'pontilha') throw new ProjectError('the file is not a Pontilha project');
  if (file.version !== 1 && file.version !== 2) {
    throw new ProjectError(`format version ${(file as { version?: unknown }).version} is not supported; update Pontilha`);
  }
  const { width, height } = file;
  const validSize = (n: unknown) => Number.isInteger(n) && (n as number) > 0 && (n as number) <= MAX_SIZE;
  if (!validSize(width) || !validSize(height)) throw new ProjectError('invalid image size');
  if (!Array.isArray(file.layers) || file.layers.length === 0) throw new ProjectError('the project has no layers');

  // Version 1 is a version 2 file with a single frame.
  const v2: ProjectFileV2 =
    file.version === 2
      ? file
      : {
          ...file,
          version: 2,
          activeFrame: 0,
          frames: [{ duration: DEFAULT_DURATION }],
          layers: file.layers.map(({ rgba, ...rest }) => ({ ...rest, cels: [rgba] })),
        };
  if (!Array.isArray(v2.frames) || v2.frames.length === 0) throw new ProjectError('the project has no frames');
  if (v2.frames.length > MAX_FRAMES) throw new ProjectError(`the project has more than ${MAX_FRAMES} frames`);

  const frames = v2.frames.map((f) => createFrame(clampDuration(Number(f?.duration) || DEFAULT_DURATION)));
  const decode = async (data: unknown, where: string) => {
    if (typeof data !== 'string') throw new ProjectError(`${where} is corrupted`);
    const bytes = await zlibInflate(fromBase64(data));
    if (bytes.length !== width * height * 4) throw new ProjectError(`${where} is corrupted`);
    const pixels = new Uint32Array(width * height);
    new Uint8Array(pixels.buffer).set(bytes);
    return pixels;
  };

  const layers = await Promise.all(
    v2.layers.map(async (entry, index): Promise<Layer> => {
      if (!Array.isArray(entry.cels) || entry.cels.length !== frames.length) {
        throw new ProjectError(`layer ${index + 1} does not have an image for every frame`);
      }
      const cels = new Map(
        await Promise.all(
          frames.map(async (f, i) => [f.id, await decode(entry.cels[i], `frame ${i + 1} of layer ${index + 1}`)] as const),
        ),
      );
      return {
        id: newLayerId(),
        name: String(entry.name || `Layer ${index + 1}`),
        visible: entry.visible !== false,
        opacity: Math.min(1, Math.max(0, Number(entry.opacity ?? 1))),
        cels,
        pixels: cels.get(frames[0].id)!,
        rev: 0,
        dirty: 'all',
      };
    }),
  );

  const frameAt = (i: unknown) => (Number.isInteger(i) ? frames[i as number] : undefined);
  const tags = (Array.isArray(v2.tags) ? v2.tags : []).flatMap((t) => {
    const from = frameAt(t?.from);
    const to = frameAt(t?.to);
    return from && to ? [{ id: newTagId(), name: String(t.name || 'Tag'), from: from.id, to: to.id }] : [];
  });
  const doc: Doc = { width, height, layers, frames, frame: frames[0].id, tags };
  showFrame(doc, frames[Math.min(frames.length - 1, Math.max(0, v2.activeFrame | 0))].id);
  const palette = (v2.palette ?? []).map(parseHex).filter((c): c is number => c !== null);
  const active = layers[Math.min(layers.length - 1, Math.max(0, v2.activeLayer | 0))];
  const recipes = (Array.isArray(v2.recipes) ? v2.recipes : []).flatMap((r) =>
    r && typeof r.name === 'string' && Array.isArray(r.steps)
      ? [{ name: r.name, steps: r.steps.filter((st) => st && typeof st.method === 'string').map((st) => ({ method: st.method, params: st.params ?? {} })) }]
      : [],
  );
  return { doc, palette, activeLayerId: active.id, recipes };
}
