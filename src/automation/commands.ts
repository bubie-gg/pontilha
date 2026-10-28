import { renderGif, renderSheet, sheetGrid } from '../core/animation';
import { fromBase64, toBase64 } from '../core/base64';
import { parseHex, sameColor, toHex } from '../core/color';
import { type Frame, type Layer, MAX_SIZE, celOf, composite, createDoc, frameIndex } from '../core/doc';
import { PixelEditor } from '../core/editor';
import { encodePng, scaleNearest } from '../core/png';
import { parseProject, serializeProject } from '../core/project';
import {
  type Point,
  brushOffsets,
  burstCells,
  ellipseCells,
  floodFill,
  line,
  outlineIndices,
  polygonCells,
  rectCells,
  regularPolygonPoints,
  snapToPerfectAngle,
  starCells,
} from '../core/raster';
import type { ToolId } from '../core/tools';
import { ANCHORS, type Anchor, contentBounds } from '../core/transform';
import { decodeImage } from '../platform/files';
import { type Target, ZOOM_LEVELS, actions, activeLayer, useApp } from '../state/store';

/**
 * Commands scripts and agents can run over the control port. Every command that
 * changes the image records exactly one undo step; `batch` records one for all.
 */

export class CommandError extends Error {}

export type Params = Record<string, unknown>;

interface Command {
  summary: string;
  /** Parameter list as shown by `commands.list`; `?` marks optional ones. */
  params: string;
  /** Read-only commands don't announce themselves in the status bar. */
  readOnly?: boolean;
  run: (p: Params) => unknown;
}

const VERSION = '0.1.0';

function fail(message: string): never {
  throw new CommandError(message);
}

function has(p: Params, key: string) {
  return p[key] !== undefined && p[key] !== null;
}

function num(p: Params, key: string, fallback?: number): number {
  if (!has(p, key)) {
    if (fallback === undefined) fail(`o parâmetro "${key}" é obrigatório`);
    return fallback;
  }
  const v = p[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`"${key}" precisa ser um número, recebi ${JSON.stringify(v)}`);
  return v;
}

const int = (p: Params, key: string, fallback?: number) => Math.round(num(p, key, fallback));

function bool(p: Params, key: string, fallback: boolean): boolean {
  if (!has(p, key)) return fallback;
  if (typeof p[key] !== 'boolean') fail(`"${key}" precisa ser true ou false`);
  return p[key] as boolean;
}

function text(p: Params, key: string, fallback?: string): string {
  if (!has(p, key)) {
    if (fallback === undefined) fail(`o parâmetro "${key}" é obrigatório`);
    return fallback;
  }
  if (typeof p[key] !== 'string') fail(`"${key}" precisa ser texto`);
  return p[key] as string;
}

function colorValue(value: unknown, key: string): number {
  if (value === null || value === 'transparent') return 0;
  if (typeof value !== 'string') fail(`"${key}" precisa ser uma cor como "#c93c4a" ou "transparent"`);
  const c = parseHex(value);
  if (c === null) fail(`cor inválida em "${key}": ${value}. Use #rrggbb, #rrggbbaa ou "transparent".`);
  return c;
}

function requiredColor(p: Params, key: string): number {
  if (p[key] === undefined) fail(`o parâmetro "${key}" é obrigatório`);
  return colorValue(p[key], key);
}

/** `color` param, defaulting to the current primary colour. */
function color(p: Params, key = 'color'): number {
  return p[key] === undefined ? useApp.getState().primary : colorValue(p[key], key);
}

function layerRef(ref: unknown): Layer {
  const { doc } = useApp.getState();
  const layer = doc.layers.find((l) => l.id === ref) ?? doc.layers.find((l) => l.name === ref);
  if (!layer) fail(`camada não encontrada: ${JSON.stringify(ref)}. Camadas: ${doc.layers.map((l) => l.name).join(', ')}`);
  return layer;
}

function frameRef(ref: unknown): Frame {
  const { doc } = useApp.getState();
  const frame =
    typeof ref === 'number' && Number.isInteger(ref) ? doc.frames[ref - 1] : doc.frames.find((f) => f.id === ref);
  if (!frame) fail(`quadro não encontrado: ${JSON.stringify(ref)}. Use o número (1 a ${doc.frames.length}) ou o id.`);
  return frame;
}

/** `frame` param (number from 1, or id), defaulting to the frame on screen. */
function targetFrame(p: Params): Frame {
  const { doc } = useApp.getState();
  return has(p, 'frame') ? frameRef(p.frame) : doc.frames[frameIndex(doc)];
}

/** `layer` and `frame` params as the cel a selection command works on. */
function selectionTarget(p: Params): Target {
  const { doc } = useApp.getState();
  const layer = targetLayer(p);
  return { layer, cel: celOf(doc, layer, targetFrame(p).id) };
}

function frameInfo(frame: Frame, index: number) {
  return { id: frame.id, number: index + 1, duration: frame.duration };
}

/** `layer` param (id or name), defaulting to the active layer. */
function targetLayer(p: Params): Layer {
  return has(p, 'layer') ? layerRef(p.layer) : activeLayer();
}

function layerInfo(layer: Layer, index: number) {
  let painted = 0;
  for (const px of layer.pixels) if (px >>> 24) painted++;
  return { id: layer.id, name: layer.name, index, visible: layer.visible, opacity: layer.opacity, painted };
}

