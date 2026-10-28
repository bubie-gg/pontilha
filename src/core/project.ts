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
  createFrame,
  newLayerId,
  showFrame,
} from './doc';
import { zlibDeflate, zlibInflate } from './png';

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
}

export interface LoadedProject {
  doc: Doc;
  palette: number[];
  activeLayerId: string;
}

const encodeCel = async (cel: Uint32Array) =>
  toBase64(await zlibDeflate(new Uint8Array(cel.buffer, cel.byteOffset, cel.byteLength)));

export async function serializeProject(doc: Doc, palette: number[], activeLayerId: string): Promise<string> {
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
  };
  return JSON.stringify(file);
}

export class ProjectError extends Error {}

export async function parseProject(text: string): Promise<LoadedProject> {
  let file: ProjectFileV1 | ProjectFileV2;
  try {
    file = JSON.parse(text);
  } catch {
    throw new ProjectError('o arquivo não é um projeto do Pontilha');
  }
  if (file?.app !== 'pontilha') throw new ProjectError('o arquivo não é um projeto do Pontilha');
  if (file.version !== 1 && file.version !== 2) {
    throw new ProjectError(`versão ${(file as { version?: unknown }).version} do formato não é suportada; atualize o Pontilha`);
  }
  const { width, height } = file;
  const validSize = (n: unknown) => Number.isInteger(n) && (n as number) > 0 && (n as number) <= MAX_SIZE;
  if (!validSize(width) || !validSize(height)) throw new ProjectError('tamanho da imagem inválido');
  if (!Array.isArray(file.layers) || file.layers.length === 0) throw new ProjectError('o projeto não tem camadas');

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
  if (!Array.isArray(v2.frames) || v2.frames.length === 0) throw new ProjectError('o projeto não tem quadros');
  if (v2.frames.length > MAX_FRAMES) throw new ProjectError(`o projeto tem mais de ${MAX_FRAMES} quadros`);

  const frames = v2.frames.map((f) => createFrame(clampDuration(Number(f?.duration) || DEFAULT_DURATION)));
  const decode = async (data: unknown, where: string) => {
    if (typeof data !== 'string') throw new ProjectError(`${where} está corrompido`);
    const bytes = await zlibInflate(fromBase64(data));
    if (bytes.length !== width * height * 4) throw new ProjectError(`${where} está corrompido`);
    const pixels = new Uint32Array(width * height);
    new Uint8Array(pixels.buffer).set(bytes);
    return pixels;
  };

  const layers = await Promise.all(
    v2.layers.map(async (entry, index): Promise<Layer> => {
      if (!Array.isArray(entry.cels) || entry.cels.length !== frames.length) {
        throw new ProjectError(`a camada ${index + 1} não tem uma imagem para cada quadro`);
      }
      const cels = new Map(
        await Promise.all(
          frames.map(async (f, i) => [f.id, await decode(entry.cels[i], `o quadro ${i + 1} da camada ${index + 1}`)] as const),
        ),
      );
      return {
        id: newLayerId(),
        name: String(entry.name || `Camada ${index + 1}`),
        visible: entry.visible !== false,
        opacity: Math.min(1, Math.max(0, Number(entry.opacity ?? 1))),
        cels,
        pixels: cels.get(frames[0].id)!,
        rev: 0,
        dirty: 'all',
      };
    }),
  );

  const doc: Doc = { width, height, layers, frames, frame: frames[0].id };
  showFrame(doc, frames[Math.min(frames.length - 1, Math.max(0, v2.activeFrame | 0))].id);
  const palette = (v2.palette ?? []).map(parseHex).filter((c): c is number => c !== null);
  const active = layers[Math.min(layers.length - 1, Math.max(0, v2.activeLayer | 0))];
  return { doc, palette, activeLayerId: active.id };
}
