import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type ExportKind, exportImage } from '../app/fileActions';
import { type SheetLayout, docFromFrames, guessFrameSize, sheetGrid, sliceSheet } from '../core/animation';
import { toCss, toHex } from '../core/color';
import { MAX_FRAMES, MAX_SIZE, clampDuration, frameIndex, tagRange } from '../core/doc';
import { type ColorScope, hueShiftRamp, usedColors } from '../core/palette';
import { ANCHORS, type Anchor, contentBounds } from '../core/transform';
import { decodeImage, pickFile, withExtension } from '../platform/files';
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
    <Modal title="New image" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          close();
          actions.newDoc(w, h);
        }}
      >
        <div className="presets" role="group" aria-label="Common sizes">
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
            <span className="option-label">Width</span>
            <input inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value.replace(/\D/g, ''))} />
          </label>
          <span className="size-x">×</span>
          <label>
            <span className="option-label">Height</span>
            <input inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))} />
          </label>
          <span className="option-label">px</span>
        </div>
        {!ok && <p className="field-error">Use 1 to {MAX_SIZE} pixels on each side.</p>}
        {dirty && <p className="modal-note">The current image has unsaved changes. They will be lost.</p>}
        <div className="modal-actions">
          <button type="button" className="btn px" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary px" disabled={!ok} data-autofocus>
            Create image
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
  const doc = useApp((s) => s.doc);
  const loopMode = useApp((s) => s.loopMode);
  const playTag = useApp((s) => s.playTag);
  const tags = doc.tags.filter((t) => tagRange(doc, t));
  const [tagId, setTagId] = useState<string>(() => (tags.some((t) => t.id === playTag) ? playTag! : 'all'));
  const tag = tags.find((t) => t.id === tagId);
  const range = tag ? tagRange(doc, tag)! : undefined;
  const frameCount = range ? range[1] - range[0] + 1 : doc.frames.length;
  const [kind, setKind] = useState<ExportKind>(doc.frames.length > 1 ? 'gif' : 'frame');
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
    <Modal title="Export" onClose={close}>
      <div className="modal-tabs">
        <Segmented
          label="What to export"
          value={kind}
          options={[
            { value: 'frame', label: 'Current frame' },
            { value: 'sheet', label: 'Sprite sheet' },
            { value: 'gif', label: 'Animated GIF' },
          ]}
          onChange={setKind}
        />
      </div>
      {kind === 'frame' && <p className="modal-note">PNG of the frame on screen. Each pixel becomes a block of the chosen size, with no blurring.</p>}
      {kind !== 'frame' && tags.length > 0 && (
        <div className="export-options">
          <span className="option-label">Frames</span>
          <Segmented
            label="Which frames"
            value={tagId}
            options={[{ value: 'all', label: 'All' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]}
            onChange={setTagId}
          />
        </div>
      )}
      {kind === 'sheet' && (
        <>
          <p className="modal-note">
            PNG with the {frameCount} frames, left to right{layout === 'grid' ? ' and top to bottom' : ''}.
          </p>
          <div className="export-options">
            <Segmented
              label="Layout"
              value={layout}
              options={[
                { value: 'row', label: 'Row' },
                { value: 'grid', label: 'Grid' },
              ]}
              onChange={setLayout}
            />
          </div>
        </>
      )}
      {kind === 'gif' && (
        <>
          <p className="modal-note">
            Loops forever, with each frame’s duration. GIF holds up to 256 colors, and each pixel is either opaque or transparent.
          </p>
          <div className="export-options">
            <Toggle label="Ping-pong" checked={pingpong} onChange={setPingpong} />
          </div>
        </>
      )}
      <div className="scales" role="radiogroup" aria-label="Scale">
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
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary px"
          data-autofocus
          disabled={usable.length === 0}
          onClick={() => {
            close();
            void exportImage(kind, chosen, { layout, pingpong, range, suffix: tag?.name });
          }}
        >
          {kind === 'gif' ? 'Export GIF' : 'Export PNG'}
        </button>
      </div>
      {usable.length === 0 && <p className="field-error">Too large to export this way. Try the grid sheet.</p>}
    </Modal>
  );
}

