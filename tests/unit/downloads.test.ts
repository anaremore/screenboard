import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savePng, waitForDownload } from '../../src/background/downloads';

const changed = new Set<(delta: chrome.downloads.DownloadDelta) => void>();
const erased = new Set<(id: number) => void>();
const search = vi.fn();
const download = vi.fn();

beforeEach(() => {
  changed.clear();
  erased.clear();
  search.mockReset().mockResolvedValue([{ id: 1, state: 'in_progress' }]);
  download.mockReset().mockResolvedValue(1);
  vi.stubGlobal('chrome', { downloads: {
    download, search,
    onChanged: { addListener: (listener: (delta: chrome.downloads.DownloadDelta) => void) => changed.add(listener), removeListener: (listener: (delta: chrome.downloads.DownloadDelta) => void) => changed.delete(listener) },
    onErased: { addListener: (listener: (id: number) => void) => erased.add(listener), removeListener: (listener: (id: number) => void) => erased.delete(listener) },
  } });
});
afterEach(() => { vi.useRealTimers(); });

describe('download completion', () => {
  it('does not report saved when Chrome only starts the download', async () => {
    let completed = false;
    const result = savePng('data:image/png;base64,AA==', 'capture.png').then(() => { completed = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(false);
    changed.forEach((listener) => listener({ id: 2, state: { current: 'complete' } }));
    expect(completed).toBe(false);
    changed.forEach((listener) => listener({ id: 1, state: { current: 'complete' } }));
    await result;
    expect(completed).toBe(true);
    expect(changed.size + erased.size).toBe(0);
  });

  it('recognizes a download completed before listener registration', async () => {
    search.mockResolvedValue([{ id: 1, state: 'complete' }]);
    await expect(waitForDownload(1)).resolves.toBeUndefined();
    expect(changed.size + erased.size).toBe(0);
  });

  it('rejects interrupted downloads instead of permitting recovery deletion', async () => {
    const result = waitForDownload(1);
    const rejected = expect(result).rejects.toThrow('interrupted');
    changed.forEach((listener) => listener({ id: 1, state: { current: 'interrupted' } }));
    await rejected;
    expect(changed.size + erased.size).toBe(0);
  });

  it('retains recovery on a missing download or state lookup failure', async () => {
    search.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Unavailable'));
    await expect(waitForDownload(1)).rejects.toThrow('no longer available');
    await expect(waitForDownload(1)).rejects.toThrow('Unavailable');
    expect(changed.size + erased.size).toBe(0);
  });

  it('rejects downloads that never finish and removes listeners', async () => {
    vi.useFakeTimers();
    const result = waitForDownload(1, 100);
    const rejected = expect(result).rejects.toThrow('has not finished');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(changed.size + erased.size).toBe(0);
  });

  it('propagates failures to start the download', async () => {
    download.mockRejectedValue(new Error('Disk unavailable'));
    await expect(savePng('data:', 'capture.png')).rejects.toThrow('Disk unavailable');
    expect(search).not.toHaveBeenCalled();
  });
});
