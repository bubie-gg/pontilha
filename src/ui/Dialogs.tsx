import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type ExportKind, exportImage } from '../app/fileActions';
import { type SheetLayout, sheetGrid } from '../core/animation';
import { toCss, toHex } from '../core/color';
import { MAX_SIZE } from '../core/doc';
import { type ColorScope, hueShiftRamp, usedColors } from '../core/palette';
import { ANCHORS, type Anchor, contentBounds } from '../core/transform';
import { actions, useApp } from '../state/store';
import { Segmented, Stepper, Toggle } from './controls';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    (root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('button, input'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal px" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const PRESETS = [16, 32, 48, 64, 128, 256];

function NewDialog() {
  const dirty = useApp((s) => s.dirty);
  const [width, setWidth] = useState('32');
  const [height, setHeight] = useState('32');
  const close = () => actions.openDialog(null);
  const w = Number(width);
  const h = Number(height);
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_SIZE;
  const ok = valid(w) && valid(h);

  return (
    <Modal title="Nova imagem" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          close();
          actions.newDoc(w, h);
        }}
      >
        <div className="presets" role="group" aria-label="Tamanhos comuns">
          {PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className={`preset px${w === n && h === n ? ' is-on' : ''}`}
              onClick={() => {
                setWidth(String(n));
                setHeight(String(n));
              }}
            >
              <span className="preset-box" style={{ width: 6 + Math.log2(n) * 4, height: 6 + Math.log2(n) * 4 }} />
              {n} × {n}
            </button>
          ))}
        </div>
        <div className="size-fields">
          <label>
            <span className="option-label">Largura</span>
            <input inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value.replace(/\D/g, ''))} />
          </label>
          <span className="size-x">×</span>
          <label>
            <span className="option-label">Altura</span>
            <input inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))} />
          </label>
          <span className="option-label">px</span>
        </div>
        {!ok && <p className="field-error">Use de 1 a {MAX_SIZE} pixels em cada lado.</p>}
        {dirty && <p className="modal-note">A imagem atual tem alterações não salvas. Elas serão perdidas.</p>}
        <div className="modal-actions">
          <button type="button" className="btn px" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary px" disabled={!ok} data-autofocus>
            Criar imagem
          </button>
        </div>
      </form>
    </Modal>
  );
}

const SCALES = [1, 2, 4, 8, 16];

/** Largest side each kind of export may reach, in pixels. */
const LIMITS: Record<ExportKind, number> = { frame: 8192, sheet: 16384, gif: 4096 };

