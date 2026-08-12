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
import type { OffscreenResponse, PopupRequest } from '../shared/messages';
import type { CaptureType, RecentCapture } from '../shared/types';
import { BrandMark } from '../ui/BrandMark';

const labels: Record<CaptureType, string> = {
  area: 'Area',
  visible: 'Visible',
  'full-page': 'Full page',
  element: 'Element',
};

async function send<T = unknown>(message: PopupRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

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
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();

  const loadRecents = useCallback(async () => {
    setLoading(true);
    const response = await send<OffscreenResponse>({ type: 'LIST_RECENTS' });
    if (response.ok && 'captures' in response) setRecents(response.captures);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);

  const startCapture = async (mode: CaptureType) => {
    const response = await send<{ started?: boolean; ok?: boolean; error?: string }>({ type: 'CAPTURE_REQUEST', mode });
    if (response.started) window.close();
    else setNotice({ kind: 'error', text: response.error ?? 'Capture could not start.' });
  };

  const recentAction = async (type: 'COPY_RECENT' | 'SAVE_RECENT' | 'DELETE_RECENT', id: string) => {
    setBusyId(id);
    const response = await send<OffscreenResponse>({ type, id });
    if (response.ok) {
      if (type === 'COPY_RECENT') {
        try {
          if (!('dataUrl' in response)) throw new Error('The PNG is unavailable.');
          const image = await fetch(response.dataUrl).then((result) => result.blob());
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
        } catch (error) {
          setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Clipboard access was blocked.' });
          setBusyId(undefined);
          return;
        }
      }
      if (type === 'DELETE_RECENT') setRecents((items) => items.filter((item) => item.id !== id));
      else setNotice({ kind: 'success', text: type === 'COPY_RECENT' ? 'Copied again' : 'PNG saved' });
    } else {
      setNotice({ kind: 'error', text: response.error });
    }
    setBusyId(undefined);
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="brand">
          <span className="brand-mark"><BrandMark /></span>
          <span>Screenboard</span>
        </div>
        <button className="icon-button" type="button" aria-label="Open settings" title="Settings" onClick={() => void chrome.runtime.openOptionsPage()}>
          <Settings size={18} aria-hidden="true" />
        </button>
      </header>

      <section className="capture-actions" aria-label="Capture options">
        <button className="primary-capture" type="button" onClick={() => void startCapture('area')}>
          <ScanLine size={20} aria-hidden="true" />
          <span>Capture area</span>
          <kbd>{navigator.platform.includes('Mac') ? '⌘⇧5' : 'Ctrl ⇧ 5'}</kbd>
        </button>
        <div className="secondary-captures">
          <button type="button" onClick={() => void startCapture('visible')}>
            <Camera size={18} aria-hidden="true" />
            <span>Visible</span>
          </button>
          <button type="button" onClick={() => void startCapture('full-page')}>
            <Expand size={18} aria-hidden="true" />
            <span>Full page</span>
          </button>
          <button type="button" onClick={() => void startCapture('element')}>
            <Frame size={18} aria-hidden="true" />
            <span>Element</span>
          </button>
        </div>
      </section>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          {notice.kind === 'success' ? <Check size={15} aria-hidden="true" /> : null}
          <span>{notice.text}</span>
        </div>
      )}

      <section className="recent-section" aria-labelledby="recent-heading">
        <div className="section-heading">
          <h2 id="recent-heading">Recent</h2>
          {recents.length > 0 && <span>{recents.length}</span>}
        </div>
        {loading ? (
          <div className="recent-loading" aria-label="Loading recent captures">
            {[0, 1].map((item) => <div className="recent-skeleton" key={item} />)}
          </div>
        ) : recents.length === 0 ? (
          <div className="empty-recent">
            <Copy size={20} aria-hidden="true" />
            <p>Captures you take will appear here.</p>
          </div>
        ) : (
          <div className="recent-list">
            {recents.slice(0, 5).map((capture) => (
              <article className="recent-item" key={capture.id}>
                <button className="recent-copy" type="button" onClick={() => void recentAction('COPY_RECENT', capture.id)} aria-label={`Copy ${labels[capture.type]} capture from ${relativeTime(capture.createdAt)}`}>
                  <span className="thumbnail"><img src={capture.thumbnailDataUrl} alt="" /></span>
                  <span className="recent-copy-text">
                    <strong>{labels[capture.type]}</strong>
                    <small>{capture.width} × {capture.height} · {relativeTime(capture.createdAt)}</small>
                  </span>
                  {busyId === capture.id ? <LoaderCircle className="spin" size={16} aria-label="Working" /> : <Copy size={16} aria-hidden="true" />}
                </button>
                <div className="recent-tools">
                  <button type="button" aria-label={`Save ${capture.filename}`} title="Save PNG" onClick={() => void recentAction('SAVE_RECENT', capture.id)}>
                    <Download size={15} aria-hidden="true" />
                  </button>
                  <button className="danger-tool" type="button" aria-label={`Delete ${capture.filename}`} title="Delete" onClick={() => void recentAction('DELETE_RECENT', capture.id)}>
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
