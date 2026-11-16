import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { frameIndex, tagRange } from '../core/doc';
import type { ToolId } from '../core/tools';
import { isDesktop } from '../platform/files';
import { actions, activeLayer, useApp } from '../state/store';
import { openFile, saveProject } from './fileActions';
import { clearRecovery } from './recovery';

const TOOL_KEYS: Record<string, ToolId> = {
  m: 'select',
  w: 'wand',
  b: 'pencil',
  e: 'eraser',
  l: 'line',
  u: 'rect',
  o: 'ellipse',
  g: 'fill',
  i: 'eyedropper',
};

/** Selection edits change the active layer, so they wait until it is visible. */
export function onVisibleLayer(edit: () => void) {
  if (activeLayer().visible) edit();
  else actions.notify('This layer is hidden. Show it to edit its pixels.', 'error');
}

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A focused control (a timeline frame, say) already handled this key.
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const s = useApp.getState();
      if (s.dialog || s.confirm) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!s.panKey) useApp.setState({ panKey: true });
        return;
      }
      if (e.key === 'Alt') {
        e.preventDefault();
        actions.holdEyedropper(true);
        return;
      }

      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        const handled = (() => {
          switch (key) {
            case 'z':
              if (e.shiftKey) actions.redo();
              else actions.undo();
              return true;
            case 'y':
              actions.redo();
              return true;
            case 'n':
              actions.openDialog('new');
              return true;
            case 'o':
              void openFile();
              return true;
            case 's':
              void saveProject(e.shiftKey);
              return true;
            case 'e':
              actions.openDialog('export');
              return true;
            case "'":
              actions.toggleGrid();
              return true;
            case 'a':
              actions.selectAll();
              return true;
            case 'd':
              actions.select(null);
              return true;
            case 'c':
              actions.copy();
              actions.notify(s.selection ? 'Selection copied.' : 'Whole layer copied.');
              return true;
            case 'x':
              onVisibleLayer(() => actions.cut());
              return true;
            case 'v':
              onVisibleLayer(() => actions.paste());
              return true;
            default:
              return false;
          }
        })();
        if (handled) e.preventDefault();
        return;
      }

      if (e.key === 'Escape' && s.selection) {
        actions.select(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        e.preventDefault();
        onVisibleLayer(() => actions.clearSelection());
        return;
      }
      if (NUDGE[e.key] && s.selection) {
        e.preventDefault();
        const [dx, dy] = NUDGE[e.key];
        const step = e.shiftKey ? 8 : 1;
        onVisibleLayer(() => actions.moveSelection(dx * step, dy * step));
        return;
      }
      if (e.shiftKey && (key === 'h' || key === 'v' || key === 'r')) {
        onVisibleLayer(() => {
          if (key === 'h') actions.flipSelection('horizontal');
          else if (key === 'v') actions.flipSelection('vertical');
          else actions.rotateSelection('cw');
        });
        return;
      }

      // Enter on a focused button presses the button, so only play from elsewhere.
      if (e.key === 'Enter' && !target?.closest('button, a')) {
        e.preventDefault();
        actions.togglePlay();
        return;
      }

      if (TOOL_KEYS[key]) {
        actions.setTool(TOOL_KEYS[key]);
        return;
      }
      switch (key) {
        case 'x':
          actions.swapColors();
          break;
        case '[':
          actions.setBrushSize(s.settings.brushSize - 1);
          break;
        case ']':
          actions.setBrushSize(s.settings.brushSize + 1);
          break;
        case '+':
        case '=':
          actions.zoomStep(1);
          break;
        case '-':
          actions.zoomStep(-1);
          break;
        case '0':
          actions.fitView();
          break;
        case '1':
          actions.zoomActual();
          break;
        case ',':
          actions.stepFrame(-1);
          break;
        case '.':
          actions.stepFrame(1);
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') useApp.setState({ panKey: false });
      if (e.key === 'Alt') actions.holdEyedropper(false);
    };
    const onBlur = () => {
      useApp.setState({ panKey: false });
      actions.holdEyedropper(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}

/** Advances frames while `playing`, each one on screen for its own duration. */
export function usePlayback() {
  const playing = useApp((s) => s.playing);

  useEffect(() => {
    if (!playing) return;
    let direction = 1;
    let timer = 0;
    const schedule = () => {
      const { doc } = useApp.getState();
      timer = window.setTimeout(tick, doc.frames[frameIndex(doc)].duration);
    };
    const tick = () => {
      const { doc, loopMode, playTag } = useApp.getState();
      // Loop over the chosen tag's frames, or the whole animation.
      const tag = doc.tags.find((t) => t.id === playTag);
      const [start, end] = (tag && tagRange(doc, tag)) || [0, doc.frames.length - 1];
      const n = end - start + 1;
      if (n < 2) {
        useApp.setState({ playing: false });
        return;
      }
      const current = frameIndex(doc);
      let next = current + direction;
      if (current < start || current > end) next = start;
      else if (loopMode === 'pingpong' && (next < start || next > end)) {
        direction = -direction;
        next = current + direction;
      } else if (next > end) next = start;
      else if (next < start) next = end;
      actions.selectFrame(doc.frames[next].id);
      schedule();
    };
    schedule();
    return () => clearTimeout(timer);
  }, [playing]);
}

/** Keeps the window title in sync and asks before closing with unsaved changes. */
export function useWindowIntegration() {
  const fileName = useApp((s) => s.fileName);
  const dirty = useApp((s) => s.dirty);

  useEffect(() => {
    const title = `${dirty ? '* ' : ''}${fileName} – Pontilha`;
    document.title = title;
    if (isDesktop) getCurrentWindow().setTitle(title).catch(() => {});
  }, [fileName, dirty]);

  useEffect(() => {
    if (!isDesktop) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (useApp.getState().dirty) e.preventDefault();
      };
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }

    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let closing = false;
    void win
      .onCloseRequested(async (event) => {
        if (closing || !useApp.getState().dirty) return;
        event.preventDefault();
        const ok = await actions.confirm('There are unsaved changes. Close Pontilha anyway?', 'Close without saving');
        if (!ok) return;
        closing = true;
        // Closing without saving on purpose: don't offer this work back next time.
        await clearRecovery();
        await win.destroy();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
