import { toCss, toHex } from '../core/color';
import type { ToolId } from '../core/tools';
import { actions, useApp } from '../state/store';
import { Icon, type IconName } from './icons';

const TOOLS: Array<{ id: ToolId; icon: IconName; label: string; key: string }> = [
  { id: 'select', icon: 'select', label: 'Select', key: 'M' },
  { id: 'wand', icon: 'wand', label: 'Magic wand', key: 'W' },
  { id: 'pencil', icon: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'line', icon: 'line', label: 'Line', key: 'L' },
  { id: 'rect', icon: 'rect', label: 'Rectangle', key: 'U' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
  { id: 'fill', icon: 'fill', label: 'Fill', key: 'G' },
  { id: 'eyedropper', icon: 'eyedropper', label: 'Eyedropper', key: 'I' },
];

function ColorWell() {
  const primary = useApp((s) => s.primary);
  const secondary = useApp((s) => s.secondary);
  return (
    <div className="well">
      <button
        type="button"
        className="well-swatch well-secondary px"
        style={{ '--swatch': toCss(secondary) } as React.CSSProperties}
        title={`Secondary color ${toHex(secondary)}. Click to swap (X).`}
        aria-label={`Secondary color ${toHex(secondary)}, swap with the primary`}
        onClick={actions.swapColors}
      />
      <div
        className="well-swatch well-primary px"
        style={{ '--swatch': toCss(primary) } as React.CSSProperties}
        title={`Primary color ${toHex(primary)}`}
        role="img"
        aria-label={`Primary color ${toHex(primary)}`}
      />
      <button type="button" className="well-swap" title="Swap colors (X)" aria-label="Swap colors" onClick={actions.swapColors}>
        <Icon name="swap" size={12} />
      </button>
    </div>
  );
}

export function ToolRail() {
  const tool = useApp((s) => s.tool);
  return (
    <nav className="rail" aria-label="Ferramentas">
      <div className="rail-tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rail-btn px${tool === t.id ? ' is-on' : ''}`}
            title={`${t.label} (${t.key})`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            onClick={() => actions.setTool(t.id)}
          >
            <Icon name={t.icon} size={24} />
          </button>
        ))}
      </div>
      <ColorWell />
    </nav>
  );
}
