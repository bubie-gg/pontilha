import { useEffect, useRef, useState } from 'react';
import { checkerTile } from '../canvas/layerCache';
import { type Frame, MAX_DURATION, MIN_DURATION, composite, tagRange } from '../core/doc';
import { actions, useApp } from '../state/store';
import { IconButton, Segmented, Stepper, Toggle } from './controls';

/** Pointer travel before a press on a frame becomes a drag. */
const DRAG_THRESHOLD = 4;

let scratch: HTMLCanvasElement | null = null;

/** Draws one frame, flattened, fitted inside the thumbnail canvas over a checkerboard. */
function drawThumb(canvas: HTMLCanvasElement, frameId: string) {
  const { doc } = useApp.getState();
  if (!doc.frames.some((f) => f.id === frameId)) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  scratch ??= document.createElement('canvas');
  if (scratch.width !== doc.width || scratch.height !== doc.height) {
    scratch.width = doc.width;
    scratch.height = doc.height;
  }
  const pixels = composite(doc, frameId);
  scratch.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), doc.width, doc.height), 0, 0);

  const ctx = canvas.getContext('2d')!;
  const fit = Math.min(w / doc.width, h / doc.height);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  const dw = Math.round(doc.width * scale);
  const dh = Math.round(doc.height * scale);
  const x = Math.round((w - dw) / 2);
  const y = Math.round((h - dh) / 2);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  const pattern = ctx.createPattern(checkerTile(Math.max(2, Math.round(3 * dpr))), 'repeat')!;
  pattern.setTransform(new DOMMatrix([1, 0, 0, 1, x, y]));
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, dw, dh);
  ctx.drawImage(scratch, x, y, dw, dh);
}

/**
 * Keeps a thumbnail current. Strokes only touch the frame on screen, so other
 * thumbnails wait until the document settles instead of redrawing every stroke.
 */
function useThumbnail(frameId: string) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    let raf = 0;
    let idle = 0;
    const request = () => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          drawThumb(canvas, frameId);
        });
      }
    };
    const unsubscribe = useApp.subscribe((s, prev) => {
      if (s.doc !== prev.doc || s.doc.layers !== prev.doc.layers || s.doc.frames !== prev.doc.frames) {
        request();
      } else if (s.version !== prev.version) {
        if (s.doc.frame === frameId) request();
        else {
          clearTimeout(idle);
          idle = window.setTimeout(request, 400);
        }
      }
    });
    const resize = new ResizeObserver(request);
    resize.observe(canvas);
    request();
    return () => {
      unsubscribe();
      resize.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(idle);
    };
  }, [frameId]);
  return ref;
}

function FrameThumb({
  frame,
  number,
  active,
  dragging,
  onPointerDown,
}: {
  frame: Frame;
  number: number;
  active: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const ref = useThumbnail(frame.id);
  return (
    <li className={`frame${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}`} data-frame={frame.id}>
      <button
        type="button"
        className="frame-btn px"
        aria-label={`Frame ${number}, ${frame.duration} ms`}
        aria-pressed={active}
        title="Click to show. Drag to reorder. Shift+arrows also move it."
        onPointerDown={onPointerDown}
        onClick={() => actions.selectFrame(frame.id)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const step = e.key === 'ArrowLeft' ? -1 : 1;
          const moving = e.shiftKey;
          if (moving) actions.moveFrame(frame.id, number - 1 + step);
          else actions.stepFrame(step);
          // Keep keyboard focus on the frame that is now active.
          requestAnimationFrame(() => {
            const id = moving ? frame.id : useApp.getState().doc.frame;
            document.querySelector<HTMLButtonElement>(`[data-frame="${id}"] .frame-btn`)?.focus();
          });
        }}
      >
        <canvas ref={ref} className="frame-thumb" aria-hidden="true" />
        <span className="frame-number">{number}</span>
      </button>
      <span className="frame-duration">{frame.duration} ms</span>
    </li>
  );
}

/** Thumbnail width plus the gap between thumbnails, in CSS pixels; matches `.frame-btn` and `.frames`. */
const FRAME_PITCH = 58;
const STRIP_PADDING = 10;