function ExportDialog() {
  const width = useApp((s) => s.doc.width);
  const height = useApp((s) => s.doc.height);
  const frameCount = useApp((s) => s.doc.frames.length);
  const loopMode = useApp((s) => s.loopMode);
  const [kind, setKind] = useState<ExportKind>(frameCount > 1 ? 'gif' : 'frame');
  const [layout, setLayout] = useState<SheetLayout>('row');
  const [pingpong, setPingpong] = useState(loopMode === 'pingpong');
  const [scale, setScale] = useState(1);
  const close = () => actions.openDialog(null);

  const { cols, rows } = kind === 'sheet' ? sheetGrid(frameCount, layout) : { cols: 1, rows: 1 };
  const outW = (s: number) => cols * width * s;
  const outH = (s: number) => rows * height * s;
  const usable = SCALES.filter((s) => outW(s) <= LIMITS[kind] && outH(s) <= LIMITS[kind]);
  const chosen = usable.includes(scale) ? scale : (usable.at(-1) ?? 1);

  return (
    <Modal title="Exportar" onClose={close}>
      <div className="modal-tabs">
        <Segmented
          label="O que exportar"
          value={kind}
          options={[
            { value: 'frame', label: 'Quadro atual' },
            { value: 'sheet', label: 'Folha de sprites' },
            { value: 'gif', label: 'GIF animado' },
          ]}
          onChange={setKind}
        />
      </div>
      {kind === 'frame' && <p className="modal-note">PNG do quadro na tela. Cada pixel vira um bloco do tamanho escolhido, sem borrar.</p>}
      {kind === 'sheet' && (
        <>
          <p className="modal-note">
            PNG com os {frameCount} quadros, da esquerda para a direita{layout === 'grid' ? ' e de cima para baixo' : ''}.
          </p>
          <div className="export-options">
            <Segmented
              label="Arrumação"
              value={layout}
              options={[
                { value: 'row', label: 'Em linha' },
                { value: 'grid', label: 'Em grade' },
              ]}
              onChange={setLayout}
            />
          </div>
        </>
      )}
      {kind === 'gif' && (
        <>
          <p className="modal-note">
            Repete para sempre, com a duração de cada quadro. GIF guarda até 256 cores, e cada pixel é opaco ou transparente.
          </p>
          <div className="export-options">
            <Toggle label="Ida e volta" checked={pingpong} onChange={setPingpong} />
          </div>
        </>
      )}
      <div className="scales" role="radiogroup" aria-label="Escala">
        {usable.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={chosen === s}
            className={`scale px${chosen === s ? ' is-on' : ''}`}
            onClick={() => setScale(s)}
          >
            <strong>{s}×</strong>
            <span>
              {outW(s)} × {outH(s)}
            </span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary px"
          data-autofocus
          disabled={usable.length === 0}
          onClick={() => {
            close();
            void exportImage(kind, chosen, { layout, pingpong });
          }}
        >
          {kind === 'gif' ? 'Exportar GIF' : 'Exportar PNG'}
        </button>
      </div>
      {usable.length === 0 && <p className="field-error">Grande demais para exportar assim. Tente a folha em grade.</p>}
    </Modal>
  );
}

const ANCHOR_NAMES: Record<Anchor, string> = {
  'top-left': 'no canto de cima à esquerda',
  top: 'em cima, no meio',
  'top-right': 'no canto de cima à direita',
  left: 'à esquerda, no meio',
  center: 'no centro',
  right: 'à direita, no meio',
  'bottom-left': 'no canto de baixo à esquerda',
  bottom: 'embaixo, no meio',
  'bottom-right': 'no canto de baixo à direita',
};

function CanvasSize({ close }: { close: () => void }) {
  const doc = useApp((s) => s.doc);
  const [width, setWidth] = useState(String(doc.width));
  const [height, setHeight] = useState(String(doc.height));
  const [anchor, setAnchor] = useState<Anchor>('center');
  const w = Number(width);
  const h = Number(height);
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_SIZE;
  const ok = valid(w) && valid(h) && (w !== doc.width || h !== doc.height);
  const cuts = valid(w) && valid(h) && (w < doc.width || h < doc.height);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        close();
        actions.resizeCanvas(w, h, anchor);
      }}
    >
      <p className="modal-note">A arte não estica: o espaço novo fica transparente.</p>
      <div className="canvas-size">
        <div className="size-fields">
          <label>
            <span className="option-label">Largura</span>
            <input inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value.replace(/\D/g, ''))} />
          </label>
          <span className="size-x">×</span>
          <label>
            <span className="option-label">Altura</span>
            <input inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))} />
          </label>
          <span className="option-label">px</span>
        </div>
        <div className="anchor-field">
          <span className="option-label">Imagem atual fica</span>
          <div className="anchors" role="radiogroup" aria-label="Onde a imagem atual fica">
            {ANCHORS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={anchor === a}
                aria-label={ANCHOR_NAMES[a]}
                title={ANCHOR_NAMES[a]}
                className={`anchor px${anchor === a ? ' is-on' : ''}`}
                onClick={() => setAnchor(a)}
              />
            ))}
          </div>
        </div>
      </div>
      {!valid(w) || !valid(h) ? (
        <p className="field-error">Use de 1 a {MAX_SIZE} pixels em cada lado.</p>
      ) : (
        cuts && <p className="modal-note">A tela fica menor que a imagem: o que não couber será cortado.</p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary px" disabled={!ok} data-autofocus>
          Mudar tela
        </button>
      </div>
    </form>
  );
}

const FACTORS = [2, 3, 4, 8];

