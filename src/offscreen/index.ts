import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  MAX_HISTORY_BYTES,
} from '../shared/constants';
import { createCaptureFilename } from '../shared/filename';
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
import type { CaptureType, RecentCapture } from '../shared/types';

interface CaptureRecord {
  id: string;
  type: CaptureType;
  createdAt: number;
  width: number;
  height: number;
  bytes: number;
  filename: string;
  image: Blob;
  thumbnail: Blob;
}

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
    canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } finally {
    bitmap.close();
  }
}

async function storeCapture(type: CaptureType, image: Blob, width: number, height: number): Promise<CaptureRecord> {
  const thumbnail = await createThumbnail(image);
  const record: CaptureRecord = {
    id: crypto.randomUUID(),
    type,
    createdAt: Date.now(),
    width,
    height,
    bytes: image.size + thumbnail.size,
    filename: createCaptureFilename(),
    image,
    thumbnail,
  };
  const db = await database();
  await db.put('captures', record);
  return record;
}

async function cleanHistory(maximumCount: number): Promise<void> {
  const db = await database();
  const records = await db.getAll('captures');
  const ids = historyIdsToDelete(records, maximumCount, MAX_HISTORY_BYTES);
  const transaction = db.transaction('captures', 'readwrite');
  await Promise.all([...ids.map((id) => transaction.store.delete(id)), transaction.done]);
}

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
    const record = await storeCapture(request.captureType, image, canvas.width, canvas.height);
    await cleanHistory(request.settings.maxRecent);
    return {
      ok: true,
      id: record.id,
      width: record.width,
      height: record.height,
      filename: record.filename,
      clipboard: { attempted: false, ok: false },
    };
  } finally {
    bitmap.close();
  }
}

async function processFullPage(request: ProcessFullPageRequest): Promise<ProcessResult> {
  if (request.slices.length === 0) throw new Error('Chrome did not capture any page slices.');
  const firstBlob = await fetch(request.slices[0].dataUrl).then((response) => response.blob());
  const firstBitmap = await createImageBitmap(firstBlob);
  const scaleX = firstBitmap.width / request.metrics.width;
  const scaleY = firstBitmap.height / request.metrics.height;
  const outputWidth = Math.round(request.metrics.pageWidth * scaleX);
  const outputHeight = Math.round(request.metrics.pageHeight * scaleY);
  const canvas = createCanvas(outputWidth, outputHeight);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    firstBitmap.close();
    throw new Error('Chrome could not initialize image processing.');
  }

  try {
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
    const record = await storeCapture('full-page', image, outputWidth, outputHeight);
    await cleanHistory(request.settings.maxRecent);
    return {
      ok: true,
      id: record.id,
      width: outputWidth,
      height: outputHeight,
      filename: record.filename,
      clipboard: { attempted: false, ok: false },
    };
  } finally {
    firstBitmap.close();
  }
}

async function listRecents(): Promise<RecentCapture[]> {
  const records = (await (await database()).getAllFromIndex('captures', 'createdAt')).reverse();
  return Promise.all(records.map(async (record) => ({
    id: record.id,
    type: record.type,
    createdAt: record.createdAt,
    width: record.width,
    height: record.height,
    bytes: record.bytes,
    filename: record.filename,
    thumbnailDataUrl: await blobToDataUrl(record.thumbnail),
  })));
}

async function handleRequest(request: OffscreenRequest): Promise<OffscreenResponse> {
  if (request.operation === 'process-single') return processSingle(request);
  if (request.operation === 'process-full-page') return processFullPage(request);
  if (request.operation === 'list-recents') return { ok: true, captures: await listRecents() };

  const db = await database();
  if (request.operation === 'clear-recents') {
    await db.clear('captures');
    return { ok: true };
  }
  if (request.operation === 'delete-recent') {
    await db.delete('captures', request.id);
    return { ok: true };
  }

  const record = await db.get('captures', request.id);
  if (!record) return { ok: false, error: 'That capture is no longer available.' };
  return { ok: true, dataUrl: await blobToDataUrl(record.image), filename: record.filename };
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
