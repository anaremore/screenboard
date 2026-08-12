import type { ContentMessage } from '../shared/messages';
import type { PageMetrics } from '../shared/types';

declare global {
  interface Window {
    __screenboardFullPageLoaded?: boolean;
  }
}

interface FixedElementState {
  element: HTMLElement;
  visibility: string;
}

interface CaptureState {
  scrollX: number;
  scrollY: number;
  scrollBehavior: string;
  styleElement: HTMLStyleElement;
  fixedElements: FixedElementState[];
}

let state: CaptureState | undefined;

function pageMetrics(): PageMetrics {
  const root = document.documentElement;
  const body = document.body;
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    pageWidth: Math.max(root.scrollWidth, root.offsetWidth, body?.scrollWidth ?? 0, body?.offsetWidth ?? 0),
    pageHeight: Math.max(root.scrollHeight, root.offsetHeight, body?.scrollHeight ?? 0, body?.offsetHeight ?? 0),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio,
  };
}

function prepare(): void {
  if (state) return;
  const styleElement = document.createElement('style');
  styleElement.dataset.screenboardCapture = 'true';
  styleElement.textContent = `
    *, *::before, *::after {
      animation-play-state: paused !important;
      caret-color: transparent !important;
      scroll-behavior: auto !important;
    }
  `;
  document.documentElement.append(styleElement);

  const fixedElements: FixedElementState[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('body *')) {
    const position = getComputedStyle(element).position;
    if (position === 'fixed' || position === 'sticky') {
      fixedElements.push({ element, visibility: element.style.visibility });
    }
  }

  state = {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    scrollBehavior: document.documentElement.style.scrollBehavior,
    styleElement,
    fixedElements,
  };
  document.documentElement.style.scrollBehavior = 'auto';
}

async function scrollAndSettle(x: number, y: number, hideFixed: boolean) {
  if (!state) prepare();
  for (const item of state?.fixedElements ?? []) {
    item.element.style.visibility = hideFixed ? 'hidden' : item.visibility;
  }
  window.scrollTo(x, y);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => window.setTimeout(resolve, 90));
  return { scrollX: window.scrollX, scrollY: window.scrollY };
}

async function restore(): Promise<void> {
  if (!state) return;
  const capturedState = state;
  state = undefined;
  for (const item of capturedState.fixedElements) item.element.style.visibility = item.visibility;
  capturedState.styleElement.remove();
  document.documentElement.style.scrollBehavior = capturedState.scrollBehavior;
  window.scrollTo(capturedState.scrollX, capturedState.scrollY);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

if (!window.__screenboardFullPageLoaded) {
  window.__screenboardFullPageLoaded = true;
  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    if (message.type === 'GET_PAGE_METRICS') {
      sendResponse(pageMetrics());
    } else if (message.type === 'PREPARE_FULL_PAGE') {
      prepare();
      sendResponse({ ok: true });
    } else if (message.type === 'SCROLL_FULL_PAGE') {
      void scrollAndSettle(message.x, message.y, message.hideFixed).then(sendResponse);
      return true;
    } else if (message.type === 'RESTORE_FULL_PAGE') {
      void restore().then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });
}
