import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { normalizeSettings } from '../../src/shared/settings';

describe('normalizeSettings', () => {
  it('provides clipboard-first defaults', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps maximum history count to supported limits', () => {
    expect(normalizeSettings({ maxRecent: 0 }).maxRecent).toBe(1);
    expect(normalizeSettings({ maxRecent: 999 }).maxRecent).toBe(25);
    expect(normalizeSettings({ maxRecent: Number.NaN }).maxRecent).toBe(10);
  });
});
