import type { ContentMessage } from '../shared/messages';
import type { PageMetrics } from '../shared/types';

declare global {
  interface Window {
    __screenboardFullPageLoaded?: boolean;
  }
}

interface InlineProperty {
  name: string;
  value: string;
  priority: string;
}

interface ElementState {
  element: HTMLElement | SVGElement;
  properties: InlineProperty[];
}

interface CaptureState {
  scrollX: number;
  scrollY: number;
  scrollBehavior: InlineProperty;
  styleElement: HTMLStyleElement;
  fixedElements: ElementState[];
  stickyElements: ElementState[];
}

let state: CaptureState | undefined;

function saveProperty(style: CSSStyleDeclaration, name: string): InlineProperty {
  return { name, value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) };
}

function restoreProperty(style: CSSStyleDeclaration, property: InlineProperty): void {
  if (property.value) style.setProperty(property.name, property.value, property.priority);
  else style.removeProperty(property.name);
}

function restoreElement(item: ElementState): void {
  for (const property of item.properties) restoreProperty(item.element.style, property);
}

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

  const fixedElements: ElementState[] = [];
  const stickyElements: ElementState[] = [];
  for (const element of document.querySelectorAll('body *')) {
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
    const position = getComputedStyle(element).position;
    if (position === 'fixed') {
      fixedElements.push({ element, properties: [saveProperty(element.style, 'visibility')] });
    } else if (position === 'sticky') {
      stickyElements.push({
        element,
        properties: ['position', 'top', 'right', 'bottom', 'left'].map((name) => saveProperty(element.style, name)),
      });
    }
  }

  state = {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    scrollBehavior: saveProperty(document.documentElement.style, 'scroll-behavior'),
    styleElement,
    fixedElements,
    stickyElements,
  };
  // Keep sticky content in its normal document flow, including below-fold headings.
  // Relative positioning retains its containing block for absolutely positioned children.
  for (const item of stickyElements) {
    item.element.style.setProperty('position', 'relative', 'important');
    for (const name of ['top', 'right', 'bottom', 'left']) item.element.style.setProperty(name, 'auto', 'important');
  }
  document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
}

async function scrollToAndSettle(x: number, y: number): Promise<{ scrollX: number; scrollY: number }> {
  const scrollingElement = document.scrollingElement ?? document.documentElement;
  const expectedX = Math.max(0, Math.min(x, scrollingElement.scrollWidth - scrollingElement.clientWidth));
  const expectedY = Math.max(0, Math.min(y, scrollingElement.scrollHeight - scrollingElement.clientHeight));
  // CSS auto can still use a previously computed smooth-scroll behavior. An
  // explicit instant request also cancels any smooth scroll already in progress.
  window.scrollTo({ left: expectedX, top: expectedY, behavior: 'instant' });
  await new Promise((resolve) => window.setTimeout(resolve, 90));
  return new Promise((resolve, reject) => {
    let frame = 0;
    let stableFrames = 0;
    let previousX = NaN;
    let previousY = NaN;
    const timeout = window.setTimeout(() => {
      cancelAnimationFrame(frame);
      reject(new Error('The page kept scrolling before Screenboard could capture it. Try an area capture instead.'));
    }, 1500);
    const check = () => {
      const actualX = window.scrollX;
      const actualY = window.scrollY;
      const atTarget = Math.abs(actualX - expectedX) <= 0.5 && Math.abs(actualY - expectedY) <= 0.5;
      stableFrames = atTarget && actualX === previousX && actualY === previousY ? stableFrames + 1 : 0;
      previousX = actualX;
      previousY = actualY;
      if (stableFrames >= 1) {
        window.clearTimeout(timeout);
        resolve({ scrollX: actualX, scrollY: actualY });
      } else {
        frame = requestAnimationFrame(check);
      }
    };
    frame = requestAnimationFrame(check);
  });
}

async function scrollAndSettle(x: number, y: number, hideFixed: boolean) {
  if (!state) prepare();
  for (const item of state?.fixedElements ?? []) {
    if (hideFixed) item.element.style.setProperty('visibility', 'hidden', 'important');
    else restoreElement(item);
  }
  return scrollToAndSettle(x, y);
}

async function restore(): Promise<void> {
  if (!state) return;
  const capturedState = state;
  state = undefined;
  for (const item of [...capturedState.fixedElements, ...capturedState.stickyElements]) restoreElement(item);
  try {
    await scrollToAndSettle(capturedState.scrollX, capturedState.scrollY);
  } finally {
    restoreProperty(document.documentElement.style, capturedState.scrollBehavior);
    capturedState.styleElement.remove();
  }
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
      void scrollAndSettle(message.x, message.y, message.hideFixed)
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'The page could not settle.' }));
      return true;
    } else if (message.type === 'RESTORE_FULL_PAGE') {
      void restore()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'The original scroll position could not be restored.' }));
      return true;
    }
    return false;
  });
}
