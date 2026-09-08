import { DEFAULT_SETTINGS, MAX_CANVAS_DIMENSION, MAX_CANVAS_PIXELS } from '../shared/constants';
import { captureFeedback } from '../shared/capture-feedback';
import { planFullPageSlices, positionFullPageSlice } from '../shared/full-page';
import type {
  CaptureRequestMessage,
  ContentMessage,
  OffscreenEnvelope,
  OffscreenRequest,
  OffscreenResponse,
  PopupRequest,
  ProcessResult,
} from '../shared/messages';
import { normalizeSettings } from '../shared/settings';
import type { CapturedSlice, CaptureSettings, CaptureType, FeedbackMessage, PageMetrics } from '../shared/types';
import { isKnownProtectedPage } from '../shared/urls';
import { savePng } from './downloads';
import { createVisibleCapture } from './visible-capture';
import { acquireJob, cancelSelection, claimSelection, releaseJob, removeTabJobs, type CaptureJob } from './jobs';

const OFFSCREEN_PATH = 'offscreen.html';
let creatingOffscreen: Promise<void> | undefined;

async function settings(): Promise<CaptureSettings> {
  const stored = await chrome.storage.local.get('settings');
  return normalizeSettings(stored.settings as Partial<CaptureSettings> | undefined);
}

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (existing.length > 0) return;
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Crop and stitch screenshots, create PNG blobs, and store local capture history.',
  }).finally(() => {
    creatingOffscreen = undefined;
  });
  await creatingOffscreen;
}

async function sendOffscreen(request: OffscreenRequest): Promise<OffscreenResponse> {
  await ensureOffscreen();
  const envelope: OffscreenEnvelope = {
    target: 'offscreen',
    requestId: crypto.randomUUID(),
    request,
  };
  return chrome.runtime.sendMessage(envelope) as Promise<OffscreenResponse>;
}

async function activeTab(explicitTabId?: number): Promise<chrome.tabs.Tab> {
  if (explicitTabId !== undefined) return chrome.tabs.get(explicitTabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab is available to capture.');
  return tab;
}

function requireTabId(tab: chrome.tabs.Tab): number {
  if (tab.id === undefined || tab.windowId === undefined) throw new Error('This tab is no longer available.');
  return tab.id;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Cannot access|Missing host permission|The extensions gallery cannot be scripted|chrome:\/\//i.test(message)) {
    return "Screenboard can't capture this protected Chrome page.";
  }
  if (/No tab with id|closed|receiving end does not exist/i.test(message)) {
    return 'The page changed or closed before Screenboard could finish.';
  }
  if (/too large/i.test(message)) return message;
  if (/already active/i.test(message)) return message;
  return `Screenboard couldn't finish this capture. ${message}`;
}

async function inject(tabId: number, file: string): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
}

async function showBadge(tabId: number, feedback: FeedbackMessage): Promise<void> {
  const text = feedback.kind === 'success' ? '✓' : '!';
  await chrome.action.setBadgeBackgroundColor({ tabId, color: feedback.kind === 'error' ? '#DC2626' : '#2563EB' });
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setTitle({ tabId, title: feedback.message });
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: '' });
    void chrome.action.setTitle({ tabId, title: 'Screenboard' });
  }, 2500);
}

async function showFeedback(tabId: number, feedback: FeedbackMessage): Promise<void> {
  try {
    await inject(tabId, 'assets/selector.js');
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_FEEDBACK', ...feedback } satisfies ContentMessage);
  } catch {
    await showBadge(tabId, feedback);
  }
}

const captureVisible = createVisibleCapture();

async function hideScreenboardUi(tabId: number): Promise<void> {
  try {
    await inject(tabId, 'assets/selector.js');
    await chrome.tabs.sendMessage(tabId, { type: 'HIDE_SCREENBOARD_UI' } satisfies ContentMessage);
  } catch {
    // Visible capture can still work on protected pages where content scripts are unavailable.
  }
}

