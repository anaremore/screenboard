import { describe, expect, it } from 'vitest';
import { createCaptureFilename } from '../../src/shared/filename';

describe('createCaptureFilename', () => {
  it('uses a stable sortable local timestamp', () => {
    expect(createCaptureFilename(new Date(2026, 7, 12, 12, 59, 1)))
      .toBe('screenboard-2026-08-12-125901.png');
  });
});
