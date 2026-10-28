import { fromBase64, toBase64 } from './base64';
import { parseHex, toHex } from './color';
import { type Doc, MAX_SIZE, createLayer } from './doc';
import { zlibDeflate, zlibInflate } from './png';

/** On-disk `.pontilha` format: JSON with each layer stored as zlib-compressed raw RGBA. */
interface ProjectFile {
  app: 'pontilha';
  version: 1;
  width: number;
  height: number;
  palette: string[];
  activeLayer: number;
  layers: Array<{ name: string; visible: boolean; opacity: number; rgba: string }>;
}

export interface LoadedProject {
  doc: Doc;
  palette: number[];
  activeLayerId: string;
}

export async function serializeProject(doc: Doc, palette: number[], activeLayerId: string): Promise<string> {
  const layers = await Promise.all(
    doc.layers.map(async (layer) => ({
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      rgba: toBase64(await zlibDeflate(new Uint8Array(layer.pixels.buffer, layer.pixels.byteOffset, layer.pixels.byteLength))),
    })),
  );
  const file: ProjectFile = {
    app: 'pontilha',
    version: 1,
    width: doc.width,
    height: doc.height,
    palette: palette.map(toHex),
    activeLayer: Math.max(0, doc.layers.findIndex((l) => l.id === activeLayerId)),
    layers,
  };
  return JSON.stringify(file);
}

export class ProjectError extends Error {}

export async function parseProject(text: string): Promise<LoadedProject> {
  let file: ProjectFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new ProjectError('o arquivo não é um projeto do Pontilha');
  }
  if (file?.app !== 'pontilha') throw new ProjectError('o arquivo não é um projeto do Pontilha');
  if (file.version !== 1) throw new ProjectError(`versão ${file.version} do formato não é suportada`);
  const { width, height } = file;
  const validSize = (n: unknown) => Number.isInteger(n) && (n as number) > 0 && (n as number) <= MAX_SIZE;
  if (!validSize(width) || !validSize(height)) throw new ProjectError('tamanho da imagem inválido');
  if (!Array.isArray(file.layers) || file.layers.length === 0) throw new ProjectError('o projeto não tem camadas');

  const layers = await Promise.all(
    file.layers.map(async (entry, index) => {
      const bytes = await zlibInflate(fromBase64(entry.rgba));
      if (bytes.length !== width * height * 4) throw new ProjectError(`a camada ${index + 1} está corrompida`);
      const pixels = new Uint32Array(width * height);
      new Uint8Array(pixels.buffer).set(bytes);
      const layer = createLayer(width, height, String(entry.name || `Camada ${index + 1}`), pixels);
      layer.visible = entry.visible !== false;
      layer.opacity = Math.min(1, Math.max(0, Number(entry.opacity ?? 1)));
      return layer;
    }),
  );

  const palette = (file.palette ?? []).map(parseHex).filter((c): c is number => c !== null);
  const active = layers[Math.min(layers.length - 1, Math.max(0, file.activeLayer | 0))];
  return { doc: { width, height, layers }, palette, activeLayerId: active.id };
}