function inspect() {
  const s = useApp.getState();
  return {
    width: s.doc.width,
    height: s.doc.height,
    fileName: s.fileName,
    dirty: s.dirty,
    activeLayer: activeLayer().name,
    layers: s.doc.layers.map(layerInfo).reverse(),
    frame: frameIndex(s.doc) + 1,
    frames: s.doc.frames.map(frameInfo),
    selection: s.selection,
    primary: toHex(s.primary),
    secondary: toHex(s.secondary),
    palette: s.palette.map(toHex),
    tool: s.tool,
    canUndo: s.canUndo,
    canRedo: s.canRedo,
  };
}

/**
 * `onlyOn` limits painting to pixels that were, before this command, already
 * painted ("painted"), empty ("transparent") or of one colour. It is how shading
 * stays inside a shape: paint the shape, then paint shadows only on its colour.
 */
function maskFor(p: Params, cel: Uint32Array): ((index: number) => boolean) | null {
  if (!has(p, 'onlyOn')) return null;
  const before = cel.slice();
  if (p.onlyOn === 'painted') return (i) => before[i] >>> 24 !== 0;
  if (p.onlyOn === 'transparent') return (i) => before[i] >>> 24 === 0;
  const only = colorValue(p.onlyOn, 'onlyOn');
  return (i) => sameColor(before[i], only);
}

/** Draws through a PixelEditor on the target layer and frame, and records the result as one undo step. */
function paint(p: Params, draw: (editor: PixelEditor, width: number, height: number) => void) {
  const { doc } = useApp.getState();
  const layer = targetLayer(p);
  const cel = celOf(doc, layer, targetFrame(p).id);
  const editor = new PixelEditor(layer, doc.width, doc.height, cel);
  editor.allow = maskFor(p, cel);
  draw(editor, doc.width, doc.height);
  const entry = editor.toEntry();
  actions.commit(entry);
  return { layer: layer.name, changed: entry?.kind === 'pixels' ? entry.indices.length : 0 };
}

function guardUnsaved(p: Params) {
  if (useApp.getState().dirty && !bool(p, 'discard', false)) {
    fail('a imagem aberta tem alterações não salvas. Salve antes ou passe discard: true para descartá-las.');
  }
}

function checkSize(width: number, height: number) {
  if (width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) {
    fail(`tamanho ${width} × ${height} fora do limite de 1 a ${MAX_SIZE} px`);
  }
}

