import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  MAX_HISTORY_BYTES,
} from '../shared/constants';
import { mapCssRectToImage } from '../shared/geometry';
import { historyIdsToDelete } from '../shared/history';
import type {
  OffscreenEnvelope,
  OffscreenRequest,
  OffscreenResponse,
  ProcessFullPageRequest,
  ProcessResult,
  ProcessSingleRequest,
} from '../shared/messages';
import { CaptureStore, type CaptureRecord } from './capture-store';

interface ScreenboardDatabase extends DBSchema {
  captures: {
    key: string;
    value: CaptureRecord;
    indexes: { createdAt: number };
  };
}

let databasePromise: Promise<IDBPDatabase<ScreenboardDatabase>> | undefined;

function database(): Promise<IDBPDatabase<ScreenboardDatabase>> {
  databasePromise ??= openDB<ScreenboardDatabase>('screenboard', 1, {
    upgrade(db) {
      const store = db.createObjectStore('captures', { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    },
  }).catch((error: unknown) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (width <= 0 || height <= 0) throw new Error('The selected area is empty.');
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > MAX_CANVAS_PIXELS) {
    throw new Error('This capture is too large for Chrome to process safely. Try a smaller page or area.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Chrome could not create the PNG.'));
    }, 'image/png');
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read the PNG.')), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function createThumbnail(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  try {
    const scale = Math.min(1, 160 / bitmap.width, 100 / bitmap.height);
    const canvas = createCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Chrome could not initialize thumbnail processing.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } finally {
    bitmap.close();
  }
}

const captures = new CaptureStore({
  async list() {
    return (await database()).getAllFromIndex('captures', 'createdAt');
  },
  async get(id) {
    return (await database()).get('captures', id);
  },
  async save(record, maximumCount) {
    const db = await database();
    const transaction = db.transaction('captures', 'readwrite');
    try {
      await transaction.store.put(record);
      const stored = await transaction.store.getAll();
      // Put the new capture first so equal timestamps do not discard it.
      const candidates = [record, ...stored.filter((item) => item.id !== record.id)];
      const ids = historyIdsToDelete(candidates, maximumCount, MAX_HISTORY_BYTES);
      await Promise.all(ids.map((id) => transaction.store.delete(id)));
      await transaction.done;
      return !ids.includes(record.id);
    } catch (error) {
      try { transaction.abort(); } catch { /* The transaction may already have aborted. */ }
      await transaction.done.catch(() => undefined);
      throw error;
    }
  },
  async delete(id) {
    await (await database()).delete('captures', id);
  },
  async clear() {
    await (await database()).clear('captures');
  },
}, createThumbnail, blobToDataUrl);

async function processSingle(request: ProcessSingleRequest): Promise<ProcessResult> {
  const sourceBlob = await fetch(request.dataUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const source = request.rect
      ? mapCssRectToImage(request.rect, request.viewport, { width: bitmap.width, height: bitmap.height })
      : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const canvas = createCanvas(source.width, source.height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Chrome could not initialize image processing.');
    context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, source.width, source.height);
    const image = await canvasToBlob(canvas);
    return captures.create(request.captureType, image, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

async function processFullPage(request: ProcessFullPageRequest): Promise<ProcessResult> {
  if (request.slices.length === 0) throw new Error('Chrome did not capture any page slices.');
  const firstBlob = await fetch(request.slices[0].dataUrl).then((response) => response.blob());
  const firstBitmap = await createImageBitmap(firstBlob);
  try {
    const scaleX = firstBitmap.width / request.metrics.width;
    const scaleY = firstBitmap.height / request.metrics.height;
    const outputWidth = Math.round(request.metrics.pageWidth * scaleX);
    const outputHeight = Math.round(request.metrics.pageHeight * scaleY);
    const canvas = createCanvas(outputWidth, outputHeight);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Chrome could not initialize image processing.');
    for (let index = 0; index < request.slices.length; index += 1) {
      const slice = request.slices[index];
      const bitmap = index === 0
        ? firstBitmap
        : await createImageBitmap(await fetch(slice.dataUrl).then((response) => response.blob()));
      try {
        const sx = Math.round(slice.source.x * scaleX);
        const sy = Math.round(slice.source.y * scaleY);
        const sw = Math.round(slice.source.width * scaleX);
        const sh = Math.round(slice.source.height * scaleY);
        const dx = Math.round(slice.destination.x * scaleX);
        const dy = Math.round(slice.destination.y * scaleY);
        const right = Math.round((slice.destination.x + slice.destination.width) * scaleX);
        const bottom = Math.round((slice.destination.y + slice.destination.height) * scaleY);
        context.drawImage(bitmap, sx, sy, sw, sh, dx, dy, right - dx, bottom - dy);
      } finally {
        if (index !== 0) bitmap.close();
      }
    }

    const image = await canvasToBlob(canvas);
    return captures.create('full-page', image, outputWidth, outputHeight);
  } finally {
    firstBitmap.close();
  }
}

async function handleRequest(request: OffscreenRequest): Promise<OffscreenResponse> {
  if (request.operation === 'process-single') return processSingle(request);
  if (request.operation === 'process-full-page') return processFullPage(request);
  if (request.operation === 'finalize-capture') return captures.finalize(request.id, request.settings, request.delivered);
  if (request.operation === 'list-recents') return { ok: true, captures: await captures.list() };
  if (request.operation === 'clear-recents') {
    await captures.clear();
    return { ok: true };
  }
  if (request.operation === 'delete-recent') {
    await captures.delete(request.id);
    return { ok: true };
  }
  return captures.export(request.id);
}

chrome.runtime.onMessage.addListener((message: OffscreenEnvelope, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;
  void handleRequest(message.request)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Image processing failed.',
    } satisfies OffscreenResponse));
  return true;
});
