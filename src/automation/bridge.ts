import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isDesktop } from '../platform/files';
import { useApp } from '../state/store';
import { execute } from './commands';

interface ControlRequest {
  id: number;
  method: string;
  params: unknown;
}

declare global {
  interface Window {
    /** Same commands as the control port, for tests and the browser build. */
    pontilha?: { call: typeof execute };
  }
}

/**
 * Connects the command catalogue to the desktop control port: the Rust side
 * turns each HTTP request into a `control://request` event and waits for the
 * reply we send back with `control_reply`.
 */
export function startBridge() {
  window.pontilha = { call: execute };
  if (!isDesktop) return;

  // Requests run one after another, in arrival order, like edits from a single user.
  let queue = Promise.resolve();
  void listen<ControlRequest>('control://request', (event) => {
    const { id, method, params } = event.payload;
    queue = queue.then(async () => {
      const response = await execute(method, params);
      await invoke('control_reply', { id, response }).catch(() => {});
    });
  }).then(() => invoke('control_ready'));

  void invoke<{ port: number | null }>('control_info').then(({ port }) => useApp.setState({ controlPort: port }));
}