const ASCII_KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const COMMANDS: Record<string, Command> = {
  'app.info': {
    summary: 'Versão do app e nomes dos comandos.',
    params: '',
    readOnly: true,
    run: () => ({ app: 'pontilha', version: VERSION, commands: Object.keys(COMMANDS).concat('batch') }),
  },

  'commands.list': {
    summary: 'Lista os comandos com parâmetros. filter procura no nome e na descrição.',
    params: 'filter?',
    readOnly: true,
    run: (p) => {
      const filter = text(p, 'filter', '').toLowerCase();
      return Object.entries(COMMANDS)
        .filter(([id, c]) => !filter || id.includes(filter) || c.summary.toLowerCase().includes(filter))
        .map(([id, c]) => ({ id, params: c.params, summary: c.summary }))
        .concat(
          !filter || 'batch'.includes(filter)
            ? [{ id: 'batch', params: 'commands: [{method, params}], label?', summary: 'Executa vários comandos como um único passo de desfazer. Se um falhar, nada é aplicado.' }]
            : [],
        );
    },
  },

  // Document

  'doc.inspect': {
    summary: 'Tamanho, camadas (a de cima primeiro), cores, paleta e estado do histórico.',
    params: '',
    readOnly: true,
    run: inspect,
  },

  'doc.new': {
    summary: 'Cria uma imagem vazia. Recusa se houver alterações não salvas, a menos que discard seja true.',
    params: 'width, height, name?, discard?',
    run: (p) => {
      const width = int(p, 'width');
      const height = int(p, 'height');
      checkSize(width, height);
      guardUnsaved(p);
      actions.newDoc(width, height);
      if (has(p, 'name')) useApp.setState({ fileName: text(p, 'name') });
      return inspect();
    },
  },

  'doc.ascii': {
    summary: 'Desenha a imagem (ou uma camada) como texto: uma letra por cor, ponto para transparente.',
    params: 'layer?, frame?, x?, y?, w?, h?',
    readOnly: true,
    run: (p) => {
      const { doc } = useApp.getState();
      const x0 = int(p, 'x', 0);
      const y0 = int(p, 'y', 0);
      const w = Math.min(int(p, 'w', doc.width - x0), doc.width - x0);
      const h = Math.min(int(p, 'h', doc.height - y0), doc.height - y0);
      if (w * h > 128 * 128) fail('região grande demais para texto; peça no máximo 128 × 128 com x, y, w, h');
      const frame = targetFrame(p).id;
      const pixels = has(p, 'layer') ? celOf(doc, layerRef(p.layer), frame) : composite(doc, frame);
      const keys = new Map<number, string>();
      const rows: string[] = [];
      for (let y = y0; y < y0 + h; y++) {
        let row = '';
        for (let x = x0; x < x0 + w; x++) {
          const c = pixels[y * doc.width + x];
          if (c >>> 24 === 0) {
            row += '.';
            continue;
          }
          if (!keys.has(c)) keys.set(c, ASCII_KEYS[keys.size] ?? '?');
          row += keys.get(c);
        }
        rows.push(row);
      }
      return { rows, legend: Object.fromEntries([...keys].map(([c, k]) => [k, toHex(c)])) };
    },
  },

  // Layers

  'layer.new': {
    summary: 'Cria uma camada acima da ativa e a torna ativa.',
    params: 'name?, opacity?, visible?',
    run: (p) => {
      const layer = actions.addLayer({
        name: has(p, 'name') ? text(p, 'name') : undefined,
        opacity: has(p, 'opacity') ? num(p, 'opacity') : undefined,
        visible: has(p, 'visible') ? bool(p, 'visible', true) : undefined,
      });
      return layerInfo(layer, useApp.getState().doc.layers.indexOf(layer));
    },
  },

  'layer.import': {
    summary: 'Cria uma camada com uma imagem PNG (base64), posicionada em x, y. Útil para referências a 50%.',
    params: 'png, name?, x?, y?, opacity?, visible?',
    run: async (p) => {
      const { doc } = useApp.getState();
      const image = await decodeImage(fromBase64(text(p, 'png')));
      const ox = int(p, 'x', 0);
      const oy = int(p, 'y', 0);
      const pixels = new Uint32Array(doc.width * doc.height);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const tx = x + ox;
          const ty = y + oy;
          if (tx >= 0 && ty >= 0 && tx < doc.width && ty < doc.height) pixels[ty * doc.width + tx] = image.pixels[y * image.width + x];
        }
      }
      const layer = actions.addLayer({
        name: has(p, 'name') ? text(p, 'name') : 'Referência',
        opacity: num(p, 'opacity', 1),
        visible: bool(p, 'visible', true),
        pixels,
      });
      return { ...layerInfo(layer, useApp.getState().doc.layers.indexOf(layer)), imageWidth: image.width, imageHeight: image.height };
    },
  },

  'layer.select': {
    summary: 'Torna ativa a camada indicada por nome ou id.',
    params: 'layer',
    run: (p) => {
      if (!has(p, 'layer')) fail('o parâmetro "layer" é obrigatório');
      const layer = layerRef(p.layer);
      actions.setActiveLayer(layer.id);
      return { active: layer.name };
    },
  },

  'layer.setProps': {
    summary: 'Muda nome, opacidade (0 a 1) ou visibilidade de uma camada.',
    params: 'layer?, name?, opacity?, visible?',
    run: (p) => {
      const layer = targetLayer(p);
      actions.updateLayer(layer.id, {
        name: has(p, 'name') ? text(p, 'name') : undefined,
        opacity: has(p, 'opacity') ? num(p, 'opacity') : undefined,
        visible: has(p, 'visible') ? bool(p, 'visible', true) : undefined,
      });
      return layerInfo(layer, useApp.getState().doc.layers.indexOf(layer));
    },
  },

  'layer.delete': {
    summary: 'Exclui uma camada (a imagem mantém pelo menos uma).',
    params: 'layer?',
    run: (p) => {
      const layer = targetLayer(p);
      if (useApp.getState().doc.layers.length === 1) fail('a imagem precisa de pelo menos uma camada');
      actions.setActiveLayer(layer.id);
      actions.deleteLayer();
      return { deleted: layer.name, active: activeLayer().name };
    },
  },

  'layer.duplicate': {
    summary: 'Duplica uma camada logo acima dela.',
    params: 'layer?',
    run: (p) => {
      actions.setActiveLayer(targetLayer(p).id);
      actions.duplicateLayer();
      const copy = activeLayer();
      return layerInfo(copy, useApp.getState().doc.layers.indexOf(copy));
    },
  },

  'layer.move': {
    summary: 'Sobe ou desce uma camada uma posição.',
    params: 'layer?, direction: "up" | "down"',
    run: (p) => {
      const direction = text(p, 'direction');
      if (direction !== 'up' && direction !== 'down') fail('direction precisa ser "up" ou "down"');
      const layer = targetLayer(p);
      actions.setActiveLayer(layer.id);
      actions.moveLayer(direction === 'up' ? 1 : -1);
      return { layer: layer.name, index: useApp.getState().doc.layers.indexOf(layer) };
    },
  },

  'layer.mergeDown': {
    summary: 'Mescla uma camada visível com a de baixo.',
    params: 'layer?',
    run: (p) => {
      const layer = targetLayer(p);
      const { doc } = useApp.getState();
      if (doc.layers.indexOf(layer) === 0) fail('não há camada abaixo para mesclar');
      if (!layer.visible) fail('mostre a camada antes de mesclar');
      actions.setActiveLayer(layer.id);
      actions.mergeDown();
      return { active: activeLayer().name };
    },
  },

  'layer.clear': {
    summary: 'Apaga todos os pixels de uma camada no quadro atual (ou em frame).',
    params: 'layer?, frame?',
    run: (p) =>
      paint(p, (editor, width, height) => {
        for (let i = 0; i < width * height; i++) editor.setIndex(i, 0);
      }),
  },

  // Frames. Every layer has an image in every frame; draw commands paint on the frame on screen unless given frame.

  'frame.new': {
    summary: 'Cria um quadro logo depois do atual e passa a mostrá-lo. copy true copia o quadro atual; sem copy ele começa vazio.',
    params: 'copy?, duration?',
    run: (p) => {
      const frame = actions.addFrame({ copy: bool(p, 'copy', false), duration: has(p, 'duration') ? num(p, 'duration') : undefined });
      if (!frame) fail('a animação já tem o máximo de quadros');
      const { doc } = useApp.getState();
      return frameInfo(frame, frameIndex(doc, frame.id));
    },
  },

  'frame.select': {
    summary: 'Mostra outro quadro: os desenhos seguintes vão para ele.',
    params: 'frame',
    run: (p) => {
      if (!has(p, 'frame')) fail('o parâmetro "frame" é obrigatório');
      const frame = frameRef(p.frame);
      actions.selectFrame(frame.id);
      return frameInfo(frame, frameIndex(useApp.getState().doc, frame.id));
    },
  },

  'frame.delete': {
    summary: 'Exclui um quadro, o atual se frame não for dado (a animação mantém pelo menos um).',
    params: 'frame?',
    run: (p) => {
      const frame = targetFrame(p);
      if (useApp.getState().doc.frames.length === 1) fail('a animação precisa de pelo menos um quadro');
      actions.deleteFrame(frame.id);
      const { doc } = useApp.getState();
      return { deleted: frame.id, frame: frameIndex(doc) + 1, frames: doc.frames.length };
    },
  },

  'frame.move': {
    summary: 'Leva um quadro para a posição to (1 = primeiro).',
    params: 'frame?, to',
    run: (p) => {
      const frame = targetFrame(p);
      actions.moveFrame(frame.id, int(p, 'to') - 1);
      return frameInfo(frame, frameIndex(useApp.getState().doc, frame.id));
    },
  },

  'frame.setDuration': {
    summary: 'Quanto tempo um quadro fica na tela, em milissegundos (10 a 60000). all true muda todos os quadros.',
    params: 'duration, frame?, all?',
    run: (p) => {
      const duration = num(p, 'duration');
      actions.setFrameDuration(bool(p, 'all', false) ? null : targetFrame(p).id, duration);
      return { frames: useApp.getState().doc.frames.map(frameInfo) };
    },
  },

  // Image size. Every layer and frame changes together, as one undo step; the selection is dropped.

  'canvas.resize': {
    summary:
      'Muda o tamanho da tela sem esticar a arte. anchor diz onde a imagem atual fica: center (padrão), top-left, top, top-right, left, right, bottom-left, bottom ou bottom-right. Encolher corta o que não cabe.',
    params: 'width, height, anchor?',
    run: (p) => {
      const width = int(p, 'width');
      const height = int(p, 'height');
      checkSize(width, height);
      const anchor = text(p, 'anchor', 'center') as Anchor;
      if (!ANCHORS.includes(anchor)) fail(`anchor precisa ser um de: ${ANCHORS.join(', ')}`);
      actions.resizeCanvas(width, height, anchor);
      return inspect();
    },
  },

  'canvas.crop': {
    summary: 'Recorta a imagem no retângulo x, y, w, h (sem eles, na seleção).',
    params: 'x?, y?, w?, h?',
    run: (p) => {
      const rect =
        has(p, 'w') || has(p, 'h')
          ? { x: int(p, 'x', 0), y: int(p, 'y', 0), w: int(p, 'w'), h: int(p, 'h') }
          : useApp.getState().selection;
      if (!rect) fail('passe x, y, w, h ou selecione a área antes');
      if (rect.w < 1 || rect.h < 1) fail('w e h precisam ser pelo menos 1');
      const { doc } = useApp.getState();
      if (rect.x >= doc.width || rect.y >= doc.height || rect.x + rect.w <= 0 || rect.y + rect.h <= 0) {
        fail('o retângulo fica fora da imagem');
      }
      actions.cropTo(rect);
      return inspect();
    },
  },

  'canvas.trim': {
    summary: 'Corta as bordas vazias, deixando só o que está pintado em alguma camada ou quadro.',
    params: '',
    run: () => {
      const bounds = contentBounds(useApp.getState().doc);
      if (!bounds) fail('a imagem está vazia');
      actions.cropTo(bounds);
      return { ...inspect(), kept: bounds };
    },
  },

  'canvas.scale': {
    summary: 'Amplia a arte: cada pixel vira um bloco factor × factor (2 a 16), sem borrar.',
    params: 'factor',
    run: (p) => {
      const factor = int(p, 'factor');
      if (factor < 2 || factor > 16) fail('factor precisa ser de 2 a 16');
      const { doc } = useApp.getState();
      checkSize(doc.width * factor, doc.height * factor);
      actions.scaleImage(factor);
      return inspect();
    },
  },

  // Selection. Without a selection, move, flip, rotate, copy and cut act on the whole layer.

  'select.rect': {
    summary: 'Seleciona um retângulo (cortado nas bordas da imagem).',
    params: 'x, y, w, h',
    run: (p) => {
      const w = int(p, 'w');
      const h = int(p, 'h');
      if (w < 1 || h < 1) fail('w e h precisam ser pelo menos 1');
      actions.select({ x: int(p, 'x'), y: int(p, 'y'), w, h });
      const { selection } = useApp.getState();
      if (!selection) fail('o retângulo fica fora da imagem');
      return { selection };
    },
  },

  'select.all': {
    summary: 'Seleciona a imagem inteira.',
    params: '',
    run: () => {
      actions.selectAll();
      return { selection: useApp.getState().selection };
    },
  },

  'select.none': {
    summary: 'Desfaz a seleção.',
    params: '',
    run: () => {
      actions.select(null);
      return { selection: null };
    },
  },

  'selection.move': {
    summary: 'Move os pixels selecionados (e a seleção) dx, dy pixels. O que sair da imagem se perde.',
    params: 'dx, dy, layer?, frame?',
    run: (p) => {
      actions.moveSelection(int(p, 'dx', 0), int(p, 'dy', 0), selectionTarget(p));
      return { selection: useApp.getState().selection };
    },
  },

  'selection.flip': {
    summary: 'Espelha os pixels selecionados.',
    params: 'axis: "horizontal" | "vertical", layer?, frame?',
    run: (p) => {
      const axis = text(p, 'axis');
      if (axis !== 'horizontal' && axis !== 'vertical') fail('axis precisa ser "horizontal" ou "vertical"');
      actions.flipSelection(axis, selectionTarget(p));
      return { selection: useApp.getState().selection };
    },
  },

  'selection.rotate': {
    summary: 'Gira os pixels selecionados 90° em torno do centro da seleção. Sem seleção, só em imagens quadradas.',
    params: 'direction: "cw" | "ccw", layer?, frame?',
    run: (p) => {
      const direction = text(p, 'direction');
      if (direction !== 'cw' && direction !== 'ccw') fail('direction precisa ser "cw" (horário) ou "ccw" (anti-horário)');
      if (!actions.rotateSelection(direction, selectionTarget(p))) fail('a imagem não é quadrada; selecione a área a girar');
      return { selection: useApp.getState().selection };
    },
  },

  'selection.clear': {
    summary: 'Apaga os pixels selecionados.',
    params: 'layer?, frame?',
    run: (p) => {
      if (!useApp.getState().selection) fail('nada selecionado; use select.rect antes, ou layer.clear para a camada toda');
      actions.clearSelection(selectionTarget(p));
      return { selection: useApp.getState().selection };
    },
  },

  'clipboard.copy': {
    summary: 'Copia os pixels selecionados de uma camada e quadro.',
    params: 'layer?, frame?',
    readOnly: true,
    run: (p) => ({ copied: actions.copy(selectionTarget(p)).rect }),
  },

  'clipboard.cut': {
    summary: 'Copia e apaga os pixels selecionados.',
    params: 'layer?, frame?',
    run: (p) => ({ copied: actions.cut(selectionTarget(p)).rect }),
  },

  'clipboard.paste': {
    summary:
      'Cola o que foi copiado no mesmo lugar de onde saiu (ou com o canto em x, y) e seleciona. Pixels transparentes não cobrem o que está embaixo. Útil para levar uma parte para outro quadro.',
    params: 'x?, y?, layer?, frame?',
    run: (p) => {
      if (!useApp.getState().clipboard) fail('nada copiado ainda; use clipboard.copy antes');
      const at = { x: has(p, 'x') ? int(p, 'x') : undefined, y: has(p, 'y') ? int(p, 'y') : undefined };
      return { selection: actions.paste(at, selectionTarget(p)) };
    },
  },

  // Colours

  'color.set': {
    summary: 'Define a cor principal e/ou secundária, usadas quando um desenho não informa color.',
    params: 'primary?, secondary?',
    run: (p) => {
      if (has(p, 'primary')) actions.setPrimary(colorValue(p.primary, 'primary'));
      if (has(p, 'secondary')) actions.setSecondary(colorValue(p.secondary, 'secondary'));
      const s = useApp.getState();
      return { primary: toHex(s.primary), secondary: toHex(s.secondary) };
    },
  },

  'palette.set': {
    summary: 'Troca a paleta inteira.',
    params: 'colors: string[]',
    run: (p) => {
      if (!Array.isArray(p.colors) || p.colors.length === 0) fail('colors precisa ser uma lista de cores');
      const colors = [...new Set(p.colors.map((c, i) => colorValue(c, `colors[${i}]`)))].filter((c) => c >>> 24);
      useApp.setState({ palette: colors, dirty: true });
      return { palette: colors.map(toHex) };
    },
  },

  'palette.add': {
    summary: 'Acrescenta uma cor à paleta.',
    params: 'color',
    run: (p) => {
      const c = requiredColor(p, 'color');
      if (!useApp.getState().palette.includes(c)) useApp.setState((s) => ({ palette: [...s.palette, c], dirty: true }));
      return { palette: useApp.getState().palette.map(toHex) };
    },
  },

  // Drawing. Coordinates are image pixels, (0, 0) at the top-left.

  'draw.pixels': {
    summary: 'Pinta pixels soltos. Cada item é [x, y] ou [x, y, cor]; "transparent" apaga.',
    params: 'pixels: [[x, y, color?], ...], color?, onlyOn?, layer?, frame?',
    run: (p) => {
      if (!Array.isArray(p.pixels)) fail('pixels precisa ser uma lista de [x, y] ou [x, y, cor]');
      const fallback = color(p);
      const list = p.pixels.map((item, i) => {
        if (!Array.isArray(item) || item.length < 2) fail(`pixels[${i}] precisa ser [x, y] ou [x, y, cor]`);
        const [x, y, c] = item;
        if (typeof x !== 'number' || typeof y !== 'number') fail(`pixels[${i}] precisa ter x e y numéricos`);
        return [Math.round(x), Math.round(y), c === undefined ? fallback : colorValue(c, `pixels[${i}][2]`)] as const;
      });
      return paint(p, (editor) => {
        for (const [x, y, c] of list) editor.set(x, y, c);
      });
    },
  },

  'draw.line': {
    summary: 'Linha de (x0, y0) a (x1, y1), incluindo as pontas. perfectAngle trava em 0°, 45°, 90° e 2:1.',
    params: 'x0, y0, x1, y1, color?, size?, perfectAngle?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const x0 = int(p, 'x0');
      const y0 = int(p, 'y0');
      let x1 = int(p, 'x1');
      let y1 = int(p, 'y1');
      if (bool(p, 'perfectAngle', false)) [x1, y1] = snapToPerfectAngle(x0, y0, x1, y1);
      const offsets = brushOffsets(Math.max(1, int(p, 'size', 1)), 'square');
      return paint(p, (editor) =>
        line(x0, y0, x1, y1, (x, y) => {
          for (const [ox, oy] of offsets) editor.set(x + ox, y + oy, c);
        }),
      );
    },
  },

  'draw.rect': {
    summary: 'Retângulo com canto em (x, y), largura w e altura h. Contorno por padrão; filled preenche.',
    params: 'x, y, w, h, color?, filled?, thickness?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const x = int(p, 'x');
      const y = int(p, 'y');
      const w = int(p, 'w');
      const h = int(p, 'h');
      if (w < 1 || h < 1) fail('w e h precisam ser pelo menos 1');
      return paint(p, (editor) =>
        rectCells(x, y, x + w - 1, y + h - 1, bool(p, 'filled', false), Math.max(1, int(p, 'thickness', 1)), (px, py) =>
          editor.set(px, py, c),
        ),
      );
    },
  },

  'draw.ellipse': {
    summary: 'Elipse ou círculo dentro da caixa (x, y, w, h). Contorno limpo de 1 px por padrão; filled preenche.',
    params: 'x, y, w, h, color?, filled?, thickness?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const w = int(p, 'w');
      const h = int(p, 'h');
      if (w < 1 || h < 1) fail('w e h precisam ser pelo menos 1');
      return paint(p, (editor) =>
        ellipseCells(int(p, 'x'), int(p, 'y'), w, h, bool(p, 'filled', false), Math.max(1, int(p, 'thickness', 1)), (px, py) =>
          editor.set(px, py, c),
        ),
      );
    },
  },

  'draw.fill': {
    summary: 'Balde de tinta a partir de (x, y). contiguous false troca a mesma cor na camada toda.',
    params: 'x, y, color?, contiguous?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      const x = int(p, 'x');
      const y = int(p, 'y');
      return paint(p, (editor, width, height) => {
        for (const i of floodFill(editor.cel, width, height, x, y, bool(p, 'contiguous', true))) editor.setIndex(i, c);
      });
    },
  },

  'draw.pattern': {
    summary:
      'Carimba um desenho em texto com o canto em (x, y). Cada caractere de rows vira a cor do legend; "." e espaço são pulados.',
    params: 'x, y, rows: string[], legend: {caractere: cor}, onlyOn?, layer?, frame?',
    run: (p) => {
      if (!Array.isArray(p.rows) || p.rows.some((r) => typeof r !== 'string')) fail('rows precisa ser uma lista de textos');
      const legend = p.legend;
      if (!legend || typeof legend !== 'object' || Array.isArray(legend)) fail('legend precisa ser um objeto {caractere: cor}');
      const colors = new Map<string, number>();
      for (const [k, v] of Object.entries(legend as Record<string, unknown>)) {
        if ([...k].length !== 1) fail(`as chaves do legend precisam ter um caractere, recebi "${k}"`);
        colors.set(k, colorValue(v, `legend["${k}"]`));
      }
      const x0 = int(p, 'x', 0);
      const y0 = int(p, 'y', 0);
      const rows = p.rows as string[];
      for (const row of rows) {
        for (const ch of row) {
          if (ch !== '.' && ch !== ' ' && !colors.has(ch)) fail(`o caractere "${ch}" aparece em rows mas não está no legend`);
        }
      }
      return paint(p, (editor) =>
        rows.forEach((row, dy) =>
          [...row].forEach((ch, dx) => {
            const c = colors.get(ch);
            if (c !== undefined) editor.set(x0 + dx, y0 + dy, c);
          }),
        ),
      );
    },
  },

  'draw.polygon': {
    summary:
      'Polígono pelos pontos [[x, y], ...] (frações valem) ou regular com cx, cy, radius, sides e rotation em graus (padrão -90: vértice em cima). Preenchido por padrão.',
    params: 'points? | cx, cy, radius, sides, rotation?; color?, filled?, onlyOn?, layer?, frame?',
    run: (p) => {
      const c = color(p);
      let points: Point[];
      if (has(p, 'points')) {
        if (!Array.isArray(p.points) || p.points.length < 2) fail('points precisa ter pelo menos 2 pontos [x, y]');
        points = p.points.map((pt, i) => {
          if (!Array.isArray(pt) || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') fail(`points[${i}] precisa ser [x, y]`);
          return [pt[0], pt[1]] as const;
        });
      } else {
        const sides = int(p, 'sides');
        if (sides < 3 || sides > 64) fail('sides precisa estar entre 3 e 64');
        points = regularPolygonPoints(num(p, 'cx'), num(p, 'cy'), num(p, 'radius'), sides, num(p, 'rotation', -90));
      }
      return paint(p, (editor) => polygonCells(points, bool(p, 'filled', true), (x, y) => editor.set(x, y, c)));
    },
  },

  'draw.star': {
    summary:
      'Estrela centrada em (cx, cy); use meio pixel (15.5) para centralizar numa imagem de lado par. Com light e dark, cada faceta recebe um tom pela direção da luz (lightAngle em graus, padrão -135: de cima à esquerda), como um chanfro.',
    params: 'cx, cy, outer, inner?, points?, rotation?, color?, light?, dark?, lightAngle?, onlyOn?, layer?, frame?',
    run: (p) => {
      const base = color(p);
      const tips = int(p, 'points', 5);
      if (tips < 3 || tips > 24) fail('points precisa estar entre 3 e 24');
      const outer = num(p, 'outer');
      if (outer <= 0) fail('outer precisa ser maior que zero');
      const inner = num(p, 'inner', outer * 0.42);
      const rotation = num(p, 'rotation', -90);
      const light = has(p, 'light') ? colorValue(p.light, 'light') : base;
      const dark = has(p, 'dark') ? colorValue(p.dark, 'dark') : base;
      const toward = (num(p, 'lightAngle', -135) * Math.PI) / 180;
      const step = 180 / tips;
      return paint(p, (editor) =>
        starCells(num(p, 'cx'), num(p, 'cy'), outer, inner, tips, rotation, (x, y, facet) => {
          const facing = Math.cos(((rotation + step * (facet + 0.5)) * Math.PI) / 180 - toward);
          editor.set(x, y, facing > 0.3 ? light : facing < -0.6 ? dark : base);
        }),
      );
    },
  },

  'draw.burst': {
    summary:
      'Estouro de fogos: raios retos de inner a outer a partir de (cx, cy). colors vai do centro à ponta (gradiente). dash [aceso, apagado] em pixels tracejam os raios; alternate (0 a 1) encurta os raios ímpares.',
    params: 'cx, cy, outer, inner?, rays?, rotation?, colors?: string[], color?, dash?: [on, off], alternate?, onlyOn?, layer?, frame?',
    run: (p) => {
      const outer = num(p, 'outer');
      const inner = num(p, 'inner', 0);
      if (outer <= inner) fail('outer precisa ser maior que inner');
      const rays = int(p, 'rays', 12);
      if (rays < 2 || rays > 96) fail('rays precisa estar entre 2 e 96');
      const colors = has(p, 'colors')
        ? (Array.isArray(p.colors) && p.colors.length > 0 ? p.colors : fail('colors precisa ser uma lista de cores')).map((c, i) =>
            colorValue(c, `colors[${i}]`),
          )
        : [color(p)];
      let dash: [number, number] | null = null;
      if (has(p, 'dash')) {
        if (!Array.isArray(p.dash) || p.dash.length !== 2 || typeof p.dash[0] !== 'number' || typeof p.dash[1] !== 'number' || p.dash[0] <= 0) {
          fail('dash precisa ser [aceso, apagado] em pixels, com aceso > 0');
        }
        dash = [p.dash[0], p.dash[1]];
      }
      const alternate = num(p, 'alternate', 1);
      if (alternate < 0 || alternate > 1) fail('alternate precisa estar entre 0 e 1');
      return paint(p, (editor) =>
        burstCells(num(p, 'cx'), num(p, 'cy'), inner, outer, rays, num(p, 'rotation', -90), dash, alternate, (x, y, t) =>
          editor.set(x, y, colors[Math.min(colors.length - 1, Math.floor(t * colors.length))]),
        ),
      );
    },
  },

  'effect.outline': {
    summary: 'Contorna o que está desenhado na camada com uma cor. corners true inclui as diagonais.',
    params: 'color, corners?, layer?, frame?',
    run: (p) => {
      const c = requiredColor(p, 'color');
      return paint(p, (editor, width, height) => {
        for (const i of outlineIndices(editor.cel, width, height, bool(p, 'corners', false))) editor.setIndex(i, c);
      });
    },
  },

  'effect.replaceColor': {
    summary: 'Troca uma cor por outra em toda a camada.',
    params: 'from, to, layer?, frame?',
    run: (p) => {
      const from = requiredColor(p, 'from');
      const to = requiredColor(p, 'to');
      return paint(p, (editor, width, height) => {
        const px = editor.cel;
        for (let i = 0; i < width * height; i++) if (sameColor(px[i], from)) editor.setIndex(i, to);
      });
    },
  },

  // History and view

  'history.undo': {
    summary: 'Desfaz o último passo.',
    params: '',
    run: () => {
      actions.undo();
      return { canUndo: useApp.getState().canUndo, canRedo: useApp.getState().canRedo };
    },
  },

  'history.redo': {
    summary: 'Refaz o último passo desfeito.',
    params: '',
    run: () => {
      actions.redo();
      return { canUndo: useApp.getState().canUndo, canRedo: useApp.getState().canRedo };
    },
  },

  'tool.set': {
    summary: 'Escolhe a ferramenta ativa na interface.',
    params: 'tool: pencil | eraser | line | rect | fill | eyedropper',
    run: (p) => {
      const tool = text(p, 'tool') as ToolId;
      if (!['pencil', 'eraser', 'line', 'rect', 'fill', 'eyedropper'].includes(tool)) fail(`ferramenta desconhecida: ${tool}`);
      actions.setTool(tool);
      return { tool };
    },
  },

  'view.fit': {
    summary: 'Ajusta o zoom para a imagem caber na janela.',
    params: '',
    readOnly: true,
    run: () => {
      actions.fitView();
      return { zoom: useApp.getState().view.zoom };
    },
  },

  'view.zoom': {
    summary: 'Zoom em porcentagem, por exemplo 800.',
    params: 'percent',
    readOnly: true,
    run: (p) => {
      const target = (num(p, 'percent') / 100) * useApp.getState().view.dpr;
      const level = ZOOM_LEVELS.reduce((best, z) => (Math.abs(z - target) < Math.abs(best - target) ? z : best));
      actions.zoomTo(level);
      return { zoom: level };
    },
  },

  'view.grid': {
    summary: 'Mostra ou esconde a grade de pixels.',
    params: 'on',
    readOnly: true,
    run: (p) => {
      if (useApp.getState().showGrid !== bool(p, 'on', true)) actions.toggleGrid();
      return { grid: useApp.getState().showGrid };
    },
  },

  // Output. Files are written by the caller, so the app never needs file system access for scripts.

  'render.png': {
    summary: 'PNG em base64 da imagem visível (ou de uma camada), ampliado por scale sem borrar.',
    params: 'scale?, layer?, frame?',
    readOnly: true,
    run: async (p) => {
      const { doc } = useApp.getState();
      const scale = int(p, 'scale', 1);
      if (scale < 1 || doc.width * scale > 8192 || doc.height * scale > 8192) fail('scale fora do limite (até 8192 px por lado)');
      const frame = targetFrame(p).id;
      const source = has(p, 'layer') ? celOf(doc, layerRef(p.layer), frame) : composite(doc, frame);
      const pixels = scaleNearest(source, doc.width, doc.height, scale);
      const png = await encodePng(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), doc.width * scale, doc.height * scale);
      return { png: toBase64(png), width: doc.width * scale, height: doc.height * scale };
    },
  },

  'render.sheet': {
    summary: 'Folha de sprites em PNG (base64): todos os quadros lado a lado (layout "row") ou numa grade quase quadrada ("grid").',
    params: 'scale?, layout?: "row" | "grid"',
    readOnly: true,
    run: async (p) => {
      const { doc } = useApp.getState();
      const scale = int(p, 'scale', 1);
      const layout = text(p, 'layout', 'row');
      if (layout !== 'row' && layout !== 'grid') fail('layout precisa ser "row" ou "grid"');
      const { cols, rows } = sheetGrid(doc.frames.length, layout);
      if (scale < 1 || cols * doc.width * scale > 16384 || rows * doc.height * scale > 16384) {
        fail('folha grande demais (até 16384 px por lado); use scale menor ou layout "grid"');
      }
      const sheet = renderSheet(doc, layout, scale);
      const png = await encodePng(new Uint8Array(sheet.pixels.buffer), sheet.width, sheet.height);
      return {
        png: toBase64(png),
        width: sheet.width,
        height: sheet.height,
        columns: sheet.cols,
        rows: sheet.rows,
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
        durations: doc.frames.map((f) => f.duration),
      };
    },
  },

  'render.gif': {
    summary:
      'GIF animado (base64) com todos os quadros e suas durações, repetindo para sempre. pingpong true vai e volta. GIF guarda até 256 cores e transparência total ou nenhuma.',
    params: 'scale?, pingpong?',
    readOnly: true,
    run: (p) => {
      const { doc } = useApp.getState();
      const scale = int(p, 'scale', 1);
      if (scale < 1 || doc.width * scale > 4096 || doc.height * scale > 4096) fail('scale fora do limite (até 4096 px por lado)');
      const gif = renderGif(doc, { scale, pingpong: bool(p, 'pingpong', false) });
      return {
        gif: toBase64(gif.bytes),
        width: doc.width * scale,
        height: doc.height * scale,
        frames: doc.frames.length,
        colors: gif.colors,
        reduced: gif.reduced,
      };
    },
  },

  'project.serialize': {
    summary: 'Conteúdo do arquivo .pontilha (camadas, paleta) para quem chamou salvar.',
    params: '',
    readOnly: true,
    run: async () => {
      const s = useApp.getState();
      return { text: await serializeProject(s.doc, s.palette, s.activeLayerId), fileName: s.fileName };
    },
  },

  'project.markSaved': {
    summary: 'Informa que o projeto foi salvo pelo script, com o nome do arquivo.',
    params: 'fileName',
    readOnly: true,
    run: (p) => {
      useApp.setState({ dirty: false, fileName: text(p, 'fileName') });
      return { fileName: useApp.getState().fileName };
    },
  },

  'project.load': {
    summary: 'Abre o conteúdo de um arquivo .pontilha. Recusa se houver alterações não salvas, a menos que discard seja true.',
    params: 'text, fileName?, discard?',
    run: async (p) => {
      guardUnsaved(p);
      const project = await parseProject(text(p, 'text'));
      actions.loadDoc(project.doc, {
        activeLayerId: project.activeLayerId,
        palette: project.palette,
        fileName: text(p, 'fileName', 'projeto.pontilha'),
        filePath: null,
      });
      return inspect();
    },
  },

  'image.load': {
    summary: 'Abre um PNG (base64) como imagem nova de uma camada. Mesma regra de discard do doc.new.',
    params: 'png, fileName?, discard?',
    run: async (p) => {
      guardUnsaved(p);
      const image = await decodeImage(fromBase64(text(p, 'png')));
      checkSize(image.width, image.height);
      actions.loadDoc(
        createDoc(image.width, image.height, image.pixels),
        { fileName: text(p, 'fileName', 'imagem.pontilha'), filePath: null },
      );
      return inspect();
    },
  },
};

