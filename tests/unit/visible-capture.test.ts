import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisibleCapture } from '../../src/background/visible-capture';
import { CAPTURE_INTERVAL_MS } from '../../src/shared/constants';

const query = vi.fn();
const captureVisibleTab = vi.fn();
const tab = { id: 1, windowId: 2 } as chrome.tabs.Tab;
beforeEach(() => {
  vi.useFakeTimers();
  query.mockReset().mockResolvedValue([tab]);
  captureVisibleTab.mockReset().mockResolvedValue('data:image/png;base64,AA==');
  vi.stubGlobal('chrome', { tabs: { query, captureVisibleTab } });
});
afterEach(() => { vi.useRealTimers(); });

describe('visible capture rate limiting', () => {
  it('serializes consecutive capture modes at Chrome-safe intervals', async () => {
    const capture = createVisibleCapture();
    await capture(tab);
    const second = capture(tab);
    const third = capture(tab);
    await vi.advanceTimersByTimeAsync(CAPTURE_INTERVAL_MS - 1);
    expect(captureVisibleTab).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(captureVisibleTab).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CAPTURE_INTERVAL_MS);
    await third;
    expect(captureVisibleTab).toHaveBeenCalledTimes(3);
  });

  it('rejects a changed tab after the wait instead of capturing the wrong page', async () => {
    const capture = createVisibleCapture();
    await capture(tab);
    const pending = capture(tab);
    const rejected = expect(pending).rejects.toThrow('active tab changed');
    query.mockResolvedValue([{ id: 3, windowId: 2 }]);
    await vi.advanceTimersByTimeAsync(CAPTURE_INTERVAL_MS);
    await rejected;
    expect(captureVisibleTab).toHaveBeenCalledTimes(1);
  });

  it('allows another capture after a rejected browser API request', async () => {
    const capture = createVisibleCapture();
    captureVisibleTab.mockRejectedValueOnce(new Error('Capture interrupted'));
    await expect(capture(tab)).rejects.toThrow('Capture interrupted');
    const pending = capture(tab);
    await vi.advanceTimersByTimeAsync(CAPTURE_INTERVAL_MS);
    await expect(pending).resolves.toContain('data:image/png');
  });
});
