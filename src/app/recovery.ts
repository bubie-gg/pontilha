import { invoke } from '@tauri-apps/api/core';
import { parseProject, serializeProject } from '../core/project';
import { isDesktop } from '../platform/files';
import { actions, useApp } from '../state/store';

/**
 * Autosave for unsaved work. Every minute, if the image changed since the last
 * copy, the project goes to a recovery file (`~/.config/pontilha/recovery.pontilha`,
 * or browser storage). Saving, or closing on purpose without saving, removes it, so
 * finding one at startup means the app went away with work in it.
 */

const INTERVAL_MS = 60_000;
const STORAGE_KEY = 'pontilha.recovery';

interface RecoveryMeta {
  fileName: string;
  filePath: string | null;
  savedAt: string;
}

async function write(project: string, meta: RecoveryMeta) {
  if (isDesktop) await invoke('recovery_write', { project, meta: JSON.stringify(meta) });
  else localStorage.setItem(STORAGE_KEY, JSON.stringify({ project, meta }));
}

async function read(): Promise<{ project: string; meta: RecoveryMeta } | null> {
  try {
    if (isDesktop) {
      const found = await invoke<[string, string] | null>('recovery_read');
      return found && { project: found[0], meta: JSON.parse(found[1]) };
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearRecovery() {
  try {
    if (isDesktop) await invoke('recovery_clear');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove, or storage is unavailable: either way there is no copy to trust.
  }
}

/** Version of the image last copied, so an unchanged image isn't written again. */
let savedVersion = -1;

async function autosave() {
  const s = useApp.getState();
  if (!s.dirty || s.version === savedVersion) return;
  const version = s.version;
  try {
    const project = await serializeProject(s.doc, s.palette, s.activeLayerId, s.recipes);
    await write(project, { fileName: s.fileName, filePath: s.filePath, savedAt: new Date().toISOString() });
    savedVersion = version;
  } catch (err) {
    console.warn('pontilha: autosave failed', err);
  }
}

/** Offers to bring back work left by a crash or a forced close. */
async function offerRecovery() {
  const found = await read();
  if (!found) return;
  const when = new Date(found.meta.savedAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
  const ok = await actions.confirm(
    `Pontilha closed without saving “${found.meta.fileName}”. There is an automatic copy from ${when}. Recover this work?`,
    'Recuperar',
    { title: 'Unsaved work', cancelLabel: 'Discard the copy', tone: 'safe' },
  );
  if (ok) {
    try {
      const project = await parseProject(found.project);
      actions.loadDoc(project.doc, {
        activeLayerId: project.activeLayerId,
        palette: project.palette,
        recipes: project.recipes,
        fileName: found.meta.fileName,
        filePath: found.meta.filePath,
        dirty: true,
      });
      actions.notify('Work recovered. Save it to keep it.');
      return;
    } catch (err) {
      actions.notify(`Could not recover: ${err instanceof Error ? err.message : String(err)}.`, 'error');
    }
  }
  await clearRecovery();
}

/** Checks for leftover work, then keeps a copy of unsaved changes until they are saved. */
export async function startAutosave() {
  await offerRecovery();
  setInterval(() => void autosave(), INTERVAL_MS);
  // Saved (or a clean document loaded): the copy is no longer needed.
  useApp.subscribe((s, prev) => {
    if (prev.dirty && !s.dirty) {
      savedVersion = -1;
      void clearRecovery();
    }
  });
}
