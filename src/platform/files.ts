import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

/** Running inside the Tauri desktop shell (as opposed to `bun run dev` in a browser). */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface PickedFile {
  name: string;
  /** Absolute path on disk, or null when picked through the browser. */
  path: string | null;
  bytes: Uint8Array;
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function withExtension(name: string, ext: string) {
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name.replace(/\.[^./\\]+$/, '')}.${ext}`;
}

export async function pickFile(filters: FileFilter[]): Promise<PickedFile | null> {
  if (isDesktop) {
    const path = await open({ multiple: false, directory: false, filters });
    if (typeof path !== 'string') return null;
    const buffer = await invoke<ArrayBuffer>('read_file', { path });
    return { name: baseName(path), path, bytes: new Uint8Array(buffer) };
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, path: null, bytes: new Uint8Array(await file.arrayBuffer()) } : null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Asks where to save. Desktop only; the browser build downloads instead. */
export async function chooseSavePath(defaultName: string, filters: FileFilter[]): Promise<string | null> {
  const path = await save({ defaultPath: defaultName, filters });
  return path ?? null;
}

export async function writeFile(path: string, bytes: Uint8Array) {
  await invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
}

export function downloadFile(name: string, bytes: Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Decodes a PNG or other browser-supported image into straight RGBA pixels. */
export async function decodeImage(bytes: Uint8Array): Promise<{ width: number; height: number; pixels: Uint32Array }> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const pixels = new Uint32Array(bitmap.width * bitmap.height);
  new Uint8Array(pixels.buffer).set(data);
  for (let i = 0; i < pixels.length; i++) if (pixels[i] >>> 24 === 0) pixels[i] = 0;
  return { width: bitmap.width, height: bitmap.height, pixels };
}
