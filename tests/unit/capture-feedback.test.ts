import { describe, expect, it } from 'vitest';
import { CAPTURE_COPIED_MESSAGE, captureFeedback } from '../../src/shared/capture-feedback';

describe('captureFeedback', () => {
  it('confirms both capture completion and clipboard delivery', () => {
    expect(captureFeedback(true, false)).toEqual({
      kind: 'success',
      message: CAPTURE_COPIED_MESSAGE,
    });
    expect(CAPTURE_COPIED_MESSAGE).toBe('Screenshot complete — copied to clipboard');
  });

  it('provides a recoverable warning when clipboard delivery is blocked', () => {
    expect(captureFeedback(false, true)).toEqual({
      kind: 'warning',
      message: 'Screenshot complete — clipboard blocked; PNG saved',
    });
    expect(captureFeedback(false, false)).toEqual({
      kind: 'warning',
      message: 'Screenshot complete — clipboard blocked; kept in Recent',
    });
  });
});
