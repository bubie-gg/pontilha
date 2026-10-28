import { beforeEach, describe, expect, it } from 'vitest';
import { actions, useApp } from '../state/store';
import { execute } from './commands';

async function run(method: string, params: Record<string, unknown> = {}) {
  const reply = await execute(method, params);
  if (!reply.ok) throw new Error(reply.error);
  return reply.result as Record<string, unknown>;
}

async function ascii(layer?: string) {
  return (await run('doc.ascii', layer ? { layer } : {})) as unknown as { rows: string[]; legend: Record<string, string> };
}

beforeEach(() => {
  actions.newDoc(8, 8);
});

describe('drawing commands', () => {
  it('draws filled shapes inside the image', async () => {
    await run('draw.rect', { x: 1, y: 1, w: 3, h: 2, color: '#ff0000', filled: true });
    const { rows } = await ascii();
    expect(rows.slice(0, 4)).toEqual(['........', '.aaa....', '.aaa....', '........']);
  });

  it('paints only on the chosen colour with onlyOn', async () => {
    await run('draw.rect', { x: 0, y: 0, w: 8, h: 1, color: '#ff0000', filled: true });
    await run('draw.rect', { x: 0, y: 0, w: 4, h: 1, color: '#00ff00', filled: true });
    // Blue over red only: the green half must survive.
    await run('draw.rect', { x: 0, y: 0, w: 8, h: 2, color: '#0000ff', filled: true, onlyOn: '#ff0000' });
    const { rows, legend } = await ascii();
    expect(rows[0]).toBe('aaaabbbb');
    expect(rows[1]).toBe('........');
    expect(legend).toEqual({ a: '#00ff00', b: '#0000ff' });
  });

  it('stamps patterns and rejects characters missing from the legend', async () => {
    await run('draw.pattern', { x: 2, y: 2, rows: ['ab', '.a'], legend: { a: '#111111', b: '#222222' } });
    expect((await ascii()).rows.slice(2, 4)).toEqual(['..ab....', '...a....']);
    const reply = await execute('draw.pattern', { x: 0, y: 0, rows: ['z'], legend: {} });
    expect(reply.ok).toBe(false);
  });

  it('shades star facets by the light direction', async () => {
    actions.newDoc(32, 32);
    await run('draw.star', { cx: 15.5, cy: 16.3, outer: 9, color: '#c93c4a', light: '#f0715e', dark: '#8a2340' });
    const { rows, legend } = await ascii();
    const colorAt = (x: number, y: number) => legend[rows[y][x]];
    expect(new Set(Object.values(legend))).toEqual(new Set(['#c93c4a', '#f0715e', '#8a2340']));
    // Light comes from the top-left: the left arm is lit; the right arm's upper facet
    // catches it side-on (mid tone) and its lower facet is in shadow.
    expect(colorAt(10, 14)).toBe('#f0715e');
    expect(colorAt(21, 14)).toBe('#c93c4a');
    expect(colorAt(21, 15)).toBe('#8a2340');
    // Symmetric silhouette around the vertical axis between pixels 15 and 16.
    for (const row of rows) expect(row.replace(/[^.]/g, '#')).toBe([...row.replace(/[^.]/g, '#')].reverse().join(''));
  });

  it('grades burst colours from centre to tip', async () => {
    actions.newDoc(32, 32);
    await run('draw.burst', { cx: 15.5, cy: 15.5, outer: 12, inner: 2, rays: 8, colors: ['#ffffff', '#ff0000'], rotation: 0 });
    const { rows, legend } = await ascii();
    const colorAt = (x: number, y: number) => legend[rows[y][x]];
    expect(colorAt(18, 15)).toBe('#ffffff');
    expect(colorAt(26, 15)).toBe('#ff0000');
    expect(rows[15][15]).toBe('.');
  });

  it('fills regular polygons', async () => {
    actions.newDoc(16, 16);
    const result = await run('draw.polygon', { cx: 7.5, cy: 7.5, radius: 6, sides: 6, color: '#336699' });
    expect(result.changed).toBeGreaterThan(80);
  });
});

describe('safety', () => {
  it('runs batches as one undo step and rolls back failures', async () => {
    await run('batch', {
      commands: [
        { method: 'draw.pixels', params: { pixels: [[0, 0]], color: '#ff0000' } },
        { method: 'draw.pixels', params: { pixels: [[1, 0]], color: '#00ff00' } },
      ],
    });
    expect((await ascii()).rows[0]).toBe('ab......');
    actions.undo();
    expect((await ascii()).rows[0]).toBe('........');

    const failed = await execute('batch', {
      commands: [
        { method: 'draw.pixels', params: { pixels: [[0, 0]], color: '#ff0000' } },
        { method: 'draw.line', params: { x0: 0 } },
      ],
    });
    expect(failed.ok).toBe(false);
    expect((await ascii()).rows[0]).toBe('........');
  });

  it('refuses to replace unsaved work without discard', async () => {
    await run('draw.pixels', { pixels: [[0, 0]], color: '#ff0000' });
    expect(useApp.getState().dirty).toBe(true);
    expect((await execute('doc.new', { width: 4, height: 4 })).ok).toBe(false);
    expect((await execute('doc.new', { width: 4, height: 4, discard: true })).ok).toBe(true);
  });
});
