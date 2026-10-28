import { openFile, saveProject } from '../app/fileActions';
import type { ToolId } from '../core/tools';
import { actions, useApp } from '../state/store';
import { IconButton, Segmented, Stepper, Toggle } from './controls';
import { Mark } from './icons';

function ToolOptions() {
  const tool = useApp((s) => s.tool);
  const settings = useApp((s) => s.settings);
  const set = actions.setSettings;

  const size = (label = 'Tamanho') => (
    <Stepper label={label} value={settings.brushSize} min={1} max={32} onChange={actions.setBrushSize} />
  );

  switch (tool) {
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
        <IconButton icon="export" label="Exportar PNG (Ctrl+E)" onClick={() => actions.openDialog('export')} />
      </div>

      <div className="bar-spacer" />

      <div className="bar-group">
        <IconButton icon="undo" label="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={actions.undo} />
        <IconButton icon="redo" label="Refazer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={actions.redo} />
      </div>

      <div className="bar-group">
        <IconButton icon="grid" label="Grade de pixels (Ctrl+')" active={showGrid} onClick={actions.toggleGrid} />
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
  fill: 'Balde',
  eyedropper: 'Conta-gotas',
};

/** Options for the active tool, in their own row so they never get squeezed by the top bar. */
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
    </div>
  );
}