/** Named stretches above the thumbnails. Clicking one loops playback over it. */
function TagRow() {
  const doc = useApp((s) => s.doc);
  const tags = useApp((s) => s.doc.tags);
  const playTag = useApp((s) => s.playTag);
  if (tags.length === 0) return null;
  return (
    <div className="tag-row" style={{ width: STRIP_PADDING * 2 + doc.frames.length * FRAME_PITCH }}>
      {tags.map((tag) => {
        const range = tagRange(doc, tag);
        if (!range) return null;
        const [start, end] = range;
        const on = playTag === tag.id;
        return (
          <div
            key={tag.id}
            className={`tag px${on ? ' is-on' : ''}`}
            style={{ left: STRIP_PADDING + start * FRAME_PITCH, width: (end - start + 1) * FRAME_PITCH - 6 }}
          >
            <button
              type="button"
              className="tag-name"
              aria-pressed={on}
              title={on ? 'Playing only this tag. Click to go back to the whole animation.' : `Play only ${tag.name} (frames ${start + 1} to ${end + 1})`}
              onClick={() => actions.setPlayTag(on ? null : tag.id)}
            >
              {tag.name}
            </button>
            <button type="button" className="tag-delete" aria-label={`Delete the tag ${tag.name}`} title="Delete the tag (the frames stay)" onClick={() => actions.deleteTag(tag.id)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Duration of the frame on screen, committed on Enter or when the field loses focus. */
function DurationField({ frame }: { frame: Frame }) {
  const [text, setText] = useState(String(frame.duration));
  useEffect(() => setText(String(frame.duration)), [frame.id, frame.duration]);
  const value = Number(text);
  const valid = Number.isFinite(value) && value >= MIN_DURATION && value <= MAX_DURATION;
  const commit = () => {
    if (valid) actions.setFrameDuration(frame.id, value);
    else setText(String(frame.duration));
  };
  return (
    <label className="duration-field" title={`From ${MIN_DURATION} to ${MAX_DURATION} ms. 100 ms gives 10 frames per second.`}>
      <span className="option-label">Duration</span>
      <input
        inputMode="numeric"
        value={text}
        className={valid ? '' : 'is-invalid'}
        aria-label="Frame duration in milliseconds"
        onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(String(frame.duration));
            e.currentTarget.blur();
          }
        }}
      />
      <span className="option-label">ms</span>
    </label>
  );
}

export function Timeline() {
  const frames = useApp((s) => s.doc.frames);
  const current = useApp((s) => s.doc.frame);
  const playing = useApp((s) => s.playing);
  const loopMode = useApp((s) => s.loopMode);
  const onionSkin = useApp((s) => s.onionSkin);
  const onion = useApp((s) => s.onion);
  const stripRef = useRef<HTMLOListElement>(null);
  const press = useRef<{ id: string; x: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);

  const index = Math.max(0, frames.findIndex((f) => f.id === current));
  const single = frames.length < 2;

  // While dragging, show the order the frames would end up in.
  const shown = drag
    ? (() => {
        const rest = frames.filter((f) => f.id !== drag.id);
        return rest.toSpliced(drag.to, 0, frames.find((f) => f.id === drag.id)!);
      })()
    : frames;

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('.frame.is-active');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  const dropIndex = (clientX: number, id: string) => {
    const others = [...(stripRef.current?.querySelectorAll<HTMLElement>('.frame') ?? [])].filter((el) => el.dataset.frame !== id);
    return others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 < clientX;
    }).length;
  };

  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    press.current = { id, x: e.clientX, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.abs(e.clientX - p.x) < DRAG_THRESHOLD) return;
    p.moved = true;
    setDrag({ id: p.id, to: dropIndex(e.clientX, p.id) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (p?.moved) actions.moveFrame(p.id, dropIndex(e.clientX, p.id));
    setDrag(null);
  };

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-bar">
        <div className="bar-group">
          <IconButton icon="prev" label="Previous frame (,)" disabled={single} onClick={() => actions.stepFrame(-1)} />
          <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause (Enter)' : 'Play (Enter)'} active={playing} onClick={actions.togglePlay} />
          <IconButton icon="next" label="Next frame (.)" disabled={single} onClick={() => actions.stepFrame(1)} />
        </div>
        <Segmented
          label="Loop mode"
          value={loopMode}
          options={[
            { value: 'loop', label: 'Loop' },
            { value: 'pingpong', label: 'Ping-pong' },
          ]}
          onChange={actions.setLoopMode}
        />
        <IconButton
          icon="onion"
          label="Onion skin: shows neighboring frames underneath"
          active={onionSkin}
          onClick={actions.toggleOnionSkin}
        />
        {onionSkin && (
          <>
            <Stepper label="Before" value={onion.before} min={0} max={3} onChange={(before) => actions.setOnion({ before })} />
            <Stepper label="After" value={onion.after} min={0} max={3} onChange={(after) => actions.setOnion({ after })} />
            <Toggle
              label="Tinted"
              checked={onion.tint}
              title="Previous frames in red, next ones in blue"
              onChange={(tint) => actions.setOnion({ tint })}
            />
          </>
        )}
        <DurationField frame={frames[index]} />
        <span className="timeline-meta">
          Frame {index + 1} of {frames.length}
        </span>
        <div className="bar-spacer" />
        <div className="bar-group">
          <IconButton icon="tag" label="Add tag: name a range of frames" onClick={() => actions.openDialog('tag')} />
          <IconButton icon="open" label="Import a sprite sheet as frames" onClick={() => actions.openDialog('sheet')} />
          <IconButton icon="plus" label="New empty frame" onClick={() => actions.addFrame()} />
          <IconButton icon="duplicate" label="Duplicate frame" onClick={() => actions.addFrame({ copy: true })} />
          <IconButton icon="trash" label="Delete frame" disabled={single} onClick={() => actions.deleteFrame()} />
        </div>
      </div>
      <div className="frames-scroll">
        <TagRow />
        <ol
          className="frames"
          ref={stripRef}
          aria-label="Frames"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            press.current = null;
            setDrag(null);
          }}
        >
          {shown.map((frame) => (
            <FrameThumb
              key={frame.id}
              frame={frame}
              number={frames.indexOf(frame) + 1}
              active={frame.id === current}
              dragging={drag?.id === frame.id}
              onPointerDown={onPointerDown(frame.id)}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}
