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

describe('frames', () => {
  const frames = () => useApp.getState().doc.frames;
  const current = () => frames().findIndex((f) => f.id === useApp.getState().doc.frame) + 1;

  it('keeps each frame its own image', async () => {
    await run('draw.pixels', { pixels: [[0, 0]], color: '#ff0000' });
    await run('frame.new', { copy: true });
    expect(current()).toBe(2);
    await run('draw.pixels', { pixels: [[1, 0]], color: '#00ff00' });
    expect((await ascii()).rows[0]).toBe('ab......');
    expect(((await run('doc.ascii', { frame: 1 })) as { rows: string[] }).rows[0]).toBe('a.......');

    await run('frame.new');
    expect((await ascii()).rows[0]).toBe('........');
    // Painting another frame by number leaves the one on screen alone.
    await run('draw.pixels', { pixels: [[7, 7]], color: '#0000ff', frame: 1 });
    expect(current()).toBe(3);
    expect(((await run('doc.ascii', { frame: 1 })) as { rows: string[] }).rows[7]).toBe('.......b');
  });

  it('undo shows the frame it changes', async () => {
    await run('draw.pixels', { pixels: [[0, 0]], color: '#ff0000' });
    await run('frame.new');
    actions.undo(); // removes frame 2
    expect(frames()).toHaveLength(1);
    actions.redo();
    expect(current()).toBe(2);
    await run('frame.select', { frame: 2 });
    await run('draw.pixels', { pixels: [[0, 0]], frame: 1, color: '#00ff00' });
    actions.undo();
    expect(current()).toBe(1);
    expect((await ascii()).legend).toEqual({ a: '#ff0000' });
  });

  it('moves, times and deletes frames as undoable steps', async () => {
    await run('frame.new', { duration: 250 });
    await run('frame.new');
    const [a, b, c] = frames().map((f) => f.id);
    await run('frame.move', { frame: 3, to: 1 });
    expect(frames().map((f) => f.id)).toEqual([c, a, b]);
    await run('frame.setDuration', { duration: 80, all: true });
    expect(frames().map((f) => f.duration)).toEqual([80, 80, 80]);
    await run('frame.delete', { frame: 2 });
    expect(frames().map((f) => f.id)).toEqual([c, b]);
    actions.undo();
    actions.undo();
    actions.undo();
    expect(frames().map((f) => f.id)).toEqual([a, b, c]);
    expect(frames()[1].duration).toBe(250);
    expect((await execute('frame.select', { frame: 9 })).ok).toBe(false);
  });

  it('rolls back new frames when a batch fails', async () => {
    const failed = await execute('batch', {
      commands: [
        { method: 'frame.new', params: {} },
        { method: 'draw.line', params: { x0: 0 } },
      ],
    });
    expect(failed.ok).toBe(false);
    expect(frames()).toHaveLength(1);
  });

  it('merges layers in every frame', async () => {
    await run('frame.new');
    await run('layer.new', { name: 'cima' });
    await run('draw.pixels', { pixels: [[2, 2]], color: '#ff0000', frame: 1 });
    await run('draw.pixels', { pixels: [[3, 3]], color: '#00ff00', frame: 2 });
    await run('layer.mergeDown', { layer: 'cima' });
    expect(useApp.getState().doc.layers).toHaveLength(1);
    expect(((await run('doc.ascii', { frame: 1 })) as { rows: string[] }).rows[2]).toBe('..a.....');
    expect(((await run('doc.ascii', { frame: 2 })) as { rows: string[] }).rows[3]).toBe('...a....');
  });

  it('gives new and duplicated layers an image in every frame', async () => {
    await run('frame.new');
    await run('draw.pixels', { pixels: [[0, 0]], color: '#ff0000' });
    await run('layer.duplicate');
    const copy = useApp.getState().doc.layers[1];
    expect(copy.cels.size).toBe(2);
    expect(((await run('doc.ascii', { frame: 2, layer: copy.name })) as { rows: string[] }).rows[0]).toBe('a.......');
    // The copy owns its pixels.
    await run('draw.pixels', { pixels: [[1, 0]], color: '#00ff00', layer: copy.name });
    expect(((await run('doc.ascii', { frame: 2, layer: 'Camada 1' })) as { rows: string[] }).rows[0]).toBe('a.......');
  });
});

