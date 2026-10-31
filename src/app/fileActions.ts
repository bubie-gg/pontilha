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

const PROJECT = { name: 'Projeto Pontilha', extensions: ['pontilha'] };
const PNG = { name: 'Imagem PNG', extensions: ['png'] };
const GIF = { name: 'GIF animado', extensions: ['gif'] };

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function okToDiscard(): Promise<boolean> {
  if (!useApp.getState().dirty) return true;
  return actions.confirm('A imagem atual tem alterações não salvas. Elas serão perdidas.', 'Descartar alterações');
}

export async function openFile() {
  if (!(await okToDiscard())) return;
  try {
    const file = await pickFile([{ name: 'Projetos e imagens', extensions: ['pontilha', 'png'] }, PROJECT, PNG]);
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pontilha')) {
      const image = await decodeImage(file.bytes);
      if (image.width > MAX_SIZE || image.height > MAX_SIZE) {
        actions.notify(`A imagem tem ${image.width} × ${image.height} px. O limite é ${MAX_SIZE} px por lado.`, 'error');
        return;
      }
      actions.loadDoc(
        createDoc(image.width, image.height, image.pixels),
        { fileName: withExtension(file.name, 'pontilha'), filePath: null },
      );
      actions.notify(`${file.name} aberto. Salve como projeto para guardar camadas e paleta.`);
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
    actions.notify(`Não foi possível abrir o arquivo: ${reason(err)}.`, 'error');
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
    actions.notify(`Salvo em ${path}`);
  } catch (err) {
    actions.notify(`Não foi possível salvar: ${reason(err)}.`, 'error');
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
    const note = gif.reduced ? ' Algumas cores parecidas foram unidas para caber nas 256 do GIF.' : '';
    return { bytes: gif.bytes, name: `${stem}${suffix}.gif`, filter: GIF, mime: 'image/gif', label: 'GIF', note };
  }
  if (kind === 'sheet') {
    const sheet = renderSheet(doc, opts.layout ?? 'row', scale, opts.range);
    const bytes = await encodePng(new Uint8Array(sheet.pixels.buffer), sheet.width, sheet.height);
    const note = ` ${sheet.cols} × ${sheet.rows} quadros de ${sheet.frameWidth} × ${sheet.frameHeight} px.`;
    return { bytes, name: `${stem}-folha${suffix}.png`, filter: PNG, mime: 'image/png', label: 'Folha de sprites', note };
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
    actions.notify(`Não foi possível exportar: ${reason(err)}.`, 'error');
  }
}
