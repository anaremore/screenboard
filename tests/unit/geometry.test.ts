import { describe, expect, it } from 'vitest';
import { clampRect, mapCssRectToImage, rectFromPoints } from '../../src/shared/geometry';

describe('rectFromPoints', () => {
  it.each([
    [{ x: 10, y: 20 }, { x: 70, y: 90 }],
    [{ x: 70, y: 20 }, { x: 10, y: 90 }],
    [{ x: 10, y: 90 }, { x: 70, y: 20 }],
    [{ x: 70, y: 90 }, { x: 10, y: 20 }],
  ])('normalizes a drag in every direction', (start, end) => {
    expect(rectFromPoints(start, end)).toEqual({ x: 10, y: 20, width: 60, height: 70 });
  });
});

describe('clampRect', () => {
  it('clips every edge to viewport bounds', () => {
    expect(clampRect({ x: -10, y: -20, width: 140, height: 150 }, { width: 100, height: 90 }))
      .toEqual({ x: 0, y: 0, width: 100, height: 90 });
  });
});

describe('mapCssRectToImage', () => {
  it('uses the actual screenshot scale instead of trusting devicePixelRatio', () => {
    expect(mapCssRectToImage(
      { x: 100, y: 80, width: 250, height: 120 },
      { width: 800, height: 600, devicePixelRatio: 1.25 },
      { width: 1600, height: 1200 },
    )).toEqual({ x: 200, y: 160, width: 500, height: 240 });
  });

  it('supports non-uniform screenshot scaling and stable rounded edges', () => {
    expect(mapCssRectToImage(
      { x: 1, y: 1, width: 2, height: 2 },
      { width: 4, height: 4, devicePixelRatio: 2 },
      { width: 7, height: 9 },
    )).toEqual({ x: 2, y: 2, width: 3, height: 5 });
  });

  it('clips a selection that crosses the viewport edge', () => {
    expect(mapCssRectToImage(
      { x: 750, y: 550, width: 100, height: 100 },
      { width: 800, height: 600, devicePixelRatio: 2 },
      { width: 1600, height: 1200 },
    )).toEqual({ x: 1500, y: 1100, width: 100, height: 100 });
  });

  it('rejects a selection fully outside the viewport', () => {
    expect(() => mapCssRectToImage(
      { x: 900, y: 700, width: 10, height: 10 },
      { width: 800, height: 600, devicePixelRatio: 1 },
      { width: 800, height: 600 },
    )).toThrow(/outside the viewport/i);
  });
});
