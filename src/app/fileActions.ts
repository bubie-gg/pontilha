import { MAX_SIZE, composite, createLayer } from '../core/doc';
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
      const layer = createLayer(image.width, image.height, 'Camada 1', image.pixels);
      actions.loadDoc(
        { width: image.width, height: image.height, layers: [layer] },
        { fileName: withExtension(file.name, 'pontilha'), filePath: null },
      );
      actions.notify(`${file.name} aberto. Salve como projeto para guardar camadas e paleta.`);
      return;
    }

    const project = await parseProject(new TextDecoder().decode(file.bytes));
    actions.loadDoc(project.doc, {
      activeLayerId: project.activeLayerId,
      palette: project.palette,
      fileName: file.name,
      filePath: file.path,
    });
  } catch (err) {
    actions.notify(`Não foi possível abrir o arquivo: ${reason(err)}.`, 'error');
  }
}

export async function saveProject(saveAs = false) {
  const { doc, palette, activeLayerId, fileName, filePath } = useApp.getState();
  try {
    const bytes = new TextEncoder().encode(await serializeProject(doc, palette, activeLayerId));
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

export async function exportPng(scale: number) {
  const { doc, fileName } = useApp.getState();
  try {
    const pixels = scaleNearest(composite(doc), doc.width, doc.height, scale);
    const png = await encodePng(new Uint8Array(pixels.buffer), doc.width * scale, doc.height * scale);
    const stem = fileName.replace(/\.pontilha$/i, '');
    const name = `${stem}${scale > 1 ? `@${scale}x` : ''}.png`;

    if (!isDesktop) {
      downloadFile(name, png, 'image/png');
      return;
    }
    const chosen = await chooseSavePath(name, [PNG]);
    if (!chosen) return;
    const path = withExtension(chosen, 'png');
    await writeFile(path, png);
    actions.notify(`PNG exportado em ${path}`);
  } catch (err) {
    actions.notify(`Não foi possível exportar: ${reason(err)}.`, 'error');
  }
}
