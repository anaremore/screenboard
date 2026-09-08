import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureStore, type CapturePersistence, type CaptureRecord } from '../../src/offscreen/capture-store';
import { DEFAULT_SETTINGS, IN_FLIGHT_CAPTURE_TTL_MS, MAX_HISTORY_BYTES, MAX_TEMPORARY_CAPTURES } from '../../src/shared/constants';
import { historyIdsToDelete } from '../../src/shared/history';

function setup() {
  const records = new Map<string, CaptureRecord>();
  const persistence = {
    list: vi.fn(async () => [...records.values()]),
    get: vi.fn(async (id: string) => records.get(id)),
    save: vi.fn(async (record: CaptureRecord, maximumCount: number) => {
      records.set(record.id, record);
      const candidates = [record, ...[...records.values()].filter((item) => item.id !== record.id)];
      const deletions = historyIdsToDelete(candidates, maximumCount);
      for (const id of deletions) records.delete(id);
      return !deletions.includes(record.id);
    }),
    delete: vi.fn(async (id: string) => { records.delete(id); }),
    clear: vi.fn(async () => { records.clear(); }),
  } satisfies CapturePersistence;
  const thumbnail = vi.fn(async () => new Blob(['thumbnail'], { type: 'image/png' }));
  const encode = vi.fn(async () => 'data:image/png;base64,cG5n');
  const store = new CaptureStore(persistence, thumbnail, encode);
  const create = (image = new Blob(['png'], { type: 'image/png' })) => store.create('visible', image, 100, 80);
  return { store, persistence, records, thumbnail, encode, create };
}

const historyOff = { ...DEFAULT_SETTINGS, keepRecent: false };

