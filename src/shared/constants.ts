import type { CaptureSettings } from './types';

export const DEFAULT_SETTINGS: Readonly<CaptureSettings> = {
  saveAutomatically: false,
  keepRecent: true,
  maxRecent: 10,
};

export const MAX_RECENT_CAPTURES = 25;
export const MAX_HISTORY_BYTES = 250 * 1024 * 1024;
export const MAX_CANVAS_DIMENSION = 32_767;
export const MAX_CANVAS_PIXELS = 120_000_000;
export const CAPTURE_INTERVAL_MS = 550;
