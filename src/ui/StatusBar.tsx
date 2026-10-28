import { useEffect } from 'react';
import { toCss, toHex } from '../core/color';
import { sampleComposite } from '../core/doc';
import type { ToolId } from '../core/tools';
import { useApp } from '../state/store';

const HINTS: Record<ToolId, string> = {
  pencil: 'Botão direito pinta com a cor secundária. Segure Alt para pegar uma cor.',
  eraser: 'Apaga para transparente.',
  line: 'Shift liga ou desliga o ângulo perfeito enquanto arrasta.',
  rect: 'Shift desenha um quadrado.',
  ellipse: 'Shift desenha um círculo.',
  fill: 'Botão direito preenche com a cor secundária.',
  eyedropper: 'Botão direito define a cor secundária.',
  select: 'Arraste para selecionar; arraste dentro para mover. Shift soma à seleção. Setas movem 1 px, Shift+setas 8 px.',
  wand: 'Clique numa cor para selecionar; Shift+clique soma. Arraste dentro da seleção para mover.',
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
          'transparente'
        ) : null}
      </span>
      <span className={`status-message${notice?.tone === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
        {notice ? notice.text : `${HINTS[tool]} Espaço e arrastar move a tela.`}
      </span>
      {controlPort !== null && (
        <span className="status-control" title={`Scripts e agentes controlam esta janela pela porta ${controlPort}`}>
          scripts na porta {controlPort}
        </span>
      )}
      <span className="status-size">
        {width} × {height} px
      </span>
    </footer>
  );
}