const ANCHOR_NAMES: Record<Anchor, string> = {
  'top-left': 'top-left corner',
  top: 'top center',
  'top-right': 'top-right corner',
  left: 'middle left',
  center: 'center',
  right: 'middle right',
  'bottom-left': 'bottom-left corner',
  bottom: 'bottom center',
  'bottom-right': 'bottom-right corner',
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
      <p className="modal-note">The art doesn’t stretch: new space is transparent.</p>
      <div className="canvas-size">
        <div className="size-fields">
          <label>
            <span className="option-label">Width</span>
            <input inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value.replace(/\D/g, ''))} />
          </label>
          <span className="size-x">×</span>
          <label>
            <span className="option-label">Height</span>
            <input inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))} />
          </label>
          <span className="option-label">px</span>
        </div>
        <div className="anchor-field">
          <span className="option-label">Current image goes</span>
          <div className="anchors" role="radiogroup" aria-label="Where the current image goes">
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
        <p className="field-error">Use 1 to {MAX_SIZE} pixels on each side.</p>
      ) : (
        cuts && <p className="modal-note">The canvas is smaller than the image: whatever doesn’t fit will be cut off.</p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary px" disabled={!ok} data-autofocus>
          Resize canvas
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
      <p className="modal-note">Each pixel becomes a block of the chosen size, in every layer and frame, with no blurring.</p>
      {usable.length === 0 ? (
        <p className="field-error">The image is already too large to scale up (limit {MAX_SIZE} px).</p>
      ) : (
        <div className="scales" role="radiogroup" aria-label="Scale factor">
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
          Cancel
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
          Scale up
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
      <p className="modal-note">Crops the image in every layer and frame. Undo (Ctrl+Z) brings everything back.</p>
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
          <strong>Trim empty borders</strong>
          <span>
            {bounds === null
              ? 'The image is empty.'
              : trimmable
                ? `Becomes ${bounds.w} × ${bounds.h} px, only what is painted.`
                : 'There is no empty border around the art.'}
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
          <strong>Crop to selection</strong>
          <span>{selection ? `Becomes ${selection.w} × ${selection.h} px.` : 'Select an area with the Select tool (M).'}</span>
        </button>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close} data-autofocus>
          Cancel
        </button>
      </div>
    </>
  );
}

