import { useEffect, useRef, useState } from 'react';
import { type HSV, hsvToRgb, pack, parseHex, rgbToHsv, toHex, unpack } from '../core/color';
import { actions, useApp } from '../state/store';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function hsvOf(color: number, previous?: HSV): HSV {
  const { r, g, b } = unpack(color);
  const hsv = rgbToHsv(r, g, b);
  // Greys and black have no hue of their own; keep the slider where the user left it.
  if (previous && (hsv.s === 0 || hsv.v === 0)) return { ...hsv, h: previous.h, s: hsv.v === 0 ? previous.s : 0 };
  return hsv;
}

/** Pointer drag over an element, reporting the position as fractions of its size. */
function useDrag(onMove: (fx: number, fy: number) => void) {
  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const report = (ev: { clientX: number; clientY: number }) => {
        const r = el.getBoundingClientRect();
        onMove(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
      };
      report(e);
      const move = (ev: PointerEvent) => report(ev);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    },
  };
}

function arrowDelta(e: React.KeyboardEvent, step = 0.02): [number, number] | null {
  const big = e.shiftKey ? 5 : 1;
  switch (e.key) {
    case 'ArrowLeft':
      return [-step * big, 0];
    case 'ArrowRight':
      return [step * big, 0];
    case 'ArrowUp':
      return [0, -step * big];
    case 'ArrowDown':
      return [0, step * big];
    default:
      return null;
  }
}

export function ColorPicker() {
  const primary = useApp((s) => s.primary);
  const [hsv, setHsv] = useState(() => hsvOf(primary));
  const [hexText, setHexText] = useState(toHex(primary));
  const [hexError, setHexError] = useState(false);
  const own = useRef(primary);
  const alpha = primary >>> 24;

  useEffect(() => {
    setHexText(toHex(primary));
    setHexError(false);
    if (primary === own.current) return;
    own.current = primary;
    setHsv((prev) => hsvOf(primary, prev));
  }, [primary]);

  const apply = (next: HSV, a = alpha) => {
    setHsv(next);
    const { r, g, b } = hsvToRgb(next.h, next.s, next.v);
    const color = pack(r, g, b, a);
    own.current = color;
    actions.setPrimary(color);
  };

  const sv = useDrag((fx, fy) => apply({ ...hsv, s: fx, v: 1 - fy }));
  const hue = useDrag((fx) => apply({ ...hsv, h: fx * 360 }));
  const opacity = useDrag((fx) => apply(hsv, Math.round(fx * 255)));

  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const solid = `rgb(${r} ${g} ${b})`;

  const commitHex = () => {
    const parsed = parseHex(hexText);
    if (parsed === null) {
      setHexError(true);
      return;
    }
    actions.setPrimary(parsed);
  };

  return (
    <div className="picker">
      <div
        className="picker-sv"
        style={{ '--hue': `hsl(${hsv.h} 100% 50%)` } as React.CSSProperties}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        {...sv}
        onKeyDown={(e) => {
          const d = arrowDelta(e);
          if (!d) return;
          e.preventDefault();
          apply({ ...hsv, s: clamp01(hsv.s + d[0]), v: clamp01(hsv.v - d[1]) });
        }}
      >
        <span className="picker-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>

      <div
        className="picker-strip picker-hue"
        role="slider"
        tabIndex={0}
        aria-label="Matiz"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        {...hue}
        onKeyDown={(e) => {
          const d = arrowDelta(e, 2 / 360);
          if (!d) return;
          e.preventDefault();
          apply({ ...hsv, h: (hsv.h + (d[0] - d[1]) * 360 + 360) % 360 });
        }}
      >
        <span className="picker-mark" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      <div
        className="picker-strip picker-alpha"
        style={{ '--solid': solid } as React.CSSProperties}
        role="slider"
        tabIndex={0}
        aria-label="Color opacity"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((alpha / 255) * 100)}
        {...opacity}
        onKeyDown={(e) => {
          const d = arrowDelta(e);
          if (!d) return;
          e.preventDefault();
          apply(hsv, Math.round(clamp01(alpha / 255 + d[0] - d[1]) * 255));
        }}
      >
        <span className="picker-mark" style={{ left: `${(alpha / 255) * 100}%` }} />
      </div>

      <div className="picker-row">
        <label className="hex-field">
          <span className="option-label">Hex</span>
          <input
            className={hexError ? 'is-invalid' : ''}
            value={hexText}
            spellCheck={false}
            aria-invalid={hexError}
            onChange={(e) => {
              setHexText(e.target.value);
              setHexError(false);
            }}
            onBlur={commitHex}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitHex();
              if (e.key === 'Escape') setHexText(toHex(primary));
            }}
          />
        </label>
        <span className="alpha-readout">{Math.round((alpha / 255) * 100)}%</span>
      </div>
      {hexError && <p className="field-error">Use the #rrggbb format, for example #c93c4a.</p>}
    </div>
  );
}
