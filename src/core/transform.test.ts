import { describe, expect, it } from 'vitest';
import { anchorOffset, clipRect, flipRegion, rectBetween, rotateRegion, shiftCel, turnedRect } from './transform';

// A 3 × 2 region:  1 2 3
//                  4 5 6
const PX = Uint32Array.from([1, 2, 3, 4, 5, 6]);

describe('transform', () => {
  it('flips', () => {
    expect([...flipRegion(PX, 3, 2, 'horizontal')]).toEqual([3, 2, 1, 6, 5, 4]);
    expect([...flipRegion(PX, 3, 2, 'vertical')]).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it('turns a quarter each way', () => {
    // Clockwise: 4 1 / 5 2 / 6 3 (2 wide, 3 tall).
    expect([...rotateRegion(PX, 3, 2, 'cw')]).toEqual([4, 1, 5, 2, 6, 3]);
    expect([...rotateRegion(PX, 3, 2, 'ccw')]).toEqual([3, 6, 2, 5, 1, 4]);
    const back = rotateRegion(rotateRegion(PX, 3, 2, 'cw'), 2, 3, 'ccw');
    expect([...back]).toEqual([...PX]);
  });

  it('keeps turned rectangles on the same centre', () => {
    expect(turnedRect({ x: 2, y: 4, w: 5, h: 1 })).toEqual({ x: 4, y: 2, w: 1, h: 5 });
    expect(turnedRect({ x: 0, y: 0, w: 4, h: 4 })).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });

  it('builds and clips rectangles', () => {
    expect(rectBetween(5, 1, 2, 3)).toEqual({ x: 2, y: 1, w: 4, h: 3 });
    expect(clipRect({ x: -2, y: 6, w: 5, h: 5 }, 8, 8)).toEqual({ x: 0, y: 6, w: 3, h: 2 });
    expect(clipRect({ x: 9, y: 0, w: 2, h: 2 }, 8, 8)).toBeNull();
  });
});

describe('canvas', () => {
  it('shifts cels onto a new canvas', () => {
    // 2 × 2 → 3 × 1 with the image moved one right: row 0 survives, row 1 falls off.
    expect([...shiftCel(Uint32Array.from([1, 2, 3, 4]), 2, 2, 3, 1, 1, 0)]).toEqual([0, 1, 2]);
    expect(anchorOffset('center', 4, 4, 9, 2)).toEqual({ dx: 2, dy: -1 });
    expect(anchorOffset('bottom-right', 4, 4, 6, 6)).toEqual({ dx: 2, dy: 2 });
  });
});