describe('animation export', () => {
  it('renders sprite sheets and GIFs of every frame', async () => {
    await run('draw.pixels', { pixels: [[0, 0]], color: '#ff0000' });
    await run('frame.new', { duration: 40 });
    await run('draw.pixels', { pixels: [[7, 7]], color: '#00ff00' });
    await run('frame.new');

    const sheet = await run('render.sheet', { layout: 'grid', scale: 2 });
    expect(sheet).toMatchObject({ columns: 2, rows: 2, width: 32, height: 32, frameWidth: 16, durations: [100, 40, 40] });

    const gif = await run('render.gif', { scale: 2, pingpong: true });
    expect(gif).toMatchObject({ width: 16, height: 16, frames: 3, colors: 2, reduced: false });
    expect(atob(gif.gif as string).slice(0, 6)).toBe('GIF89a');

    expect((await execute('render.sheet', { layout: 'diagonal' })).ok).toBe(false);
  });
});

describe('selection', () => {
  const selection = () => useApp.getState().selection;

  it('moves selected pixels and undoes move and selection together', async () => {
    await run('draw.pixels', { pixels: [[1, 1], [2, 1]], color: '#ff0000' });
    await run('draw.pixels', { pixels: [[5, 1]], color: '#00ff00' });
    await run('select.rect', { x: 0, y: 0, w: 3, h: 3 });
    await run('selection.move', { dx: 4, dy: 2 });
    // doc.ascii letters follow first appearance: green now comes before red.
    const { rows, legend } = await ascii();
    expect(rows[1]).toBe('.....a..');
    expect(rows[3]).toBe('.....bb.');
    expect(legend).toEqual({ a: '#00ff00', b: '#ff0000' });
    expect(selection()).toEqual({ x: 4, y: 2, w: 3, h: 3 });
    actions.undo();
    expect((await ascii()).rows[1]).toBe('.aa..b..');
    expect(selection()).toEqual({ x: 0, y: 0, w: 3, h: 3 });
  });

  it('flips and rotates inside the selection only', async () => {
    await run('draw.pixels', { pixels: [[0, 0], [7, 0]], color: '#ff0000' });
    await run('select.rect', { x: 0, y: 0, w: 3, h: 1 });
    await run('selection.flip', { axis: 'horizontal' });
    expect((await ascii()).rows[0]).toBe('..a....a');
    // A 3 × 1 strip turns into a 1 × 3 one around the same centre; its top pixel leaves the image.
    await run('selection.rotate', { direction: 'cw' });
    expect(selection()).toEqual({ x: 1, y: 0, w: 1, h: 2 });
    const { rows } = await ascii();
    expect(rows.slice(0, 2)).toEqual(['.......a', '.a......']);
  });

  it('copies from one frame and pastes in place on another', async () => {
    await run('draw.rect', { x: 2, y: 2, w: 2, h: 2, color: '#0000ff', filled: true });
    await run('select.rect', { x: 2, y: 2, w: 2, h: 2 });
    await run('clipboard.copy');
    await run('frame.new');
    await run('clipboard.paste');
    expect((await ascii()).rows.slice(2, 4)).toEqual(['..aa....', '..aa....']);
    await run('clipboard.paste', { x: 6, y: 6, frame: 1 });
    expect(((await run('doc.ascii', { frame: 1 })) as { rows: string[] }).rows[7]).toBe('......aa');
  });

  it('cuts and clears', async () => {
    await run('draw.rect', { x: 0, y: 0, w: 8, h: 1, color: '#ff0000', filled: true });
    await run('select.rect', { x: 0, y: 0, w: 2, h: 1 });
    await run('clipboard.cut');
    await run('select.rect', { x: 6, y: 0, w: 2, h: 1 });
    await run('selection.clear');
    expect((await ascii()).rows[0]).toBe('..aaaa..');
    expect((await execute('select.rect', { x: 20, y: 20, w: 2, h: 2 })).ok).toBe(false);
  });

  it('acts on the whole layer without a selection', async () => {
    await run('draw.pixels', { pixels: [[0, 0]], color: '#ff0000' });
    await run('selection.move', { dx: 1, dy: 1 });
    expect((await ascii()).rows[1]).toBe('.a......');
    expect(selection()).toBeNull();
    actions.newDoc(8, 4);
    expect((await execute('selection.rotate', { direction: 'cw' })).ok).toBe(false);
  });
});

