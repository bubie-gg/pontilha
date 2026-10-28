import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import type { ToolId } from '../core/tools';
import { isDesktop } from '../platform/files';
import { actions, useApp } from '../state/store';
import { openFile, saveProject } from './fileActions';

const TOOL_KEYS: Record<string, ToolId> = {
  b: 'pencil',
  e: 'eraser',
  l: 'line',
  u: 'rect',
  g: 'fill',
  i: 'eyedropper',
};

export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
            default:
              return false;
          }
        })();
        if (handled) e.preventDefault();
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
        const ok = await actions.confirm('Há alterações não salvas. Fechar o Pontilha mesmo assim?', 'Fechar sem salvar');
        if (!ok) return;
        closing = true;
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
