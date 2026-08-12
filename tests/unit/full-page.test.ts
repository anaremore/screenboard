import { describe, expect, it } from 'vitest';
import { planFullPageSlices } from '../../src/shared/full-page';
import type { PageMetrics } from '../../src/shared/types';

const metrics = (overrides: Partial<PageMetrics> = {}): PageMetrics => ({
  width: 1000,
  height: 700,
  pageWidth: 1000,
  pageHeight: 1800,
  scrollX: 0,
  scrollY: 123,
  devicePixelRatio: 1,
  ...overrides,
});

describe('planFullPageSlices', () => {
  it('uses one slice for a page shorter than the viewport', () => {
    expect(planFullPageSlices(metrics({ pageHeight: 500 }))).toEqual([{
      index: 0,
      scrollX: 0,
      scrollY: 0,
      source: { x: 0, y: 0, width: 1000, height: 500 },
      destination: { x: 0, y: 0, width: 1000, height: 500 },
    }]);
  });

  it('crops the final partial slice from Chrome’s clamped scroll position', () => {
    const slices = planFullPageSlices(metrics());
    expect(slices).toHaveLength(3);
    expect(slices[2]).toMatchObject({
      scrollY: 1100,
      source: { y: 300, height: 400 },
      destination: { y: 1400, height: 400 },
    });
  });

  it('plans horizontal and vertical overflow without duplicate destination pixels', () => {
    const slices = planFullPageSlices(metrics({ width: 800, height: 600, pageWidth: 1300, pageHeight: 900 }));
    expect(slices).toHaveLength(4);
    expect(slices[1]).toMatchObject({
      scrollX: 500,
      source: { x: 300, width: 500 },
      destination: { x: 800, width: 500 },
    });
    expect(slices[2]).toMatchObject({
      scrollY: 300,
      source: { y: 300, height: 300 },
      destination: { y: 600, height: 300 },
    });
  });

  it('rejects invalid dimensions', () => {
    expect(() => planFullPageSlices(metrics({ pageHeight: 0 }))).toThrow(/greater than zero/i);
  });
});
