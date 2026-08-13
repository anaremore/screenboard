import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { normalizeSettings } from '../../src/shared/settings';
import type { CaptureSettings } from '../../src/shared/types';

describe('normalizeSettings', () => {
  it('provides clipboard-first defaults', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps maximum history count to supported limits', () => {
    expect(normalizeSettings({ maxRecent: 0 }).maxRecent).toBe(1);
    expect(normalizeSettings({ maxRecent: 999 }).maxRecent).toBe(25);
    expect(normalizeSettings({ maxRecent: Number.NaN }).maxRecent).toBe(10);
  });

  it('drops legacy switches that could disable clipboard copy or confirmation', () => {
    const legacy = normalizeSettings({
      copyToClipboard: false,
      showConfirmation: false,
      saveAutomatically: true,
    } as unknown as Partial<CaptureSettings>);

    expect(legacy).toEqual({ ...DEFAULT_SETTINGS, saveAutomatically: true });
    expect(legacy).not.toHaveProperty('copyToClipboard');
    expect(legacy).not.toHaveProperty('showConfirmation');
  });
});
