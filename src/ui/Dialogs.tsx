import { type ReactNode, useEffect, useRef, useState } from 'react';
import { exportPng } from '../app/fileActions';
import { MAX_SIZE } from '../core/doc';
import { actions, useApp } from '../state/store';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, input')?.focus();
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

function ExportDialog() {
  const width = useApp((s) => s.doc.width);
  const height = useApp((s) => s.doc.height);
  const [scale, setScale] = useState(1);
  const close = () => actions.openDialog(null);
  const usable = SCALES.filter((s) => width * s <= 8192 && height * s <= 8192);

  return (
    <Modal title="Exportar PNG" onClose={close}>
      <p className="modal-note">Cada pixel vira um bloco do tamanho escolhido, sem borrar.</p>
      <div className="scales" role="radiogroup" aria-label="Escala">
        {usable.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={scale === s}
            className={`scale px${scale === s ? ' is-on' : ''}`}
            onClick={() => setScale(s)}
          >
            <strong>{s}×</strong>
            <span>
              {width * s} × {height * s}
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
          onClick={() => {
            close();
            void exportPng(scale);
          }}
        >
          Exportar PNG
        </button>
      </div>
    </Modal>
  );
}

function ConfirmDialog() {
  const request = useApp((s) => s.confirm)!;
  return (
    <Modal title="Confirmar" onClose={() => request.resolve(false)}>
      <p className="modal-text">{request.message}</p>
      <div className="modal-actions">
        <button type="button" className="btn px" data-autofocus onClick={() => request.resolve(false)}>
          Voltar
        </button>
        <button type="button" className="btn btn-danger px" onClick={() => request.resolve(true)}>
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
  return null;
}
