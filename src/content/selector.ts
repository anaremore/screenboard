import type { ContentMessage } from '../shared/messages';
import type { FeedbackKind, Point, Rect, ViewportMetrics } from '../shared/types';

declare global {
  interface Window {
    __screenboardSelectorLoaded?: boolean;
  }
}

const ROOT_ID = 'screenboard-capture-root';
const TOAST_ID = 'screenboard-toast-root';

function rectFromPoints(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function viewportMetrics(): ViewportMetrics {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function createHost(id: string): { host: HTMLDivElement; shadow: ShadowRoot } {
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  document.documentElement.append(host);
  return { host, shadow };
}

const sharedStyles = `
  :host { all: initial; color-scheme: light dark; }
  * { box-sizing: border-box; }
  .hint { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 12px; border: 1px solid rgba(255,255,255,.18); border-radius: 9px; background: rgba(17,24,39,.92); box-shadow: 0 8px 24px rgba(0,0,0,.22); color: #f8fafc; font: 500 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif; letter-spacing: .01em; white-space: nowrap; }
  .key { padding: 3px 6px; border: 1px solid rgba(255,255,255,.24); border-radius: 5px; color: #cbd5e1; font-size: 10px; }
  .size { position: fixed; min-width: 70px; padding: 5px 8px; border-radius: 6px; background: #111827; color: white; font: 600 11px/1 system-ui,-apple-system,"Segoe UI",sans-serif; text-align: center; font-variant-numeric: tabular-nums; box-shadow: 0 4px 12px rgba(0,0,0,.24); }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

async function sendCommit(mode: 'area' | 'element', rect: Rect): Promise<void> {
  await nextPaint();
  await chrome.runtime.sendMessage({
    type: 'SELECTION_COMMIT',
    mode,
    rect,
    viewport: viewportMetrics(),
  } satisfies ContentMessage);
}

function startAreaSelection(): void {
  document.getElementById(TOAST_ID)?.remove();
  const { host, shadow } = createHost(ROOT_ID);
  host.style.pointerEvents = 'auto';
  host.style.cursor = 'crosshair';
  shadow.innerHTML = `<style>${sharedStyles}
    .surface { position: fixed; inset: 0; cursor: crosshair; }
    .selection { position: fixed; display: none; border: 1px solid #60a5fa; background: rgba(37,99,235,.08); box-shadow: 0 0 0 99999px rgba(2,6,23,.54), 0 0 0 1px rgba(255,255,255,.4) inset; }
  </style><div class="surface"><div class="selection"></div><div class="hint">Drag to capture an area <span class="key">Esc</span></div><div class="size" hidden></div></div>`;

  const surface = shadow.querySelector<HTMLDivElement>('.surface');
  const selection = shadow.querySelector<HTMLDivElement>('.selection');
  const size = shadow.querySelector<HTMLDivElement>('.size');
  if (!surface || !selection || !size) return;
  let start: Point | undefined;
  let current: Rect | undefined;

  const render = (rect: Rect) => {
    current = rect;
    selection.style.display = 'block';
    selection.style.left = `${rect.x}px`;
    selection.style.top = `${rect.y}px`;
    selection.style.width = `${rect.width}px`;
    selection.style.height = `${rect.height}px`;
    size.hidden = false;
    size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    size.style.left = `${Math.min(window.innerWidth - 82, Math.max(8, rect.x + rect.width - 70))}px`;
    const below = rect.y + rect.height + 8;
    size.style.top = `${below + 28 < window.innerHeight ? below : Math.max(8, rect.y - 29)}px`;
  };

  const cancel = () => {
    cleanup();
    void chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' } satisfies ContentMessage);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };
  const cleanup = () => {
    document.removeEventListener('keydown', onKeyDown, true);
    host.remove();
  };

  surface.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY };
    surface.setPointerCapture(event.pointerId);
    render(rectFromPoints(start, start));
  });
  surface.addEventListener('pointermove', (event) => {
    if (!start) return;
    render(rectFromPoints(start, { x: event.clientX, y: event.clientY }));
  });
  surface.addEventListener('pointerup', (event) => {
    if (!start || !current) return;
    surface.releasePointerCapture(event.pointerId);
    const captureRect = current;
    start = undefined;
    cleanup();
    if (captureRect.width < 2 || captureRect.height < 2) {
      void chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' } satisfies ContentMessage);
      return;
    }
    void sendCommit('area', captureRect);
  });
  document.addEventListener('keydown', onKeyDown, true);
}

function startElementSelection(): void {
  document.getElementById(TOAST_ID)?.remove();
  const { host, shadow } = createHost(ROOT_ID);
  shadow.innerHTML = `<style>${sharedStyles}
    .outline { position: fixed; border: 2px solid #3b82f6; border-radius: 3px; background: rgba(37,99,235,.08); box-shadow: 0 0 0 1px rgba(255,255,255,.75) inset; }
  </style><div class="outline" hidden></div><div class="hint">Click an element <span class="key">↑ parent</span><span class="key">↓ child</span><span class="key">Esc</span></div><div class="size" hidden></div>`;
  const outline = shadow.querySelector<HTMLDivElement>('.outline');
  const size = shadow.querySelector<HTMLDivElement>('.size');
  if (!outline || !size) return;

  let selected: Element | undefined;
  const childTrail: Element[] = [];

  const render = (element: Element) => {
    selected = element;
    const rect = element.getBoundingClientRect();
    outline.hidden = false;
    outline.style.left = `${rect.left}px`;
    outline.style.top = `${rect.top}px`;
    outline.style.width = `${Math.max(0, rect.width)}px`;
    outline.style.height = `${Math.max(0, rect.height)}px`;
    size.hidden = false;
    size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    size.style.left = `${Math.min(window.innerWidth - 82, Math.max(8, rect.left))}px`;
    size.style.top = `${rect.top > 34 ? rect.top - 29 : Math.min(window.innerHeight - 30, rect.bottom + 7)}px`;
  };

  const cleanup = () => {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    host.remove();
  };
  const onMouseMove = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.target === host || host.contains(event.target)) return;
    childTrail.length = 0;
    render(event.target);
  };
  const onClick = (event: MouseEvent) => {
    if (!selected) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = selected.getBoundingClientRect();
    cleanup();
    if (rect.width < 1 || rect.height < 1) {
      void chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' } satisfies ContentMessage);
      return;
    }
    void sendCommit('element', {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cleanup();
      void chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' } satisfies ContentMessage);
      return;
    }
    if (event.key === 'ArrowUp' && selected?.parentElement) {
      event.preventDefault();
      childTrail.push(selected);
      render(selected.parentElement);
    } else if (event.key === 'ArrowDown' && childTrail.length > 0) {
      event.preventDefault();
      const child = childTrail.pop();
      if (child) render(child);
    }
  };

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
}

function showToast(message: string, kind: FeedbackKind): void {
  const { host, shadow } = createHost(TOAST_ID);
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-atomic', 'true');
  host.setAttribute('aria-label', message);
  const icon = kind === 'success'
    ? '<path d="m5 12 4 4L19 6"/>'
    : kind === 'warning'
      ? '<path d="M12 9v4m0 4h.01M10.3 4.6 2.4 18.2A2 2 0 0 0 4.1 21h15.8a2 2 0 0 0 1.7-2.8L13.7 4.6a2 2 0 0 0-3.4 0Z"/>'
      : '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6m0-6 6 6"/>';
  shadow.innerHTML = `<style>${sharedStyles}
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 10px); display: flex; align-items: center; gap: 8px; max-width: min(420px, calc(100vw - 32px)); min-height: 40px; padding: 0 13px; border: 1px solid rgba(255,255,255,.16); border-radius: 9px; background: rgba(17,24,39,.94); box-shadow: 0 10px 30px rgba(0,0,0,.24); color: #f8fafc; font: 500 12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif; opacity: 0; animation: enter 160ms ease-out forwards, leave 120ms ease-in 2.25s forwards; }
    svg { flex: 0 0 auto; color: ${kind === 'success' ? '#86efac' : kind === 'warning' ? '#fde68a' : '#fca5a5'}; }
    @keyframes enter { to { opacity: 1; transform: translate(-50%, 0); } }
    @keyframes leave { to { opacity: 0; transform: translate(-50%, 6px); } }
  </style><div class="toast"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg><span></span></div>`;
  const label = shadow.querySelector('span');
  if (label) label.textContent = message;
  window.setTimeout(() => host.remove(), 2500);
}

async function copyImage(dataUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      throw new Error('Image clipboard access is unavailable on this platform.');
    }
    const image = await fetch(dataUrl).then((response) => response.blob());
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Clipboard access was blocked.' };
  }
}

if (!window.__screenboardSelectorLoaded) {
  window.__screenboardSelectorLoaded = true;
  chrome.runtime.onMessage.addListener((rawMessage: ContentMessage, _sender, sendResponse) => {
    if (rawMessage.type === 'START_SELECTION') {
      document.getElementById(ROOT_ID)?.remove();
      document.getElementById(TOAST_ID)?.remove();
      if (rawMessage.mode === 'area') startAreaSelection();
      else startElementSelection();
    } else if (rawMessage.type === 'HIDE_SCREENBOARD_UI') {
      document.getElementById(ROOT_ID)?.remove();
      document.getElementById(TOAST_ID)?.remove();
      sendResponse({ ok: true });
    } else if (rawMessage.type === 'SHOW_FEEDBACK') {
      showToast(rawMessage.message, rawMessage.kind);
    } else if (rawMessage.type === 'COPY_IMAGE') {
      void copyImage(rawMessage.dataUrl).then(sendResponse);
      return true;
    }
    return false;
  });
}