async function exportCapture(id: string): Promise<boolean> {
  const exported = await sendOffscreen({ operation: 'export-recent', id });
  if (!exported.ok || !('dataUrl' in exported)) return false;
  await savePng(exported.dataUrl, exported.filename);
  return true;
}

async function copyCaptureToTab(tabId: number, id: string): Promise<{ attempted: true; ok: boolean; error?: string }> {
  try {
    const exported = await sendOffscreen({ operation: 'export-recent', id });
    if (!exported.ok || !('dataUrl' in exported)) {
      return { attempted: true, ok: false, error: !exported.ok ? exported.error : 'The PNG is unavailable.' };
    }
    await inject(tabId, 'assets/selector.js');
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'COPY_IMAGE',
      dataUrl: exported.dataUrl,
    } satisfies ContentMessage) as { ok: boolean; error?: string };
    return { attempted: true, ...response };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : 'Clipboard access was blocked.',
    };
  }
}

async function finalizeCapture(
  tabId: number,
  result: ProcessResult,
  captureSettings: CaptureSettings,
  captureType: CaptureType,
  details: { sliceCount?: number } = {},
): Promise<void> {
  const clipboard = await copyCaptureToTab(tabId, result.id);
  const completedResult = { ...result, clipboard };
  const saved = captureSettings.saveAutomatically ? await exportCapture(completedResult.id).catch(() => false) : false;
  const copied = completedResult.clipboard.attempted && completedResult.clipboard.ok;
  const hasDestination = copied || saved;

  const retention = await sendOffscreen({
    operation: 'finalize-capture', id: result.id, settings: captureSettings, delivered: hasDestination,
  }).catch(() => ({ ok: false as const, error: 'Recent history could not be updated. Open Recent to check for a recovery copy.' }));
  const retentionWarning = !retention.ok ? retention.error : 'warning' in retention ? retention.warning : undefined;

  await chrome.storage.session.set({
    lastCaptureDiagnostics: {
      captureType,
      width: completedResult.width,
      height: completedResult.height,
      clipboardAttempted: completedResult.clipboard.attempted,
      clipboardOk: copied,
      clipboardError: completedResult.clipboard.error,
      saved,
      historyWarning: retentionWarning,
      sliceCount: details.sliceCount,
      completedAt: Date.now(),
    },
  });

  const feedback = captureFeedback(copied, saved);
  if (captureSettings.saveAutomatically && !saved) {
    feedback.kind = 'warning';
    feedback.message = copied
      ? 'Copied to clipboard — automatic saving did not finish. Check Chrome Downloads.'
      : 'Copying and saving did not finish — recover the PNG from Recent.';
  }
  if (retentionWarning) {
    feedback.kind = 'warning';
    feedback.message = `${copied ? 'Copied to clipboard.' : saved ? 'PNG saved.' : 'Clipboard blocked.'} ${retentionWarning}`;
  }
  await showFeedback(tabId, feedback).catch(() => undefined);
}

async function processVisible(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = requireTabId(tab);
  await hideScreenboardUi(tabId);
  const dataUrl = await captureVisible(tab);
  const captureSettings = await settings();
  const response = await sendOffscreen({
    operation: 'process-single',
    captureType: 'visible',
    dataUrl,
    // Visible captures are not cropped, so protected Chrome pages do not need script injection.
    viewport: { width: 1, height: 1, devicePixelRatio: 1 },
    settings: captureSettings,
  });
  if (!response.ok) throw new Error(response.error);
  if (!('id' in response)) throw new Error('Image processing returned an unexpected result.');
  await finalizeCapture(tabId, response, captureSettings, 'visible');
}

async function startSelection(tab: chrome.tabs.Tab, mode: 'area' | 'element', jobId: string): Promise<void> {
  const tabId = requireTabId(tab);
  await inject(tabId, 'assets/selector.js');
  await chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION', mode, jobId } satisfies ContentMessage);
}

