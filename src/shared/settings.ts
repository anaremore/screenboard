import { DEFAULT_SETTINGS, MAX_RECENT_CAPTURES } from './constants';
import type { CaptureSettings } from './types';

export function normalizeSettings(value: Partial<CaptureSettings> | undefined): CaptureSettings {
  const merged = { ...DEFAULT_SETTINGS, ...value };
  const maximum = Number.isFinite(merged.maxRecent) ? merged.maxRecent : DEFAULT_SETTINGS.maxRecent;
  return {
    copyToClipboard: Boolean(merged.copyToClipboard),
    saveAutomatically: Boolean(merged.saveAutomatically),
    showConfirmation: Boolean(merged.showConfirmation),
    keepRecent: Boolean(merged.keepRecent),
    maxRecent: Math.min(MAX_RECENT_CAPTURES, Math.max(1, Math.round(maximum))),
  };
}
