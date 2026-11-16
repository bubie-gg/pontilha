import { useEffect } from 'react';
import { toCss, toHex } from '../core/color';
import { sampleComposite } from '../core/doc';
import type { ToolId } from '../core/tools';
import { useApp } from '../state/store';

const HINTS: Record<ToolId, string> = {
  pencil: 'Right-click paints with the secondary color. Hold Alt to pick a color.',
  eraser: 'Erases to transparent.',
  line: 'Shift toggles perfect angles while dragging.',
  rect: 'Shift draws a square.',
  ellipse: 'Shift draws a circle.',
  fill: 'Right-click fills with the secondary color.',
  eyedropper: 'Right-click sets the secondary color.',
  select: 'Drag to select; drag inside to move. Shift adds to the selection. Arrows move 1 px, Shift+arrows 8 px.',
  wand: 'Click a color to select it; Shift+click adds. Drag inside the selection to move.',
};

export function StatusBar() {
  const hover = useApp((s) => s.hover);
  const tool = useApp((s) => s.tool);
  const notice = useApp((s) => s.notice);
  const controlPort = useApp((s) => s.controlPort);
  const width = useApp((s) => s.doc.width);
  const height = useApp((s) => s.doc.height);
  const under = useApp((s) =>
    s.hover && s.hover.x >= 0 && s.hover.y >= 0 && s.hover.x < width && s.hover.y < height
      ? sampleComposite(s.doc, s.hover.x, s.hover.y)
      : null,
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      if (useApp.getState().notice?.id === notice.id) useApp.setState({ notice: null });
    }, notice.tone === 'error' ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const inside = under !== null;

  return (
    <footer className="status">
      <span className="status-pos">{inside ? `${hover!.x}, ${hover!.y}` : '–'}</span>
      <span className="status-color">
        {inside && under >>> 24 ? (
          <>
            <span className="status-chip" style={{ '--swatch': toCss(under) } as React.CSSProperties} />
            {toHex(under)}
          </>
        ) : inside ? (
          'transparent'
        ) : null}
      </span>
      <span className={`status-message${notice?.tone === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
        {notice ? notice.text : `${HINTS[tool]} Space and drag pans the canvas.`}
      </span>
      {controlPort !== null && (
        <span className="status-control" title={`Scripts and agents control this window through port ${controlPort}`}>
          scripts on port {controlPort}
        </span>
      )}
      <span className="status-size">
        {width} × {height} px
      </span>
    </footer>
  );
}