async function processSelection(
  tab: chrome.tabs.Tab,
  message: Extract<ContentMessage, { type: 'SELECTION_COMMIT' }>,
): Promise<void> {
  const tabId = requireTabId(tab);
  if (!await claimSelection(tabId, message.jobId, message.mode)) return;
  try {
    const dataUrl = await captureVisible(tab);
    const captureSettings = await settings();
    const response = await sendOffscreen({
      operation: 'process-single',
      captureType: message.mode,
      dataUrl,
      rect: message.rect,
      viewport: message.viewport,
      settings: captureSettings,
    });
    if (!response.ok) throw new Error(response.error);
    if (!('id' in response)) throw new Error('Image processing returned an unexpected result.');
    await finalizeCapture(tabId, response, captureSettings, message.mode);
  } catch (error) {
    await chrome.storage.session.set({ lastCaptureDiagnostics: {
      captureType: message.mode, failed: true, error: friendlyError(error), completedAt: Date.now(),
    } });
    await showFeedback(tabId, { kind: 'error', message: friendlyError(error) });
  } finally {
    await releaseJob(tabId, message.jobId);
  }
}

async function processFullPage(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = requireTabId(tab);
  let prepared = false;
  try {
    await inject(tabId, 'assets/fullPage.js');
    const metrics = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_METRICS' } satisfies ContentMessage) as PageMetrics;
    const estimatedWidth = Math.round(metrics.pageWidth * metrics.devicePixelRatio);
    const estimatedHeight = Math.round(metrics.pageHeight * metrics.devicePixelRatio);
    if (
      estimatedWidth > MAX_CANVAS_DIMENSION
      || estimatedHeight > MAX_CANVAS_DIMENSION
      || estimatedWidth * estimatedHeight > MAX_CANVAS_PIXELS
    ) {
      throw new Error('This page is too large for a single PNG. Try capturing an area instead.');
    }
    const plan = planFullPageSlices(metrics);
    await hideScreenboardUi(tabId);
    await chrome.tabs.sendMessage(tabId, { type: 'PREPARE_FULL_PAGE' } satisfies ContentMessage);
    prepared = true;
    const slices: CapturedSlice[] = [];

    for (const planned of plan) {
      const actual = await chrome.tabs.sendMessage(tabId, {
        type: 'SCROLL_FULL_PAGE',
        x: planned.scrollX,
        y: planned.scrollY,
        hideFixed: planned.index > 0,
      } satisfies ContentMessage) as { scrollX: number; scrollY: number; ok?: boolean; error?: string };
      if (actual?.ok === false) throw new Error(actual.error ?? 'The page did not settle at the requested position.');
      const dataUrl = await captureVisible(tab);
      slices.push({ ...positionFullPageSlice(planned, actual, metrics), dataUrl });
    }

    // Restore the page as soon as pixels are collected; saving can take longer.
    await chrome.tabs.sendMessage(tabId, { type: 'RESTORE_FULL_PAGE' } satisfies ContentMessage)
      .then((response: { ok?: boolean } | undefined) => { prepared = response?.ok !== true; })
      .catch(() => undefined);
    const captureSettings = await settings();
    const response = await sendOffscreen({
      operation: 'process-full-page',
      captureType: 'full-page',
      metrics,
      slices,
      settings: captureSettings,
    });
    if (!response.ok) throw new Error(response.error);
    if (!('id' in response)) throw new Error('Image processing returned an unexpected result.');
    await finalizeCapture(tabId, response, captureSettings, 'full-page', { sliceCount: slices.length });
  } finally {
    if (prepared) {
      await chrome.tabs.sendMessage(tabId, { type: 'RESTORE_FULL_PAGE' } satisfies ContentMessage).catch(() => undefined);
    }
  }
}