export type Reply = { ok: true; result: unknown } | { ok: false; error: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function runOne(method: unknown, params: unknown): Promise<unknown> {
  if (typeof method !== 'string') fail('method precisa ser o nome de um comando');
  const command = COMMANDS[method];
  if (!command) fail(`comando desconhecido: ${method}. Use commands.list para ver os disponíveis.`);
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
    fail('params precisa ser um objeto');
  }
  if (!command.readOnly) actions.notify(`Script: ${method}`);
  return command.run((params ?? {}) as Params);
}

/**
 * Entry point for the control port: runs one command, or a batch as a single
 * undo step that is rolled back entirely if any command in it fails.
 */
export async function execute(method: string, params: unknown): Promise<Reply> {
  try {
    if (method !== 'batch') return { ok: true, result: await runOne(method, params) };

    const list = (params as Params | null)?.commands;
    if (!Array.isArray(list)) fail('batch precisa de commands: [{method, params}, ...]');
    const results = await actions.group(async () => {
      const out: unknown[] = [];
      for (const [i, item] of list.entries()) {
        const m = (item as Params | null)?.method;
        if (m === 'batch' || (typeof m === 'string' && m.startsWith('history.'))) {
          fail(`comando ${i + 1}: ${String(m)} não pode ser usado dentro de batch`);
        }
        try {
          out.push(await runOne(m, (item as Params | null)?.params));
        } catch (err) {
          throw new CommandError(`comando ${i + 1} (${String(m)}): ${message(err)}. Nada do lote foi aplicado.`);
        }
      }
      return out;
    });
    return { ok: true, result: results };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
