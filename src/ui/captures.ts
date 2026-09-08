import type { OffscreenResponse, PopupRequest } from '../shared/messages';
import type { CaptureType } from '../shared/types';

export const captureLabels: Record<CaptureType, string> = {
  area: 'Area',
  visible: 'Visible',
  'full-page': 'Full page',
  element: 'Element',
};

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function captureRequest(message: Exclude<PopupRequest, { type: 'CAPTURE_REQUEST' }>): Promise<Exclude<OffscreenResponse, { ok: false }>> {
  const response = await chrome.runtime.sendMessage(message) as OffscreenResponse | undefined;
  if (!response?.ok) throw new Error(response?.error ?? 'Screenboard did not respond. Please try again.');
  return response;
}

export async function captureImage(id: string): Promise<{ dataUrl: string; filename: string }> {
  const response = await captureRequest({ type: 'COPY_RECENT', id });
  if (!('dataUrl' in response)) throw new Error('This PNG is unavailable. It may have been removed from history.');
  return response;
}

export async function copyPng(dataUrl: string): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard access is unavailable. Save the PNG instead.');
  }
  const image = await fetch(dataUrl).then((response) => response.blob());
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
}

export function capturePreviewUrl(id: string): string {
  const url = new URL(chrome.runtime.getURL('options.html'));
  url.searchParams.set('capture', id);
  return url.href;
}