function CanvasScale({ close }: { close: () => void }) {
  const width = useApp((s) => s.doc.width);
  const height = useApp((s) => s.doc.height);
  const [factor, setFactor] = useState(2);
  const usable = FACTORS.filter((f) => width * f <= MAX_SIZE && height * f <= MAX_SIZE);
  const chosen = usable.includes(factor) ? factor : usable[0];
  return (
    <>
      <p className="modal-note">Cada pixel vira um bloco do tamanho escolhido, em todas as camadas e quadros, sem borrar.</p>
      {usable.length === 0 ? (
        <p className="field-error">A imagem já é grande demais para ampliar (limite de {MAX_SIZE} px).</p>
      ) : (
        <div className="scales" role="radiogroup" aria-label="Ampliação">
          {usable.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={chosen === f}
              className={`scale px${chosen === f ? ' is-on' : ''}`}
              onClick={() => setFactor(f)}
            >
              <strong>{f}×</strong>
              <span>
                {width * f} × {height * f}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary px"
          data-autofocus
          disabled={chosen === undefined}
          onClick={() => {
            close();
            actions.scaleImage(chosen);
          }}
        >
          Ampliar
        </button>
      </div>
    </>
  );
}

function CanvasCrop({ close }: { close: () => void }) {
  const doc = useApp((s) => s.doc);
  const selection = useApp((s) => s.selection);
  // Content only changes while the dialog is closed, so measure once.
  const [bounds] = useState(() => contentBounds(doc));
  const trimmable = bounds !== null && (bounds.w !== doc.width || bounds.h !== doc.height);
  return (
    <>
      <p className="modal-note">Corta a imagem em todas as camadas e quadros. Desfazer (Ctrl+Z) traz tudo de volta.</p>
      <div className="crop-choices">
        <button
          type="button"
          className="crop-choice px"
          disabled={!trimmable}
          onClick={() => {
            close();
            actions.trim();
          }}
        >
          <strong>Cortar bordas vazias</strong>
          <span>
            {bounds === null
              ? 'A imagem está vazia.'
              : trimmable
                ? `Fica com ${bounds.w} × ${bounds.h} px, só o que está pintado.`
                : 'Não há borda vazia em volta da arte.'}
          </span>
        </button>
        <button
          type="button"
          className="crop-choice px"
          disabled={!selection}
          onClick={() => {
            close();
            actions.cropTo();
          }}
        >
          <strong>Recortar na seleção</strong>
          <span>{selection ? `Fica com ${selection.w} × ${selection.h} px.` : 'Selecione uma área com a ferramenta Seleção (M).'}</span>
        </button>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close} data-autofocus>
          Cancelar
        </button>
      </div>
    </>
  );
}

function CanvasDialog() {
  const [tab, setTab] = useState<'size' | 'scale' | 'crop'>('size');
  const close = () => actions.openDialog(null);
  return (
    <Modal title="Tamanho da imagem" onClose={close}>
      <div className="modal-tabs">
        <Segmented
          label="O que mudar"
          value={tab}
          options={[
            { value: 'size', label: 'Tela' },
            { value: 'scale', label: 'Ampliar' },
            { value: 'crop', label: 'Recortar' },
          ]}
          onChange={setTab}
        />
      </div>
      {tab === 'size' && <CanvasSize close={close} />}
      {tab === 'scale' && <CanvasScale close={close} />}
      {tab === 'crop' && <CanvasCrop close={close} />}
    </Modal>
  );
}

function PickSwatch({ color, on, label, onClick }: { color: number; on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`swatch${on ? ' is-primary' : ''}`}
      style={{ '--swatch': toCss(color) } as React.CSSProperties}
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
    />
  );
}

const SCOPE_NOTES: Record<ColorScope, string> = {
  all: 'em todas as camadas e quadros',
  layer: 'na camada ativa, em todos os quadros',
  frame: 'no quadro na tela, em todas as camadas',
};

function RecolorDialog() {
  const doc = useApp((s) => s.doc);
  const activeLayerId = useApp((s) => s.activeLayerId);
  const primary = useApp((s) => s.primary);
  const secondary = useApp((s) => s.secondary);
  const palette = useApp((s) => s.palette);
  const [scope, setScope] = useState<ColorScope>('all');
  // The image can't change while the dialog is open, so counting per scope is enough.
  const used = useMemo(() => usedColors(doc, scope, activeLayerId, doc.frame), [doc, scope, activeLayerId]);
  const [from, setFrom] = useState<number | null>(() => {
    const all = usedColors(doc, 'all', activeLayerId, doc.frame);
    return all.some((u) => u.color === primary) ? primary : (all[0]?.color ?? null);
  });
  const [to, setTo] = useState(() => (from === primary ? secondary : primary));
  const targets = [primary, secondary, ...palette].filter((c, i, list) => c >>> 24 && list.indexOf(c) === i);
  const count = used.find((u) => u.color === from)?.pixels ?? 0;
  const close = () => actions.openDialog(null);

  return (
    <Modal title="Trocar cor" onClose={close}>
      <div className="modal-tabs">
        <Segmented
          label="Onde trocar"
          value={scope}
          options={[
            { value: 'all', label: 'Imagem inteira' },
            { value: 'layer', label: 'Camada ativa' },
            { value: 'frame', label: 'Quadro atual' },
          ]}
          onChange={setScope}
        />
      </div>
      {used.length === 0 ? (
        <p className="modal-note">Não há nada pintado aqui ainda.</p>
      ) : (
        <>
          <p className="option-label recolor-label">Trocar esta cor</p>
          <div className="swatches pick-swatches" role="group" aria-label="Cores usadas na imagem">
            {used.slice(0, 96).map(({ color, pixels }) => (
              <PickSwatch
                key={color}
                color={color}
                on={color === from}
                label={`${toHex(color)}, ${pixels} pixels`}
                onClick={() => setFrom(color)}
              />
            ))}
          </div>
          <p className="option-label recolor-label">Por esta</p>
          <div className="swatches pick-swatches" role="group" aria-label="Nova cor">
            {targets.map((color) => (
              <PickSwatch key={color} color={color} on={color === to} label={toHex(color)} onClick={() => setTo(color)} />
            ))}
          </div>
          <div className="recolor-preview">
            {from !== null && <span className="recolor-chip" style={{ '--swatch': toCss(from) } as React.CSSProperties} />}
            <span>{from !== null ? toHex(from) : '–'}</span>
            <span className="recolor-arrow">→</span>
            <span className="recolor-chip" style={{ '--swatch': toCss(to) } as React.CSSProperties} />
            <span>{toHex(to)}</span>
          </div>
          <p className="modal-note">
            {count} pixels {SCOPE_NOTES[scope]}. Um passo de desfazer.
          </p>
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary px"
          data-autofocus
          disabled={from === null || count === 0 || from === to}
          onClick={() => {
            close();
            const n = actions.replaceColor(from!, to, scope);
            actions.notify(`${n} pixels trocados de ${toHex(from!)} para ${toHex(to)}.`);
          }}
        >
          Trocar cor
        </button>
      </div>
    </Modal>
  );
}

function RampDialog() {
  const primary = useApp((s) => s.primary);
  const [steps, setSteps] = useState(5);
  const [shift, setShift] = useState(12);
  const ramp = hueShiftRamp(primary, steps, shift);
  const close = () => actions.openDialog(null);
  return (
    <Modal title="Rampa de cores" onClose={close}>
      <p className="modal-note">
        A partir da cor principal ({toHex(primary)}): sombras mais escuras e saturadas puxando para o azul, luzes mais claras puxando para o
        amarelo.
      </p>
      <div className="ramp-preview" role="img" aria-label={`Rampa: ${ramp.map(toHex).join(', ')}`}>
        {ramp.map((c) => (
          <div key={c} className={`ramp-step${c === primary ? ' is-base' : ''}`}>
            <span className="ramp-chip" style={{ '--swatch': toCss(c) } as React.CSSProperties} />
            <span className="ramp-hex">{toHex(c)}</span>
          </div>
        ))}
      </div>
      <div className="export-options">
        <Stepper label="Cores" value={steps} min={3} max={9} onChange={setSteps} />
        <Stepper label="Giro de matiz (°)" value={shift} min={0} max={30} onChange={setShift} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary px"
          data-autofocus
          onClick={() => {
            close();
            const added = actions.addColors(ramp);
            actions.notify(added ? `${added} cores novas na paleta.` : 'Essas cores já estavam na paleta.');
          }}
        >
          Adicionar à paleta
        </button>
      </div>
    </Modal>
  );
}

function ConfirmDialog() {
  const request = useApp((s) => s.confirm)!;
  return (
    <Modal title={request.title ?? 'Confirmar'} onClose={() => request.resolve(false)}>
      <p className="modal-text">{request.message}</p>
      <div className="modal-actions">
        <button type="button" className="btn px" data-autofocus={request.tone === 'danger' || undefined} onClick={() => request.resolve(false)}>
          {request.cancelLabel ?? 'Voltar'}
        </button>
        <button
          type="button"
          className={`btn ${request.tone === 'danger' ? 'btn-danger' : 'btn-primary'} px`}
          data-autofocus={request.tone === 'safe' || undefined}
          onClick={() => request.resolve(true)}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const confirm = useApp((s) => s.confirm);
  if (confirm) return <ConfirmDialog />;
  if (dialog === 'new') return <NewDialog />;
  if (dialog === 'export') return <ExportDialog />;
  if (dialog === 'canvas') return <CanvasDialog />;
  if (dialog === 'recolor') return <RecolorDialog />;
  if (dialog === 'ramp') return <RampDialog />;
  return null;
}
