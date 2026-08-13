import type { FeedbackMessage } from './types';

export const CAPTURE_COPIED_MESSAGE = 'Screenshot complete — copied to clipboard';

export function captureFeedback(copied: boolean, saved: boolean): FeedbackMessage {
  if (copied) return { kind: 'success', message: CAPTURE_COPIED_MESSAGE };
  if (saved) return { kind: 'warning', message: 'Screenshot complete — clipboard blocked; PNG saved' };
  return { kind: 'warning', message: 'Screenshot complete — clipboard blocked; kept in Recent' };
}
