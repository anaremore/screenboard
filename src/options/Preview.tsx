import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Copy, Download, LoaderCircle, Trash2 } from 'lucide-react';
import type { RecentCapture } from '../shared/types';
import { BrandMark } from '../ui/BrandMark';
import { captureImage, captureLabels, captureRequest, copyPng, errorMessage } from '../ui/captures';

export function Preview({ captureId }: { captureId: string }) {
  const [image, setImage] = useState<{ dataUrl: string; filename: string }>();
  const [capture, setCapture] = useState<RecentCapture>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState<'copy' | 'save' | 'delete'>();
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();

  const loadImage = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const [png, history] = await Promise.all([
        captureImage(captureId),
        captureRequest({ type: 'LIST_RECENTS' }).catch(() => undefined),
      ]);
      setImage(png);
      setCapture(history && 'captures' in history ? history.captures.find((item) => item.id === captureId) : undefined);
      document.title = `${png.filename} — Screenboard`;
    } catch (error) {
      setLoadError(errorMessage(error, 'This capture could not be opened. It may have been removed from history.'));
    } finally {
      setLoading(false);
    }
  }, [captureId]);

  useEffect(() => { void loadImage(); }, [loadImage]);

  const back = async () => {
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
      else window.location.assign(chrome.runtime.getURL('options.html'));
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'This preview could not be closed. You can close this tab to return.') });
    }
  };

  const act = async (action: 'copy' | 'save' | 'delete') => {
    if (!image || busy) return;
    if (action === 'delete' && !window.confirm('Delete this capture from Screenboard history?')) return;
    setBusy(action);
    setNotice(undefined);
    try {
      if (action === 'copy') await copyPng(image.dataUrl);
      else await captureRequest({ type: action === 'save' ? 'SAVE_RECENT' : 'DELETE_RECENT', id: captureId });
      if (action === 'delete') {
        setDeleted(true);
        setImage(undefined);
      }
      setNotice({ kind: 'success', text: action === 'copy' ? 'Copied to clipboard.' : action === 'save' ? 'PNG saved.' : 'Capture deleted.' });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, action === 'copy' ? 'Copying failed. Try saving the PNG instead.' : 'The action could not be completed. Please try again.') });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <main className="preview-page">
      <header className="preview-header">
        <button className="preview-back" type="button" onClick={() => void back()}><ArrowLeft size={17} aria-hidden="true" /> Back</button>
        <div className="options-brand"><span><BrandMark size={28} /></span><strong>Screenboard</strong></div>
        <a href={chrome.runtime.getURL('options.html')}>Settings</a>
      </header>
      <section className="preview-details" aria-labelledby="preview-heading">
        <div><h1 id="preview-heading">{capture ? `${captureLabels[capture.type]} capture` : 'Capture preview'}</h1><p>{image?.filename}{capture && <> · {capture.width} × {capture.height} · {new Date(capture.createdAt).toLocaleString()}</>}</p></div>
        {image && !deleted && <div className="preview-actions" aria-label="Capture actions" aria-busy={!!busy}>
          <button className="preview-primary" type="button" disabled={!!busy} onClick={() => void act('copy')}>{busy === 'copy' ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />} Copy PNG</button>
          <button type="button" disabled={!!busy} onClick={() => void act('save')}>{busy === 'save' ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Download size={17} aria-hidden="true" />} Save</button>
          <button className="preview-delete" type="button" disabled={!!busy} onClick={() => void act('delete')}>{busy === 'delete' ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Trash2 size={17} aria-hidden="true" />} Delete</button>
        </div>}
      </section>
      {notice && <div className={`page-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      {capture?.temporary && !deleted && <p className="preview-recovery">This capture is available only for this browser session. Copy or save it before closing Chrome; older captures may also be removed when history fills up.</p>}
      {capture?.recovery && !capture.temporary && !deleted && <p className="preview-recovery">Recovery copy from an earlier unsuccessful capture delivery. It is kept within your history limits so you can copy or save it.</p>}
      {loading ? <p className="page-state" role="status">Loading capture…</p> : loadError ? <div className="page-notice error" role="alert"><p>{loadError}</p><button type="button" onClick={() => void loadImage()}>Try again</button></div> : image && <figure className="preview-image"><img src={image.dataUrl} alt={capture ? `${captureLabels[capture.type]} screenshot, ${capture.width} by ${capture.height} pixels` : 'Your captured screenshot'} onError={() => setLoadError('The PNG could not be displayed. Try loading it again.')} /></figure>}
      {deleted && <p className="page-state">This capture has been removed from history. Use Back to return.</p>}
    </main>
  );
}
