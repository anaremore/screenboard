import { useCallback, useEffect, useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  Download,
  Expand,
  Frame,
  LoaderCircle,
  ScanLine,
  Settings,
  Trash2,
} from 'lucide-react';
import type { CaptureType, RecentCapture } from '../shared/types';
import { BrandMark } from '../ui/BrandMark';
import { captureImage, captureLabels, capturePreviewUrl, captureRequest, copyPng, errorMessage } from '../ui/captures';
import { useShortcuts } from '../ui/useShortcuts';

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function Popup() {
  const [recents, setRecents] = useState<RecentCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [historyError, setHistoryError] = useState<string>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();
  const { shortcuts } = useShortcuts();

  const loadRecents = useCallback(async () => {
    setLoading(true);
    setHistoryError(undefined);
    try {
      const response = await captureRequest({ type: 'LIST_RECENTS' });
      if (!('captures' in response)) throw new Error('Recent captures could not be loaded.');
      setRecents(response.captures);
    } catch (error) {
      setHistoryError(errorMessage(error, 'Recent captures could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);

  const startCapture = async (mode: CaptureType) => {
    if (busyId) return;
    setBusyId(`capture-${mode}`);
    setNotice(undefined);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_REQUEST', mode }) as { started?: boolean; error?: string } | undefined;
      if (!response?.started) throw new Error(response?.error ?? 'Capture could not start. Please try again.');
      window.close();
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'Capture could not start.') });
    } finally {
      setBusyId(undefined);
    }
  };

  const recentAction = async (type: 'COPY_RECENT' | 'SAVE_RECENT' | 'DELETE_RECENT', id: string) => {
    if (busyId) return;
    setBusyId(id);
    setNotice(undefined);
    try {
      if (type === 'COPY_RECENT') {
        const image = await captureImage(id);
        await copyPng(image.dataUrl);
      } else await captureRequest({ type, id });
      if (type === 'DELETE_RECENT') {
        setRecents((items) => items.filter((item) => item.id !== id));
        setNotice({ kind: 'success', text: 'Capture deleted' });
      }
      else setNotice({ kind: 'success', text: type === 'COPY_RECENT' ? 'Copied again' : 'PNG saved' });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'The action could not be completed. Please try again.') });
    } finally {
      setBusyId(undefined);
    }
  };

  const openPreview = async (id: string) => {
    try {
      await chrome.tabs.create({ url: capturePreviewUrl(id) });
      window.close();
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'The preview could not be opened.') });
    }
  };

  const openSettings = async () => {
    try {
      await chrome.runtime.openOptionsPage();
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'Settings could not be opened.') });
    }
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="brand">
          <span className="brand-mark"><BrandMark /></span>
          <span>Screenboard</span>
        </div>
        <button className="icon-button" type="button" aria-label="Open settings" title="Settings" onClick={() => void openSettings()}>
          <Settings size={18} aria-hidden="true" />
        </button>
      </header>

      <section className="capture-actions" aria-label="Capture options">
        <button className="primary-capture" type="button" disabled={!!busyId} onClick={() => void startCapture('area')}>
          {busyId === 'capture-area' ? <LoaderCircle className="spin" size={20} aria-hidden="true" /> : <ScanLine size={20} aria-hidden="true" />}
          <span>Capture area</span>
          {shortcuts.area && <kbd>{shortcuts.area}</kbd>}
        </button>
        <div className="secondary-captures">
          <button type="button" disabled={!!busyId} onClick={() => void startCapture('visible')}>
            <Camera size={18} aria-hidden="true" />
            <span>Visible</span>
          </button>
          <button type="button" disabled={!!busyId} onClick={() => void startCapture('full-page')}>
            <Expand size={18} aria-hidden="true" />
            <span>Full page</span>
          </button>
          <button type="button" disabled={!!busyId} onClick={() => void startCapture('element')}>
            <Frame size={18} aria-hidden="true" />
            <span>Element</span>
          </button>
        </div>
      </section>

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.kind === 'success' ? <Check size={15} aria-hidden="true" /> : null}
          <span>{notice.text}</span>
        </div>
      )}

      <section className="recent-section" aria-labelledby="recent-heading" aria-busy={loading}>
        <div className="section-heading">
          <h2 id="recent-heading">Recent</h2>
          {recents.length > 0 && <span>{recents.length}</span>}
        </div>
        {loading ? (
          <div className="recent-loading" aria-label="Loading recent captures">
            {[0, 1].map((item) => <div className="recent-skeleton" key={item} />)}
          </div>
        ) : historyError ? (
          <div className="history-error" role="alert"><p>{historyError}</p><button type="button" onClick={() => void loadRecents()}>Try again</button></div>
        ) : recents.length === 0 ? (
          <div className="empty-recent">
            <Copy size={20} aria-hidden="true" />
            <p>Captures you take will appear here.</p>
          </div>
        ) : (
          <div className="recent-list">
            {recents.map((capture) => (
              <article className="recent-item" key={capture.id}>
                <button className="recent-preview" type="button" disabled={!!busyId} title="Open preview" aria-label={`Preview ${captureLabels[capture.type]} capture from ${relativeTime(capture.createdAt)}`} onClick={() => void openPreview(capture.id)}>
                  <span className="thumbnail"><img src={capture.thumbnailDataUrl} alt="" loading="lazy" /></span>
                </button>
                <button className="recent-copy" type="button" disabled={!!busyId} onClick={() => void recentAction('COPY_RECENT', capture.id)} aria-label={`Copy ${captureLabels[capture.type]} capture from ${relativeTime(capture.createdAt)}`}>
                  <span className="recent-copy-text">
                    <strong>{captureLabels[capture.type]}</strong>
                    <small>{capture.width} × {capture.height} · {relativeTime(capture.createdAt)}</small>
                    {(capture.recovery || capture.temporary) && <span className="capture-badge">{capture.temporary ? 'Save before closing Chrome' : 'Recovery copy'}</span>}
                  </span>
                  {busyId === capture.id ? <LoaderCircle className="spin" size={16} aria-label="Working" /> : <Copy size={16} aria-hidden="true" />}
                </button>
                <div className="recent-tools">
                  <button type="button" disabled={!!busyId} aria-label={`Save ${capture.filename}`} title="Save PNG" onClick={() => void recentAction('SAVE_RECENT', capture.id)}>
                    <Download size={15} aria-hidden="true" />
                  </button>
                  <button className="danger-tool" type="button" disabled={!!busyId} aria-label={`Delete ${capture.filename}`} title="Delete" onClick={() => void recentAction('DELETE_RECENT', capture.id)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="popup-footer">
        <span className="privacy-dot" aria-hidden="true" />
        Local only. Nothing is uploaded.
      </footer>
    </main>
  );
}