describe('image size', () => {
  const size = () => [useApp.getState().doc.width, useApp.getState().doc.height];

  it('grows the canvas around an anchor and undoes back to the old size', async () => {
    await run('draw.pixels', { pixels: [[0, 0]], color: '#ff0000' });
    await run('canvas.resize', { width: 12, height: 10 });
    expect(size()).toEqual([12, 10]);
    expect((await ascii()).rows[1]).toBe('..a.........');
    // Paint after resizing, then undo both steps.
    await run('draw.pixels', { pixels: [[11, 9]], color: '#00ff00' });
    actions.undo();
    actions.undo();
    expect(size()).toEqual([8, 8]);
    expect((await ascii()).rows[0]).toBe('a.......');
    actions.redo();
    await run('canvas.resize', { width: 4, height: 4, anchor: 'bottom-right' });
    expect((await ascii()).rows).toEqual(['....', '....', '....', '....']);
    expect((await execute('canvas.resize', { width: 0, height: 4 })).ok).toBe(false);
  });

  it('crops to the selection and trims empty borders in every frame', async () => {
    await run('draw.pixels', { pixels: [[1, 1]], color: '#ff0000' });
    await run('frame.new');
    await run('draw.pixels', { pixels: [[5, 6]], color: '#00ff00' });
    await run('select.rect', { x: 1, y: 1, w: 2, h: 2 });
    const trimmed = await run('canvas.trim');
    expect(trimmed.kept).toEqual({ x: 1, y: 1, w: 5, h: 6 });
    expect(size()).toEqual([5, 6]);
    expect(useApp.getState().selection).toBeNull();
    expect(((await run('doc.ascii', { frame: 1 })) as { rows: string[] }).rows[0]).toBe('a....');
    expect((await ascii()).rows[5]).toBe('....a');

    await run('canvas.crop', { x: 4, y: 5, w: 1, h: 1 });
    expect(size()).toEqual([1, 1]);
    expect((await ascii()).rows).toEqual(['a']);
  });

  it('enlarges without blurring', async () => {
    await run('draw.pixels', { pixels: [[1, 0]], color: '#ff0000' });
    await run('canvas.scale', { factor: 2 });
    expect(size()).toEqual([16, 16]);
    expect((await ascii()).rows.slice(0, 3)).toEqual(['..aa............', '..aa............', '................']);
    expect((await execute('canvas.scale', { factor: 1 })).ok).toBe(false);
  });
});

describe('colours', () => {
  it('replaces a colour in every layer and frame as one undo step', async () => {
    await run('draw.pixels', { pixels: [[0, 0]], color: '#ff0000' });
    await run('layer.new');
    await run('draw.pixels', { pixels: [[1, 0]], color: '#ff0000' });
    await run('frame.new', { copy: true });
    await run('draw.pixels', { pixels: [[2, 0]], color: '#ff0000' });

    const used = await run('color.used');
    expect(used.colors).toEqual([{ color: '#ff0000', pixels: 5 }]);

    expect((await run('color.replaceAll', { from: '#ff0000', to: '#00ff00', scope: 'frame', frame: 1 })).changed).toBe(2);
    expect((await run('color.replaceAll', { from: '#ff0000', to: '#0000ff' })).changed).toBe(3);
    expect(((await run('color.used')).colors as Array<{ color: string }>).map((c) => c.color).sort()).toEqual(['#0000ff', '#00ff00']);
    actions.undo();
    actions.undo();
    expect((await run('color.used')).colors).toEqual([{ color: '#ff0000', pixels: 5 }]);
  });

  it('adds hue-shifted ramps to the palette once', async () => {
    useApp.setState({ palette: [] });
    const out = await run('palette.ramp', { color: '#3a9150', steps: 5 });
    expect(out.added).toBe(5);
    expect((out.ramp as string[])[2]).toBe('#3a9150');
    expect((await run('palette.ramp', { color: '#3a9150' })).added).toBe(0);
    expect((await execute('palette.ramp', { steps: 40 })).ok).toBe(false);
  });
});
