import { IN_FLIGHT_CAPTURE_TTL_MS, MAX_HISTORY_BYTES, MAX_TEMPORARY_CAPTURES } from '../shared/constants';
import { createCaptureFilename } from '../shared/filename';
import type { FinalizeCaptureResult, OffscreenResponse, ProcessResult } from '../shared/messages';
import type { CaptureSettings, CaptureType, RecentCapture } from '../shared/types';

export interface CaptureRecord {
  id: string;
  type: CaptureType;
  createdAt: number;
  width: number;
  height: number;
  bytes: number;
  filename: string;
  image: Blob;
  thumbnail?: Blob;
  recovery?: boolean;
}

export interface CapturePersistence {
  list(): Promise<CaptureRecord[]>;
  get(id: string): Promise<CaptureRecord | undefined>;
  save(record: CaptureRecord, maximumCount: number): Promise<boolean>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

const PLACEHOLDER_THUMBNAIL = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><rect width="160" height="100" rx="8" fill="#e2e8f0"/><path d="M45 73V27h70v46H45m0-8 22-22 16 16 11-11 21 21" fill="none" stroke="#64748b" stroke-width="3"/></svg>')}`;
const TEMPORARY_WARNING = 'Only a temporary copy is available in Recent. Save it now to keep it.';

export class CaptureStore {
  // Active delivery and temporary recovery have separate lifetimes: pruning recovery must
  // never remove a PNG that a capture job is still trying to copy or download.
  private readonly inFlight = new Map<string, CaptureRecord>();
  private readonly temporary = new Map<string, CaptureRecord>();
  private readonly finalizing = new Set<string>();

  constructor(
    private readonly persistence: CapturePersistence,
    private readonly createThumbnail: (image: Blob) => Promise<Blob>,
    private readonly encodeBlob: (image: Blob) => Promise<string>,
  ) {}

  create(type: CaptureType, image: Blob, width: number, height: number): ProcessResult {
    this.recoverAbandoned();
    const record: CaptureRecord = {
      id: crypto.randomUUID(), type, image, width, height,
      bytes: image.size, createdAt: Date.now(), filename: createCaptureFilename(),
    };
    this.inFlight.set(record.id, record);
    return {
      ok: true, id: record.id, width, height, filename: record.filename,
      clipboard: { attempted: false, ok: false },
    };
  }

  async finalize(id: string, settings: CaptureSettings, delivered: boolean): Promise<OffscreenResponse> {
    const record = this.inFlight.get(id) ?? this.temporary.get(id);
    if (!record) return { ok: false, error: 'That capture is no longer available.' };
    if (!settings.keepRecent && delivered) {
      this.temporary.delete(id);
      this.inFlight.delete(id);
      return { ok: true, retained: false } satisfies FinalizeCaptureResult;
    }

    this.temporary.delete(id);
    this.inFlight.set(id, record);
    this.finalizing.add(id);
    record.recovery = !delivered;
    let warning = `Recent history could not be saved. ${TEMPORARY_WARNING}`;
    try {
      // Avoid even attempting a durable write when this image cannot fit the history cap.
      if (record.image.size > MAX_HISTORY_BYTES) {
        warning = `This PNG exceeds the history size limit. ${TEMPORARY_WARNING}`;
        throw new Error('Capture exceeds the history size limit.');
      }
      record.thumbnail = await this.createThumbnail(record.image);
      record.bytes = record.image.size + record.thumbnail.size;
      if (record.bytes > MAX_HISTORY_BYTES) {
        warning = `This PNG exceeds the history size limit. ${TEMPORARY_WARNING}`;
        throw new Error('Capture exceeds the history size limit.');
      }
      const retained = await this.persistence.save(record, settings.maxRecent);
      if (!retained) {
        warning = `This capture is outside the recent-history limit. ${TEMPORARY_WARNING}`;
        throw new Error('Capture was excluded by retention cleanup.');
      }
      this.inFlight.delete(id);
      return { ok: true, retained: true } satisfies FinalizeCaptureResult;
    } catch {
      this.temporary.set(id, record);
      this.inFlight.delete(id);
      this.pruneTemporary(id);
      return { ok: true, retained: true, temporary: true, warning } satisfies FinalizeCaptureResult;
    } finally {
      this.finalizing.delete(id);
    }
  }

  private recoverAbandoned(): void {
    const cutoff = Date.now() - IN_FLIGHT_CAPTURE_TTL_MS;
    // Sweep on new captures and Recent reads. A terminated service worker may never
    // finalize its PNG; subsequent activity must not accumulate unreachable images.
    for (const [id, record] of this.inFlight) {
      if (record.createdAt > cutoff || this.finalizing.has(id)) continue;
      record.recovery = true;
      this.temporary.set(id, record);
      this.inFlight.delete(id);
    }
    const newest = [...this.temporary.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (newest) this.pruneTemporary(newest.id);
  }

  private pruneTemporary(newestId: string): void {
    const newest = this.temporary.get(newestId)!;
    const older = [...this.temporary.values()]
      .filter((record) => record.id !== newestId)
      .sort((a, b) => b.createdAt - a.createdAt);
    let count = 1;
    let bytes = newest.bytes;
    // Keep the newest recovery even when it alone is oversized. The next finalized
    // recovery replaces it, so oversized failures cannot accumulate without a bound.
    for (const record of older) {
      if (count >= MAX_TEMPORARY_CAPTURES || bytes + record.bytes > MAX_HISTORY_BYTES) {
        this.temporary.delete(record.id);
      } else {
        count += 1;
        bytes += record.bytes;
      }
    }
  }

  async list(): Promise<RecentCapture[]> {
    this.recoverAbandoned();
    let persisted: CaptureRecord[];
    try {
      persisted = await this.persistence.list();
    } catch (error) {
      if (this.temporary.size === 0) throw error;
      persisted = [];
    }
    const records = new Map(persisted.map((record) => [record.id, record]));
    for (const record of this.temporary.values()) records.set(record.id, record);
    return Promise.all([...records.values()].sort((a, b) => b.createdAt - a.createdAt).map(async (record) => ({
      id: record.id, type: record.type, createdAt: record.createdAt,
      width: record.width, height: record.height, bytes: record.bytes, filename: record.filename,
      thumbnailDataUrl: record.thumbnail
        ? await this.encodeBlob(record.thumbnail).catch(() => PLACEHOLDER_THUMBNAIL)
        : PLACEHOLDER_THUMBNAIL,
      recovery: record.recovery,
      temporary: this.temporary.has(record.id),
    })));
  }

  async export(id: string): Promise<OffscreenResponse> {
    const record = this.inFlight.get(id) ?? this.temporary.get(id) ?? await this.persistence.get(id);
    if (!record) return { ok: false, error: 'That capture is no longer available.' };
    return { ok: true, dataUrl: await this.encodeBlob(record.image), filename: record.filename };
  }

  async delete(id: string): Promise<void> {
    if (this.temporary.delete(id) || this.inFlight.delete(id)) return;
    await this.persistence.delete(id);
  }

  async clear(): Promise<void> {
    this.temporary.clear();
    await this.persistence.clear();
  }
}
