import { type FrameRange, type SheetLayout, renderGif, renderSheet } from '../core/animation';
import { MAX_SIZE, composite, createDoc } from '../core/doc';
import { encodePng, scaleNearest } from '../core/png';
import { parseProject, serializeProject } from '../core/project';
import {
  baseName,
  chooseSavePath,
  decodeImage,
  downloadFile,
  isDesktop,
  pickFile,
  withExtension,
  writeFile,
} from '../platform/files';
import { actions, useApp } from '../state/store';

const PROJECT = { name: 'Pontilha project', extensions: ['pontilha'] };
const PNG = { name: 'PNG image', extensions: ['png'] };
const GIF = { name: 'Animated GIF', extensions: ['gif'] };

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function okToDiscard(): Promise<boolean> {
  if (!useApp.getState().dirty) return true;
  return actions.confirm('The current image has unsaved changes. They will be lost.', 'Discard changes');
}

export async function openFile() {
  if (!(await okToDiscard())) return;
  try {
    const file = await pickFile([{ name: 'Projects and images', extensions: ['pontilha', 'png'] }, PROJECT, PNG]);
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pontilha')) {
      const image = await decodeImage(file.bytes);
      if (image.width > MAX_SIZE || image.height > MAX_SIZE) {
        actions.notify(`The image is ${image.width} × ${image.height} px. The limit is ${MAX_SIZE} px per side.`, 'error');
        return;
      }
      actions.loadDoc(
        createDoc(image.width, image.height, image.pixels),
        { fileName: withExtension(file.name, 'pontilha'), filePath: null },
      );
      actions.notify(`${file.name} opened. Save it as a project to keep layers and palette.`);
      return;
    }

    const project = await parseProject(new TextDecoder().decode(file.bytes));
    actions.loadDoc(project.doc, {
      activeLayerId: project.activeLayerId,
      palette: project.palette,
      recipes: project.recipes,
      fileName: file.name,
      filePath: file.path,
    });
  } catch (err) {
    actions.notify(`Could not open the file: ${reason(err)}.`, 'error');
  }
}

export async function saveProject(saveAs = false) {
  const { doc, palette, activeLayerId, recipes, fileName, filePath } = useApp.getState();
  try {
    const bytes = new TextEncoder().encode(await serializeProject(doc, palette, activeLayerId, recipes));
    const name = withExtension(fileName, 'pontilha');

    if (!isDesktop) {
      downloadFile(name, bytes, 'application/json');
      useApp.setState({ dirty: false, fileName: name });
      return;
    }

    let path = saveAs ? null : filePath;
    if (!path) {
      const chosen = await chooseSavePath(name, [PROJECT]);
      if (!chosen) return;
      path = withExtension(chosen, 'pontilha');
    }
    await writeFile(path, bytes);
    useApp.setState({ filePath: path, fileName: baseName(path), dirty: false });
    actions.notify(`Saved to ${path}`);
  } catch (err) {
    actions.notify(`Could not save: ${reason(err)}.`, 'error');
  }
}

/** The frame on screen, every frame as a sprite sheet, or the animation as a GIF. */
export type ExportKind = 'frame' | 'sheet' | 'gif';

export interface ExportOptions {
  layout?: SheetLayout;
  pingpong?: boolean;
  /** Only these frames (a tag's), for the sheet and the GIF. */
  range?: FrameRange;
  /** Added to the file name, like a tag's name. */
  suffix?: string;
}

async function renderExport(kind: ExportKind, scale: number, opts: ExportOptions) {
  const { doc, fileName } = useApp.getState();
  const stem = fileName.replace(/\.pontilha$/i, '');
  const suffix = `${opts.suffix ? `-${opts.suffix}` : ''}${scale > 1 ? `@${scale}x` : ''}`;
  if (kind === 'gif') {
    const gif = renderGif(doc, { scale, pingpong: opts.pingpong, range: opts.range });
    const note = gif.reduced ? ' Some similar colors were merged to fit the GIF’s 256.' : '';
    return { bytes: gif.bytes, name: `${stem}${suffix}.gif`, filter: GIF, mime: 'image/gif', label: 'GIF', note };
  }
  if (kind === 'sheet') {
    const sheet = renderSheet(doc, opts.layout ?? 'row', scale, opts.range);
    const bytes = await encodePng(new Uint8Array(sheet.pixels.buffer), sheet.width, sheet.height);
    const note = ` ${sheet.cols} × ${sheet.rows} frames of ${sheet.frameWidth} × ${sheet.frameHeight} px.`;
    return { bytes, name: `${stem}-sheet${suffix}.png`, filter: PNG, mime: 'image/png', label: 'Sprite sheet', note };
  }
  const pixels = scaleNearest(composite(doc), doc.width, doc.height, scale);
  const bytes = await encodePng(new Uint8Array(pixels.buffer), doc.width * scale, doc.height * scale);
  return { bytes, name: `${stem}${suffix}.png`, filter: PNG, mime: 'image/png', label: 'PNG', note: '' };
}

export async function exportImage(kind: ExportKind, scale: number, opts: ExportOptions = {}) {
  try {
    const out = await renderExport(kind, scale, opts);
    if (!isDesktop) {
      downloadFile(out.name, out.bytes, out.mime);
      return;
    }
    const chosen = await chooseSavePath(out.name, [out.filter]);
    if (!chosen) return;
    const path = withExtension(chosen, out.filter.extensions[0]);
    await writeFile(path, out.bytes);
    actions.notify(`${out.label} exportado em ${path}.${out.note}`);
  } catch (err) {
    actions.notify(`Could not export: ${reason(err)}.`, 'error');
  }
}
