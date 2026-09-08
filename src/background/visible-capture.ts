import { CAPTURE_INTERVAL_MS } from '../shared/constants';

export function createVisibleCapture() {
  let queue: Promise<unknown> = Promise.resolve();
  let lastCaptureAt: number | undefined;
  return (tab: chrome.tabs.Tab): Promise<string> => {
    const capture = queue.then(async () => {
      if (tab.windowId === undefined) throw new Error('This tab is no longer available.');
      const wait = lastCaptureAt === undefined ? 0 : CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      // Check after waiting: the user may switch tabs while a prior capture finishes.
      const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      if (active?.id !== tab.id) throw new Error('The active tab changed before Screenboard could capture it.');
      lastCaptureAt = Date.now();
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    });
    queue = capture.catch(() => undefined);
    return capture;
  };
}
