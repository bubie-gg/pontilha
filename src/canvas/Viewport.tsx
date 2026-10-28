import { useEffect, useRef } from 'react';
import { pixelAt, sampleComposite } from '../core/doc';
import { type Session, startSession } from '../core/tools';
import { type View, actions, activeLayer, useApp } from '../state/store';
import { renderViewport } from './renderer';

type Gesture =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'draw'; session: Session }
  | { kind: 'pick'; secondary: boolean };

/** Wheel distance (in deltaY units) that counts as one zoom step; keeps touchpads from racing. */
const WHEEL_STEP = 60;

function devicePoint(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }, dpr: number) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
}

function toImage(p: { x: number; y: number }, view: View) {
  return { x: Math.floor((p.x - view.panX) / view.zoom), y: Math.floor((p.y - view.panY) / view.zoom) };
}

function pickColor(x: number, y: number, secondary: boolean) {
  const { doc, settings } = useApp.getState();
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
  const color = settings.sampleAllLayers ? sampleComposite(doc, x, y) : pixelAt(doc, activeLayer(), x, y);
  if (color >>> 24 === 0) return;
  if (secondary) actions.setSecondary(color);
  else actions.setPrimary(color);
}

export function Viewport() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const panKey = useApp((s) => s.panKey);
  const tool = useApp((s) => s.tool);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    let frame = 0;
    const draw = () => {
      frame = 0;
      renderViewport(ctx, useApp.getState());
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const unsubscribe = useApp.subscribe(request);

    const resize = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const height = Math.max(1, Math.round(wrap.clientHeight * dpr));
      canvas.width = width;
      canvas.height = height;
      actions.setViewportSize(width, height, dpr);
      request();
    });
    resize.observe(wrap);

    let wheel = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheel += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      if (Math.abs(wheel) < WHEEL_STEP) return;
      const p = devicePoint(canvas, e, useApp.getState().view.dpr);
      actions.zoomStep(wheel < 0 ? 1 : -1, p.x, p.y);
      wheel = 0;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      unsubscribe();
      resize.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = useApp.getState();
    const canvas = e.currentTarget;
    const p = devicePoint(canvas, e, s.view.dpr);
    canvas.setPointerCapture(e.pointerId);

    if (e.button === 1 || s.panKey) {
      gesture.current = { kind: 'pan', lastX: p.x, lastY: p.y };
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;

    const { x, y } = toImage(p, s.view);
    const secondary = e.button === 2;
    if (s.tool === 'eyedropper') {
      pickColor(x, y, secondary);
      gesture.current = { kind: 'pick', secondary };
      return;
    }
    const layer = activeLayer();
    if (!layer.visible) {
      actions.notify('Essa camada está oculta. Mostre a camada para desenhar nela.', 'error');
      return;
    }
    const color = secondary ? s.secondary : s.primary;
    gesture.current = { kind: 'draw', session: startSession(s.tool, s.doc, layer, color, s.settings, x, y, e.shiftKey) };
    actions.touch();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = useApp.getState();
    const canvas = e.currentTarget;
    const p = devicePoint(canvas, e, s.view.dpr);
    const g = gesture.current;

    if (g?.kind === 'pan') {
      actions.panBy(p.x - g.lastX, p.y - g.lastY);
      g.lastX = p.x;
      g.lastY = p.y;
      return;
    }

    const here = toImage(p, s.view);
    if (g?.kind === 'draw') {
      const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of coalesced.length ? coalesced : [e.nativeEvent]) {
        const q = toImage(devicePoint(canvas, ev, s.view.dpr), s.view);
        g.session.move(q.x, q.y, ev.shiftKey);
      }
      actions.touch();
    } else if (g?.kind === 'pick') {
      pickColor(here.x, here.y, g.secondary);
    }
    actions.setHover(here);
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (g?.kind === 'draw') actions.commit(g.session.end());
  };

  const cursor = panKey ? 'grab' : tool === 'eyedropper' ? 'copy' : 'crosshair';

  return (
    <div className="stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        style={{ cursor }}
        aria-label="Tela de desenho"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={() => {
          if (!gesture.current) actions.setHover(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