async function orchestrate(message: CaptureRequestMessage): Promise<{ started: true }> {
  let tabId: number | undefined;
  let job: CaptureJob | undefined;
  try {
    const tab = await activeTab(message.tabId);
    tabId = requireTabId(tab);
    job = await acquireJob(tabId, message.mode);
    if (message.mode !== 'visible' && isKnownProtectedPage(tab.url)) {
      throw new Error('Cannot access this protected browser page.');
    }
    if (message.mode === 'area' || message.mode === 'element') {
      await startSelection(tab, message.mode, job.id);
      return { started: true };
    }
    if (message.mode === 'visible') await processVisible(tab);
    else await processFullPage(tab);
    await releaseJob(tabId, job.id);
    return { started: true };
  } catch (error) {
    if (tabId !== undefined && job) await releaseJob(tabId, job.id);
    const errorMessage = friendlyError(error);
    await chrome.storage.session.set({
      lastCaptureDiagnostics: {
        captureType: message.mode,
        failed: true,
        error: errorMessage,
        completedAt: Date.now(),
      },
    });
    if (tabId !== undefined) await showFeedback(tabId, { kind: 'error', message: errorMessage }).catch(() => undefined);
    throw error;
  }
}

async function handlePopupRequest(message: PopupRequest): Promise<unknown> {
  if (message.type === 'CAPTURE_REQUEST') {
    void orchestrate(message).catch(() => undefined);
    return { started: true };
  }
  if (message.type === 'LIST_RECENTS') return sendOffscreen({ operation: 'list-recents' });
  if (message.type === 'COPY_RECENT') return sendOffscreen({ operation: 'export-recent', id: message.id });
  if (message.type === 'DELETE_RECENT') return sendOffscreen({ operation: 'delete-recent', id: message.id });
  if (message.type === 'CLEAR_RECENTS') return sendOffscreen({ operation: 'clear-recents' });
  if (message.type === 'SAVE_RECENT') {
    const saved = await exportCapture(message.id);
    return saved ? { ok: true } : { ok: false, error: 'Screenboard could not save that PNG.' };
  }
}

chrome.runtime.onMessage.addListener((message: PopupRequest | ContentMessage | OffscreenEnvelope, sender, sendResponse) => {
  if ('target' in message && message.target === 'offscreen') return false;
  if (!('type' in message)) return false;
  if (message.type === 'SELECTION_COMMIT' && sender.tab) {
    void processSelection(sender.tab, message).catch(() => undefined);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'SELECTION_CANCELLED' && sender.tab?.id !== undefined) {
    void cancelSelection(sender.tab.id, message.jobId).catch(() => undefined);
    sendResponse({ ok: true });
    return false;
  }
  if (
    message.type === 'CAPTURE_REQUEST'
    || message.type === 'LIST_RECENTS'
    || message.type === 'COPY_RECENT'
    || message.type === 'SAVE_RECENT'
    || message.type === 'DELETE_RECENT'
    || message.type === 'CLEAR_RECENTS'
  ) {
    const explicitTabId = message.type === 'CAPTURE_REQUEST' ? message.tabId : undefined;
    const senderIsExtension = sender.id === chrome.runtime.id && (!sender.url || sender.url.startsWith(chrome.runtime.getURL('')));
    if (explicitTabId !== undefined && !senderIsExtension) {
      sendResponse({ ok: false, error: 'Capture target rejected.' });
      return false;
    }
    void handlePopupRequest(message).then(sendResponse).catch((error: unknown) => sendResponse({
      ok: false,
      error: friendlyError(error),
    }));
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener((command, tab) => {
  const modes: Partial<Record<string, CaptureType>> = {
    'capture-area': 'area',
    'capture-visible': 'visible',
    'capture-full-page': 'full-page',
    'capture-element': 'element',
  };
  const mode = modes[command];
  if (!mode) return;
  void orchestrate({ type: 'CAPTURE_REQUEST', mode, tabId: tab?.id }).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') void cancelSelection(tabId).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabJobs(tabId).catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.get('settings').then((stored) => {
    if (!stored.settings) return chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    return undefined;
  });
});