function CanvasDialog() {
  const [tab, setTab] = useState<'size' | 'scale' | 'crop'>('size');
  const close = () => actions.openDialog(null);
  return (
    <Modal title="Image size" onClose={close}>
      <div className="modal-tabs">
        <Segmented
          label="What to change"
          value={tab}
          options={[
            { value: 'size', label: 'Canvas' },
            { value: 'scale', label: 'Scale up' },
            { value: 'crop', label: 'Crop' },
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
  all: 'in every layer and frame',
  layer: 'in the active layer, in every frame',
  frame: 'in the frame on screen, in every layer',
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
    <Modal title="Replace color" onClose={close}>
      <div className="modal-tabs">
        <Segmented
          label="Where to replace"
          value={scope}
          options={[
            { value: 'all', label: 'Whole image' },
            { value: 'layer', label: 'Active layer' },
            { value: 'frame', label: 'Current frame' },
          ]}
          onChange={setScope}
        />
      </div>
      {used.length === 0 ? (
        <p className="modal-note">Nothing is painted here yet.</p>
      ) : (
        <>
          <p className="option-label recolor-label">Replace this color</p>
          <div className="swatches pick-swatches" role="group" aria-label="Colors used in the image">
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
          <p className="option-label recolor-label">With this one</p>
          <div className="swatches pick-swatches" role="group" aria-label="New color">
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
            {count} pixels {SCOPE_NOTES[scope]}. One undo step.
          </p>
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary px"
          data-autofocus
          disabled={from === null || count === 0 || from === to}
          onClick={() => {
            close();
            const n = actions.replaceColor(from!, to, scope);
            actions.notify(`${n} pixels changed from ${toHex(from!)} to ${toHex(to)}.`);
          }}
        >
          Replace color
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
    <Modal title="Color ramp" onClose={close}>
      <p className="modal-note">
        From the primary color ({toHex(primary)}): darker, more saturated shadows leaning toward blue, lighter highlights leaning toward
        yellow.
      </p>
      <div className="ramp-preview" role="img" aria-label={`Ramp: ${ramp.map(toHex).join(', ')}`}>
        {ramp.map((c) => (
          <div key={c} className={`ramp-step${c === primary ? ' is-base' : ''}`}>
            <span className="ramp-chip" style={{ '--swatch': toCss(c) } as React.CSSProperties} />
            <span className="ramp-hex">{toHex(c)}</span>
          </div>
        ))}
      </div>
      <div className="export-options">
        <Stepper label="Colors" value={steps} min={3} max={9} onChange={setSteps} />
        <Stepper label="Hue shift (°)" value={shift} min={0} max={30} onChange={setShift} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary px"
          data-autofocus
          onClick={() => {
            close();
            const added = actions.addColors(ramp);
            actions.notify(added ? `${added} new colors in the palette.` : 'These colors were already in the palette.');
          }}
        >
          Add to palette
        </button>
      </div>
    </Modal>
  );
}

function SheetDialog() {
  const dirty = useApp((s) => s.dirty);
  const [sheet, setSheet] = useState<{ name: string; width: number; height: number; pixels: Uint32Array } | null>(null);
  const [fw, setFw] = useState('');
  const [fh, setFh] = useState('');
  const [duration, setDuration] = useState('100');
  const [error, setError] = useState<string | null>(null);
  const close = () => actions.openDialog(null);
  const w = Number(fw);
  const h = Number(fh);
  const fits = !!sheet && Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= sheet.width && h <= sheet.height;
  const count = fits ? Math.floor(sheet.width / w) * Math.floor(sheet.height / h) : 0;
  const ms = Number(duration);
  const ok = fits && count <= MAX_FRAMES && Number.isFinite(ms) && ms > 0;

  const choose = async () => {
    const file = await pickFile([{ name: 'PNG image', extensions: ['png'] }]);
    if (!file) return;
    try {
      const image = await decodeImage(file.bytes);
      const guess = guessFrameSize(image.width, image.height);
      setSheet({ name: file.name, ...image });
      setFw(String(guess.w));
      setFh(String(guess.h));
      setError(null);
    } catch {
      setError('Could not read this image.');
    }
  };

  return (
    <Modal title="Import sprite sheet" onClose={close}>
      <p className="modal-note">Each cell of the sheet becomes a frame, left to right and top to bottom.</p>
      <div className="modal-actions sheet-pick">
        <button type="button" className="btn px" onClick={() => void choose()} data-autofocus={!sheet || undefined}>
          {sheet ? 'Choose another…' : 'Choose PNG…'}
        </button>
        {sheet && (
          <span className="option-label">
            {sheet.name}: {sheet.width} × {sheet.height} px
          </span>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
      {sheet && (
        <>
          <div className="size-fields">
            <label>
              <span className="option-label">Frame width</span>
              <input inputMode="numeric" value={fw} onChange={(e) => setFw(e.target.value.replace(/\D/g, ''))} />
            </label>
            <span className="size-x">×</span>
            <label>
              <span className="option-label">Height</span>
              <input inputMode="numeric" value={fh} onChange={(e) => setFh(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label>
              <span className="option-label">Duration (ms)</span>
              <input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>
          <p className={fits && count <= MAX_FRAMES ? 'modal-note' : 'field-error'}>
            {!fits
              ? 'The frame must fit inside the sheet.'
              : count > MAX_FRAMES
                ? `That would be ${count} frames; the maximum is ${MAX_FRAMES}.`
                : `${Math.floor(sheet.width / w)} × ${Math.floor(sheet.height / h)} cells: up to ${count} frames (empty ones at the end are left out).`}
          </p>
          {dirty && <p className="modal-note">The current image has unsaved changes. They will be lost.</p>}
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="btn px" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary px"
          disabled={!ok}
          data-autofocus={sheet ? true : undefined}
          onClick={() => {
            if (!sheet) return;
            close();
            const cells = sliceSheet(sheet.pixels, sheet.width, sheet.height, w, h);
            actions.loadDoc(docFromFrames(cells, w, h, clampDuration(ms)), {
              fileName: withExtension(sheet.name, 'pontilha'),
              filePath: null,
              dirty: true,
            });
            actions.notify(`${cells.length} frames imported from ${sheet.name}.`);
          }}
        >
          Import
        </button>
      </div>
    </Modal>
  );
}

function TagDialog() {
  const doc = useApp((s) => s.doc);
  const current = frameIndex(doc) + 1;
  const [name, setName] = useState('');
  const [from, setFrom] = useState(String(current));
  const [to, setTo] = useState(String(current));
  const close = () => actions.openDialog(null);
  const a = Number(from);
  const b = Number(to);
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= doc.frames.length;
  const taken = doc.tags.some((t) => t.name === name.trim());
  const ok = name.trim() !== '' && !taken && valid(a) && valid(b);
  return (
    <Modal title="Add tag" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          close();
          actions.addTag(name, doc.frames[a - 1].id, doc.frames[b - 1].id);
        }}
      >
        <p className="modal-note">A name for a stretch of the animation, like “walk” or “jump”. You can play and export just that part.</p>
        <div className="size-fields">
          <label>
            <span className="option-label">Name</span>
            <input className="tag-input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
          </label>
          <label>
            <span className="option-label">From frame</span>
            <input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label>
            <span className="option-label">To frame</span>
            <input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>
        {taken && <p className="field-error">A tag with this name already exists.</p>}
        {(!valid(a) || !valid(b)) && <p className="field-error">Use frames 1 to {doc.frames.length}.</p>}
        <div className="modal-actions">
          <button type="button" className="btn px" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary px" disabled={!ok}>
            Add tag
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDialog() {
  const request = useApp((s) => s.confirm)!;
  return (
    <Modal title={request.title ?? 'Confirm'} onClose={() => request.resolve(false)}>
      <p className="modal-text">{request.message}</p>
      <div className="modal-actions">
        <button type="button" className="btn px" data-autofocus={request.tone === 'danger' || undefined} onClick={() => request.resolve(false)}>
          {request.cancelLabel ?? 'Go back'}
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
  if (dialog === 'sheet') return <SheetDialog />;
  if (dialog === 'tag') return <TagDialog />;
  return null;
}
