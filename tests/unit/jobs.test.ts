import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireJob, cancelSelection, claimSelection, releaseJob, removeTabJobs } from '../../src/background/jobs';

let storage: Record<string, unknown>;
beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', { storage: { session: {
    get: vi.fn(async () => structuredClone(storage)),
    set: vi.fn(async (value) => { storage = structuredClone(value); }),
  } } });
});

describe('capture job lifecycle', () => {
  it('allows a new capture after navigation abandons selection', async () => {
    await acquireJob(1, 'area');
    await cancelSelection(1);
    expect((await acquireJob(1, 'visible')).phase).toBe('processing');
  });

  it('does not let late commits or cancellation release a replacement job', async () => {
    const old = await acquireJob(1, 'element');
    await cancelSelection(1);
    const current = await acquireJob(1, 'area');
    expect(await claimSelection(1, old.id, old.mode)).toBe(false);
    await cancelSelection(1, old.id);
    await releaseJob(1, old.id);
    expect(await claimSelection(1, current.id, current.mode)).toBe(true);
  });

  it('claims each selection only once and keeps processing jobs on navigation', async () => {
    const job = await acquireJob(1, 'area');
    expect(await claimSelection(1, job.id, 'element')).toBe(false);
    expect(await claimSelection(1, job.id, 'area')).toBe(true);
    expect(await claimSelection(1, job.id, 'area')).toBe(false);
    await cancelSelection(1);
    await expect(acquireJob(1, 'visible')).rejects.toThrow('already active');
    await releaseJob(1, job.id);
    await expect(acquireJob(1, 'visible')).resolves.toBeDefined();
  });

  it('serializes concurrent acquisition without losing jobs in other tabs', async () => {
    const results = await Promise.allSettled([acquireJob(1, 'area'), acquireJob(1, 'visible'), acquireJob(2, 'element')]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(Object.keys(storage.captureJobs as object)).toEqual(['1', '2']);
    await removeTabJobs(1);
    expect(Object.keys(storage.captureJobs as object)).toEqual(['2']);
  });
});