describe('offscreen capture delivery and retention', () => {
  afterEach(() => vi.restoreAllMocks());
  it('makes an in-flight PNG exportable without accessing history or creating a thumbnail', async () => {
    const { store, persistence, thumbnail, create } = setup();
    persistence.get.mockRejectedValue(new Error('Storage unavailable'));
    persistence.save.mockRejectedValue(new Error('Quota exceeded'));
    const capture = create();

    expect(await store.export(capture.id)).toMatchObject({ ok: true, dataUrl: 'data:image/png;base64,cG5n' });
    expect(thumbnail).not.toHaveBeenCalled();
    expect(persistence.get).not.toHaveBeenCalled();
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it('discards delivered PNGs with history off without changing existing history', async () => {
    const { store, persistence, thumbnail, create } = setup();
    const previous = create();
    await store.finalize(previous.id, DEFAULT_SETTINGS, true);
    persistence.save.mockClear();
    thumbnail.mockClear();
    const next = create();

    expect(await store.finalize(next.id, historyOff, true)).toEqual({ ok: true, retained: false });
    expect((await store.list()).map((capture) => capture.id)).toEqual([previous.id]);
    expect(await store.export(next.id)).toMatchObject({ ok: false });
    expect(thumbnail).not.toHaveBeenCalled();
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it('keeps a labeled recovery when neither destination succeeds and history is off', async () => {
    const { store, create } = setup();
    const capture = create();

    expect(await store.finalize(capture.id, historyOff, false)).toEqual({ ok: true, retained: true });
    expect(await store.list()).toMatchObject([{ id: capture.id, recovery: true, temporary: false }]);
    expect(await store.export(capture.id)).toMatchObject({ ok: true });
  });

  it('preserves usable temporary recovery when an IndexedDB write fails', async () => {
    const { store, persistence, create } = setup();
    persistence.save.mockRejectedValue(new Error('Quota exceeded'));
    persistence.list.mockRejectedValue(new Error('Database unavailable'));
    const capture = create();

    expect(await store.finalize(capture.id, historyOff, false)).toMatchObject({
      ok: true, retained: true, temporary: true, warning: expect.stringContaining('Save it now'),
    });
    expect(await store.list()).toMatchObject([{ id: capture.id, recovery: true, temporary: true }]);
    expect(await store.export(capture.id)).toMatchObject({ ok: true });
    await store.delete(capture.id);
    expect(persistence.delete).not.toHaveBeenCalled();
    expect(await store.export(capture.id)).toMatchObject({ ok: false });
  });

  it('provides a placeholder and the original PNG if thumbnail generation fails', async () => {
    const { store, persistence, thumbnail, create } = setup();
    thumbnail.mockRejectedValue(new Error('Canvas allocation failed'));
    const capture = create();

    expect(await store.finalize(capture.id, DEFAULT_SETTINGS, true)).toMatchObject({ temporary: true });
    expect(await store.list()).toMatchObject([{
      id: capture.id, temporary: true, recovery: false,
      thumbnailDataUrl: expect.stringMatching(/^data:image\/svg\+xml,/),
    }]);
    expect(await store.export(capture.id)).toMatchObject({ ok: true });
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it('keeps an oversized newest PNG temporarily without deleting older durable history', async () => {
    const { store, persistence, records, create } = setup();
    const previous = create();
    await store.finalize(previous.id, DEFAULT_SETTINGS, true);
    persistence.save.mockClear();
    const image = new Blob(['png']);
    Object.defineProperty(image, 'size', { value: MAX_HISTORY_BYTES + 1 });
    const large = create(image);

    expect(await store.finalize(large.id, DEFAULT_SETTINGS, true)).toMatchObject({ temporary: true, retained: true });
    expect([...records.keys()]).toEqual([previous.id]);
    expect(persistence.save).not.toHaveBeenCalled();
    expect(await store.export(large.id)).toMatchObject({ ok: true });
    expect(await store.list()).toHaveLength(2);
  });

  it('bounds temporary recoveries by count without evicting an active delivery', async () => {
    const { store, persistence, create } = setup();
    persistence.save.mockRejectedValue(new Error('Quota exceeded'));
    const active = create();
    const finalizedIds: string[] = [];
    for (let index = 0; index < MAX_TEMPORARY_CAPTURES + 2; index += 1) {
      const capture = create();
      finalizedIds.push(capture.id);
      await store.finalize(capture.id, historyOff, false);
    }

    expect(await store.list()).toHaveLength(MAX_TEMPORARY_CAPTURES);
    expect(await store.export(active.id)).toMatchObject({ ok: true });
    expect(await store.export(finalizedIds.at(-1)!)).toMatchObject({ ok: true });
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(await store.export(active.id)).toMatchObject({ ok: true });
  });

  it('bounds temporary bytes while retaining the latest recovery', async () => {
    const { store, persistence, create } = setup();
    persistence.save.mockRejectedValue(new Error('Quota exceeded'));
    const image = new Blob(['png']);
    Object.defineProperty(image, 'size', { value: Math.floor(MAX_HISTORY_BYTES * 0.6) });
    const older = create(image);
    const latest = create(image);
    await store.finalize(older.id, historyOff, false);
    await store.finalize(latest.id, historyOff, false);

    expect((await store.list()).map((capture) => capture.id)).toEqual([latest.id]);
    expect(await store.export(latest.id)).toMatchObject({ ok: true });
    expect(await store.export(older.id)).toMatchObject({ ok: false });
  });

  it('exposes abandoned deliveries as bounded recovery while protecting recent active delivery', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const { store, create } = setup();
    for (let index = 0; index < MAX_TEMPORARY_CAPTURES + 2; index += 1) create();
    clock.mockReturnValue(10_000 + IN_FLIGHT_CAPTURE_TTL_MS - 1);
    const active = create();
    expect(await store.list()).toEqual([]);
    clock.mockReturnValue(10_000 + IN_FLIGHT_CAPTURE_TTL_MS + 1);

    const recovered = await store.list();
    expect(recovered).toHaveLength(MAX_TEMPORARY_CAPTURES);
    expect(recovered.every((capture) => capture.recovery && capture.temporary)).toBe(true);
    expect(recovered.some((capture) => capture.id === active.id)).toBe(false);
    expect(await store.export(active.id)).toMatchObject({ ok: true });
    expect(await store.export(recovered[0].id)).toMatchObject({ ok: true });
  });

  it('accepts late delivery completion after an abandoned PNG was promoted to recovery', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const { store, create, persistence } = setup();
    const capture = create();
    clock.mockReturnValue(10_000 + IN_FLIGHT_CAPTURE_TTL_MS + 1);
    expect(await store.list()).toMatchObject([{ id: capture.id, temporary: true }]);

    expect(await store.finalize(capture.id, historyOff, true)).toEqual({ ok: true, retained: false });
    expect(await store.list()).toEqual([]);
    expect(persistence.save).not.toHaveBeenCalled();
  });


  it('keeps late recovery accessible when newer finalized captures already fill the history limit', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const { store, create, records } = setup();
    const delayed = create();
    clock.mockReturnValue(10_001);
    const newest = create();
    const settings = { ...DEFAULT_SETTINGS, maxRecent: 1 };
    await store.finalize(newest.id, settings, true);

    expect(await store.finalize(delayed.id, settings, false)).toMatchObject({
      retained: true, temporary: true,
    });
    expect([...records.keys()]).toEqual([newest.id]);
    expect(await store.export(delayed.id)).toMatchObject({ ok: true });
  });

});
