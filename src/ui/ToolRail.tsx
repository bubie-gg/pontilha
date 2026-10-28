import { toCss, toHex } from '../core/color';
import type { ToolId } from '../core/tools';
import { actions, useApp } from '../state/store';
import { Icon, type IconName } from './icons';

const TOOLS: Array<{ id: ToolId; icon: IconName; label: string; key: string }> = [
  { id: 'select', icon: 'select', label: 'Seleção', key: 'M' },
  { id: 'pencil', icon: 'pencil', label: 'Lápis', key: 'B' },
  { id: 'eraser', icon: 'eraser', label: 'Borracha', key: 'E' },
  { id: 'line', icon: 'line', label: 'Linha', key: 'L' },
  { id: 'rect', icon: 'rect', label: 'Retângulo', key: 'U' },
  { id: 'fill', icon: 'fill', label: 'Balde', key: 'G' },
  { id: 'eyedropper', icon: 'eyedropper', label: 'Conta-gotas', key: 'I' },
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
        title={`Cor secundária ${toHex(secondary)}. Clique para trocar (X).`}
        aria-label={`Cor secundária ${toHex(secondary)}, trocar com a principal`}
        onClick={actions.swapColors}
      />
      <div
        className="well-swatch well-primary px"
        style={{ '--swatch': toCss(primary) } as React.CSSProperties}
        title={`Cor principal ${toHex(primary)}`}
        role="img"
        aria-label={`Cor principal ${toHex(primary)}`}
      />
      <button type="button" className="well-swap" title="Trocar cores (X)" aria-label="Trocar cores" onClick={actions.swapColors}>
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
