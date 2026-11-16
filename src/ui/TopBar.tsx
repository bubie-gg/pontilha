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
  const scope = selection ? 'the selection' : 'the whole layer';
  const edit = (fn: () => void) => () => onVisibleLayer(fn);
  return (
    <>
      <span className="options-meta">
        {!selection
          ? 'Nothing selected: actions apply to the whole layer'
          : selection.mask
            ? `${selectedCount(selection)} pixels in a ${selection.w} × ${selection.h} area at ${selection.x}, ${selection.y}`
            : `${selection.w} × ${selection.h} px at ${selection.x}, ${selection.y}`}
      </span>
      <div className="bar-group">
        <OptButton label="Flip ↔" title={`Flips ${scope} horizontally (Shift+H)`} onClick={edit(() => actions.flipSelection('horizontal'))} />
        <OptButton label="Flip ↕" title={`Flips ${scope} vertically (Shift+V)`} onClick={edit(() => actions.flipSelection('vertical'))} />
        <OptButton
          label="Rotate ↻"
          title={`Rotates ${scope} 90° clockwise (Shift+R)`}
          disabled={!selection && !square}
          onClick={edit(() => actions.rotateSelection('cw'))}
        />
        <OptButton
          label="Rotate ↺"
          title={`Rotates ${scope} 90° counterclockwise`}
          disabled={!selection && !square}
          onClick={edit(() => actions.rotateSelection('ccw'))}
        />
      </div>
      <div className="bar-group">
        <OptButton label="Copy" title={`Copies ${scope} (Ctrl+C)`} onClick={() => actions.copy()} />
        <OptButton label="Cut" title={`Copies and erases ${scope} (Ctrl+X)`} onClick={edit(() => actions.cut())} />
        <OptButton label="Paste" title="Pastes in the same place it was copied from (Ctrl+V)" disabled={!hasClip} onClick={edit(() => actions.paste())} />
        <OptButton label="Erase" title="Erases the selected pixels (Delete)" disabled={!selection} onClick={edit(() => actions.clearSelection())} />
      </div>
      <div className="bar-group">
        <OptButton label="All" title="Selects the whole image (Ctrl+A)" onClick={actions.selectAll} />
        <OptButton label="None" title="Clears the selection (Ctrl+D or Esc)" disabled={!selection} onClick={() => actions.select(null)} />
      </div>
      <div className="bar-group">
        <OptButton
          label="Crop image"
          title="Keeps only the selected area, in every layer and frame"
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

  const size = (label = 'Size') => (
    <Stepper label={label} value={settings.brushSize} min={1} max={32} onChange={actions.setBrushSize} />
  );

  switch (tool) {
    case 'select':
      return <SelectionOptions />;
    case 'wand':
      return (
        <>
          <Segmented
            label="Wand range"
            value={settings.wandContiguous ? 'area' : 'all'}
            options={[
              { value: 'area', label: 'Connected area' },
              { value: 'all', label: 'Same color across the layer' },
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
            label="Brush shape"
            value={settings.brushShape}
            options={[
              { value: 'square', label: 'Square' },
              { value: 'round', label: 'Round' },
            ]}
            onChange={(brushShape) => set({ brushShape })}
          />
          <Toggle
            label="Pixel perfect"
            checked={settings.pixelPerfect}
            disabled={settings.brushSize > 1}
            title={settings.brushSize > 1 ? 'Works with a 1-pixel brush' : 'Removes doubled corners from the stroke'}
            onChange={(pixelPerfect) => set({ pixelPerfect })}
          />
        </>
      );
    case 'line':
      return (
        <>
          {size()}
          <Toggle
            label="Perfect angle"
            checked={settings.perfectAngle}
            title="Snaps to 0°, 45°, 90° and the 2:1 isometric lines. Shift inverts."
            onChange={(perfectAngle) => set({ perfectAngle })}
          />
        </>
      );
    case 'rect':
      return (
        <>
          {size('Outline')}
          <Toggle label="Filled" checked={settings.rectFilled} onChange={(rectFilled) => set({ rectFilled })} />
        </>
      );
    case 'ellipse':
      return (
        <>
          {size('Outline')}
          <Toggle label="Filled" checked={settings.ellipseFilled} onChange={(ellipseFilled) => set({ ellipseFilled })} />
        </>
      );
    case 'fill':
      return (
        <Segmented
          label="Fill range"
          value={settings.fillContiguous ? 'area' : 'all'}
          options={[
            { value: 'area', label: 'Connected area' },
            { value: 'all', label: 'Same color across the layer' },
          ]}
          onChange={(v) => set({ fillContiguous: v === 'area' })}
        />
      );
    case 'eyedropper':
      return (
        <Segmented
          label="Pick color from"
          value={settings.sampleAllLayers ? 'all' : 'layer'}
          options={[
            { value: 'all', label: 'Whole image' },
            { value: 'layer', label: 'Active layer' },
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
        {dirty && <span className="file-state">unsaved</span>}
      </div>

      <div className="bar-group">
        <IconButton icon="newFile" label="New image (Ctrl+N)" onClick={() => actions.openDialog('new')} />
        <IconButton icon="open" label="Open (Ctrl+O)" onClick={openFile} />
        <IconButton icon="save" label="Save (Ctrl+S)" onClick={() => saveProject()} />
        <IconButton icon="export" label="Export (Ctrl+E)" onClick={() => actions.openDialog('export')} />
        <IconButton icon="crop" label="Image size: canvas, scale up, crop" onClick={() => actions.openDialog('canvas')} />
      </div>

      <div className="bar-spacer" />

      <div className="bar-group">
        <IconButton icon="undo" label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={actions.undo} />
        <IconButton icon="redo" label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={actions.redo} />
      </div>

      <div className="bar-group">
        <IconButton icon="grid" label="Pixel grid (Ctrl+')" active={showGrid} onClick={actions.toggleGrid} />
        <IconButton
          icon="tile"
          label="Tile mode: shows the image repeated around itself, to check the seams"
          active={tileMode}
          onClick={actions.toggleTileMode}
        />
        <IconButton
          icon="iso"
          label="2:1 isometric grid"
          active={isoGrid > 0}
          onClick={() => actions.setIsoGrid(isoGrid > 0 ? 0 : 32)}
        />
        {isoGrid > 0 && (
          <Segmented
            label="Isometric tile width"
            value={String(isoGrid)}
            options={[16, 32, 64].map((n) => ({ value: String(n), label: `${n}` }))}
            onChange={(v) => actions.setIsoGrid(Number(v))}
          />
        )}
        <IconButton icon="minus" label="Zoom out (-)" onClick={() => actions.zoomStep(-1)} />
        <button type="button" className="zoom-readout px" title="Zoom 100% (1)" onClick={actions.zoomActual}>
          {Math.round(zoom * 100)}%
        </button>
        <IconButton icon="plus" label="Zoom in (+)" onClick={() => actions.zoomStep(1)} />
        <IconButton icon="fit" label="Fit to window (0)" onClick={actions.fitView} />
      </div>
    </header>
  );
}

const TOOL_NAMES: Record<ToolId, string> = {
  pencil: 'Pencil',
  eraser: 'Eraser',
  line: 'Line',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  fill: 'Fill',
  eyedropper: 'Eyedropper',
  select: 'Select',
  wand: 'Magic wand',
};

/** Options for the active tool, in their own row so they never get squeezed by the top bar. */
/** Tools that paint, and so can mirror what they paint. */
const MIRRORED = new Set<ToolId>(['pencil', 'eraser', 'line', 'rect', 'ellipse', 'fill']);

function SymmetryOption() {
  const symmetry = useApp((s) => s.settings.symmetry);
  return (
    <div className="option-group" title="Repeats what you paint across the image’s center lines">
      <span className="option-label">Symmetry</span>
      <Segmented
        label="Symmetry"
        value={symmetry}
        options={[
          { value: 'none', label: 'Off' },
          { value: 'vertical', label: '↔ Sides' },
          { value: 'horizontal', label: '↕ Top and bottom' },
          { value: 'both', label: 'All four' },
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
    <div className="options-bar" role="toolbar" aria-label={`Options: ${TOOL_NAMES[tool]}`}>
      <span className="options-tool">
        {TOOL_NAMES[tool]}
        {held && <span className="options-held">while holding Alt</span>}
      </span>
      <ToolOptions />
      {MIRRORED.has(tool) && <SymmetryOption />}
    </div>
  );
}
