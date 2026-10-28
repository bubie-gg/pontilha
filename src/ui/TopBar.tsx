import { openFile, saveProject } from '../app/fileActions';
import { onVisibleLayer } from '../app/hooks';
import type { ToolId } from '../core/tools';
import { selectedCount } from '../core/transform';
import { actions, useApp } from '../state/store';
import { IconButton, Segmented, Stepper, Toggle } from './controls';
import { Mark } from './icons';

function OptButton({ label, title, onClick, disabled }: { label: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="opt-btn px" title={title} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

function SelectionOptions() {
  const selection = useApp((s) => s.selection);
  const hasClip = useApp((s) => s.clipboard !== null);
  const square = useApp((s) => s.doc.width === s.doc.height);
  const scope = selection ? 'a seleção' : 'a camada inteira';
  const edit = (fn: () => void) => () => onVisibleLayer(fn);
  return (
    <>
      <span className="options-meta">
        {!selection
          ? 'Nada selecionado: as ações valem para a camada inteira'
          : selection.mask
            ? `${selectedCount(selection)} pixels numa área de ${selection.w} × ${selection.h} em ${selection.x}, ${selection.y}`
            : `${selection.w} × ${selection.h} px em ${selection.x}, ${selection.y}`}
      </span>
      <div className="bar-group">
        <OptButton label="Espelhar ↔" title={`Espelha ${scope} na horizontal (Shift+H)`} onClick={edit(() => actions.flipSelection('horizontal'))} />
        <OptButton label="Espelhar ↕" title={`Espelha ${scope} na vertical (Shift+V)`} onClick={edit(() => actions.flipSelection('vertical'))} />
        <OptButton
          label="Girar ↻"
          title={`Gira ${scope} 90° no sentido horário (Shift+R)`}
          disabled={!selection && !square}
          onClick={edit(() => actions.rotateSelection('cw'))}
        />
        <OptButton
          label="Girar ↺"
          title={`Gira ${scope} 90° no sentido anti-horário`}
          disabled={!selection && !square}
          onClick={edit(() => actions.rotateSelection('ccw'))}
        />
      </div>
      <div className="bar-group">
        <OptButton label="Copiar" title={`Copia ${scope} (Ctrl+C)`} onClick={() => actions.copy()} />
        <OptButton label="Recortar" title={`Copia e apaga ${scope} (Ctrl+X)`} onClick={edit(() => actions.cut())} />
        <OptButton label="Colar" title="Cola no mesmo lugar de onde copiou (Ctrl+V)" disabled={!hasClip} onClick={edit(() => actions.paste())} />
        <OptButton label="Apagar" title="Apaga os pixels da seleção (Delete)" disabled={!selection} onClick={edit(() => actions.clearSelection())} />
      </div>
      <div className="bar-group">
        <OptButton label="Tudo" title="Seleciona a imagem inteira (Ctrl+A)" onClick={actions.selectAll} />
        <OptButton label="Nada" title="Desfaz a seleção (Ctrl+D ou Esc)" disabled={!selection} onClick={() => actions.select(null)} />
      </div>
      <div className="bar-group">
        <OptButton
          label="Recortar imagem"
          title="Deixa só a área selecionada, em todas as camadas e quadros"
          disabled={!selection}
          onClick={() => actions.cropTo()}
        />
      </div>
    </>
  );
}

function ToolOptions() {
  const tool = useApp((s) => s.tool);
  const settings = useApp((s) => s.settings);
  const set = actions.setSettings;

  const size = (label = 'Tamanho') => (
    <Stepper label={label} value={settings.brushSize} min={1} max={32} onChange={actions.setBrushSize} />
  );

  switch (tool) {
    case 'select':
      return <SelectionOptions />;
    case 'wand':
      return (
        <>
          <Segmented
            label="Alcance da varinha"
            value={settings.wandContiguous ? 'area' : 'all'}
            options={[
              { value: 'area', label: 'Área conectada' },
              { value: 'all', label: 'Mesma cor na camada toda' },
            ]}
            onChange={(v) => set({ wandContiguous: v === 'area' })}
          />
          <SelectionOptions />
        </>
      );
    case 'pencil':
    case 'eraser':
      return (
        <>
          {size()}
          <Segmented
            label="Forma do pincel"
            value={settings.brushShape}
            options={[
              { value: 'square', label: 'Quadrado' },
              { value: 'round', label: 'Redondo' },
            ]}
            onChange={(brushShape) => set({ brushShape })}
          />
          <Toggle
            label="Pixel perfeito"
            checked={settings.pixelPerfect}
            disabled={settings.brushSize > 1}
            title={settings.brushSize > 1 ? 'Funciona com pincel de 1 pixel' : 'Remove os cantos dobrados do traço'}
            onChange={(pixelPerfect) => set({ pixelPerfect })}
          />
        </>
      );
    case 'line':
      return (
        <>
          {size()}
          <Toggle
            label="Ângulo perfeito"
            checked={settings.perfectAngle}
            title="Trava em 0°, 45°, 90° e nas linhas 2:1 do isométrico. Shift inverte."
            onChange={(perfectAngle) => set({ perfectAngle })}
          />
        </>
      );
    case 'rect':
      return (
        <>
          {size('Contorno')}
          <Toggle label="Preenchido" checked={settings.rectFilled} onChange={(rectFilled) => set({ rectFilled })} />
        </>
      );
    case 'ellipse':
      return (
        <>
          {size('Contorno')}
          <Toggle label="Preenchida" checked={settings.ellipseFilled} onChange={(ellipseFilled) => set({ ellipseFilled })} />
        </>
      );
    case 'fill':
      return (
        <Segmented
          label="Alcance do balde"
          value={settings.fillContiguous ? 'area' : 'all'}
          options={[
            { value: 'area', label: 'Área conectada' },
            { value: 'all', label: 'Mesma cor na camada toda' },
          ]}
          onChange={(v) => set({ fillContiguous: v === 'area' })}
        />
      );
    case 'eyedropper':
      return (
        <Segmented
          label="Pegar cor de"
          value={settings.sampleAllLayers ? 'all' : 'layer'}
          options={[
            { value: 'all', label: 'Imagem inteira' },
            { value: 'layer', label: 'Camada ativa' },
          ]}
          onChange={(v) => set({ sampleAllLayers: v === 'all' })}
        />
      );
  }
}

export function TopBar() {
  const fileName = useApp((s) => s.fileName);
  const dirty = useApp((s) => s.dirty);
  const canUndo = useApp((s) => s.canUndo);
  const canRedo = useApp((s) => s.canRedo);
  const showGrid = useApp((s) => s.showGrid);
  const tileMode = useApp((s) => s.tileMode);
  const isoGrid = useApp((s) => s.isoGrid);
  const zoom = useApp((s) => s.view.zoom / s.view.dpr);

  return (
    <header className="topbar">
      <div className="brand">
        <Mark size={20} />
        <span className="wordmark">Pontilha</span>
      </div>

      <div className="file-info" title={fileName}>
        <span className="file-name">{fileName}</span>
        {dirty && <span className="file-state">não salvo</span>}
      </div>

      <div className="bar-group">
        <IconButton icon="newFile" label="Nova imagem (Ctrl+N)" onClick={() => actions.openDialog('new')} />
        <IconButton icon="open" label="Abrir (Ctrl+O)" onClick={openFile} />
        <IconButton icon="save" label="Salvar (Ctrl+S)" onClick={() => saveProject()} />
        <IconButton icon="export" label="Exportar (Ctrl+E)" onClick={() => actions.openDialog('export')} />
        <IconButton icon="crop" label="Tamanho da imagem: tela, ampliar, recortar" onClick={() => actions.openDialog('canvas')} />
      </div>

      <div className="bar-spacer" />

      <div className="bar-group">
        <IconButton icon="undo" label="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={actions.undo} />
        <IconButton icon="redo" label="Refazer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={actions.redo} />
      </div>

      <div className="bar-group">
        <IconButton icon="grid" label="Grade de pixels (Ctrl+')" active={showGrid} onClick={actions.toggleGrid} />
        <IconButton
          icon="tile"
          label="Modo tile: mostra a imagem repetida em volta, para conferir as emendas"
          active={tileMode}
          onClick={actions.toggleTileMode}
        />
        <IconButton
          icon="iso"
          label="Grade isométrica 2:1"
          active={isoGrid > 0}
          onClick={() => actions.setIsoGrid(isoGrid > 0 ? 0 : 32)}
        />
        {isoGrid > 0 && (
          <Segmented
            label="Largura do ladrilho isométrico"
            value={String(isoGrid)}
            options={[16, 32, 64].map((n) => ({ value: String(n), label: `${n}` }))}
            onChange={(v) => actions.setIsoGrid(Number(v))}
          />
        )}
        <IconButton icon="minus" label="Diminuir zoom (-)" onClick={() => actions.zoomStep(-1)} />
        <button type="button" className="zoom-readout px" title="Zoom 100% (1)" onClick={actions.zoomActual}>
          {Math.round(zoom * 100)}%
        </button>
        <IconButton icon="plus" label="Aumentar zoom (+)" onClick={() => actions.zoomStep(1)} />
        <IconButton icon="fit" label="Ajustar à janela (0)" onClick={actions.fitView} />
      </div>
    </header>
  );
}

const TOOL_NAMES: Record<ToolId, string> = {
  pencil: 'Lápis',
  eraser: 'Borracha',
  line: 'Linha',
  rect: 'Retângulo',
  ellipse: 'Elipse',
  fill: 'Balde',
  eyedropper: 'Conta-gotas',
  select: 'Seleção',
  wand: 'Varinha mágica',
};

/** Options for the active tool, in their own row so they never get squeezed by the top bar. */
/** Tools that paint, and so can mirror what they paint. */
const MIRRORED = new Set<ToolId>(['pencil', 'eraser', 'line', 'rect', 'ellipse', 'fill']);

function SymmetryOption() {
  const symmetry = useApp((s) => s.settings.symmetry);
  return (
    <div className="option-group" title="Repete o que você pinta do outro lado das linhas do centro da imagem">
      <span className="option-label">Simetria</span>
      <Segmented
        label="Simetria"
        value={symmetry}
        options={[
          { value: 'none', label: 'Desligada' },
          { value: 'vertical', label: '↔ Lados' },
          { value: 'horizontal', label: '↕ Cima e baixo' },
          { value: 'both', label: 'Os quatro' },
        ]}
        onChange={(value) => actions.setSettings({ symmetry: value })}
      />
    </div>
  );
}

export function OptionsBar() {
  const tool = useApp((s) => s.tool);
  const held = useApp((s) => s.heldTool);
  return (
    <div className="options-bar" role="toolbar" aria-label={`Opções: ${TOOL_NAMES[tool]}`}>
      <span className="options-tool">
        {TOOL_NAMES[tool]}
        {held && <span className="options-held">enquanto segura Alt</span>}
      </span>
      <ToolOptions />
      {MIRRORED.has(tool) && <SymmetryOption />}
    </div>
  );
}
