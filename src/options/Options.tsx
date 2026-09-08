import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../shared/constants';
import type { CaptureSettings } from '../shared/types';
import { normalizeSettings } from '../shared/settings';
import { BrandMark } from '../ui/BrandMark';
import { captureLabels, captureRequest, errorMessage } from '../ui/captures';
import { captureModes, useShortcuts } from '../ui/useShortcuts';

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button className="switch" type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Options() {
  const [settings, setSettings] = useState<CaptureSettings>({ ...DEFAULT_SETTINGS });
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();
  const shortcuts = useShortcuts();

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const stored = await chrome.storage.local.get('settings');
      setSettings(normalizeSettings(stored.settings as Partial<CaptureSettings> | undefined));
      setReady(true);
    } catch (error) {
      setLoadError(errorMessage(error, 'Settings could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => {
    if (!saved) return;
    const timeout = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  const update = async (patch: Partial<CaptureSettings>) => {
    if (saving || clearing) return;
    const previous = settings;
    const next = normalizeSettings({ ...settings, ...patch });
    setSettings(next);
    setSaving(true);
    setSaved(false);
    setNotice(undefined);
    try {
      await chrome.storage.local.set({ settings: next });
      setSaved(true);
    } catch (error) {
      setSettings(previous);
      setNotice({ kind: 'error', text: `${errorMessage(error, 'Settings could not be saved.')} Your previous settings are still in use. Please try again.` });
    } finally {
      setSaving(false);
    }
  };

  const clearHistory = async () => {
    if (clearing || saving || !window.confirm('Delete all recent Screenboard captures?')) return;
    setClearing(true);
    setNotice(undefined);
    try {
      await captureRequest({ type: 'CLEAR_RECENTS' });
      setNotice({ kind: 'success', text: 'Capture history cleared.' });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'Capture history could not be cleared. Please try again.') });
    } finally {
      setClearing(false);
    }
  };

  const customizeShortcuts = async () => {
    try {
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'Chrome shortcuts could not be opened.') });
    }
  };

  const busy = saving || clearing;

  return (
    <main className={`options-page ${ready ? 'ready' : ''}`}>
      <header className="options-header">
        <div className="options-brand"><span><BrandMark size={32} /></span><div><strong>Screenboard</strong><small>Settings</small></div></div>
        <div className={`saved-indicator ${saving || saved ? 'visible' : ''}`} role="status">
          {saving ? <><LoaderCircle className="spin" size={14} aria-hidden="true" /> Saving…</> : saved ? <><Check size={14} aria-hidden="true" /> Saved</> : null}
        </div>
      </header>

      {loading && <p className="page-state" role="status">Loading settings…</p>}
      {loadError && <div className="page-notice error" role="alert"><p>{loadError}</p><button type="button" onClick={() => void loadSettings()}>Try again</button></div>}
      {notice && <div className={`page-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}

      {ready && <>
        <section className="settings-group" aria-labelledby="after-capture-heading" aria-busy={saving}>
          <div className="group-heading"><h1 id="after-capture-heading">After capture</h1><p>Every screenshot is copied and confirmed automatically.</p></div>
          <div className="setting-row"><div><strong>Clipboard</strong><p>The newest screenshot is ready to paste after confirmation.</p></div><span className="static-value">Always</span></div>
          <div className="setting-row"><div><strong>Save automatically</strong><p>Download a PNG in addition to copying it.</p></div><Toggle label="Save automatically" checked={settings.saveAutomatically} disabled={busy} onChange={(value) => void update({ saveAutomatically: value })} /></div>
        </section>

        <section className="settings-group" aria-labelledby="image-heading">
          <div className="group-heading"><h2 id="image-heading">Image</h2></div>
          <div className="setting-row"><div><strong>Format</strong><p>Lossless and clipboard-friendly.</p></div><span className="static-value">PNG</span></div>
        </section>

        <section className="settings-group" aria-labelledby="history-heading" aria-busy={busy}>
          <div className="group-heading"><h2 id="history-heading">History</h2><p>Recent captures stay only on this device.</p></div>
          <div className="setting-row"><div><strong>Keep recent captures</strong><p>Maintain quick access in the popup.</p></div><Toggle label="Keep recent captures" checked={settings.keepRecent} disabled={busy} onChange={(value) => void update({ keepRecent: value })} /></div>
          <div className="setting-help">When off, newly copied or saved captures are removed from history. Existing history stays until you clear it. If copying and saving both fail, a recovery copy is kept within your history limits.</div>
          <div className="setting-row"><label htmlFor="maximum-recent"><strong>Maximum recent captures</strong><p>Older items are cleaned up automatically.</p></label><select id="maximum-recent" value={settings.maxRecent} disabled={busy} onChange={(event) => void update({ maxRecent: Number(event.target.value) })}>{[5, 10, 15, 25].map((value) => <option value={value} key={value}>{value}</option>)}</select></div>
          <div className="setting-row danger-row"><div><strong>Clear capture history</strong><p>Delete all locally stored screenshots.</p></div><button className="danger-button" type="button" disabled={busy} onClick={() => void clearHistory()}>{clearing ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />} {clearing ? 'Clearing…' : 'Clear'}</button></div>
        </section>

        <section className="settings-group" aria-labelledby="shortcuts-heading" aria-busy={shortcuts.loading}>
          <div className="group-heading"><h2 id="shortcuts-heading">Keyboard shortcuts</h2><p>Current assignments in Chrome.</p></div>
          {shortcuts.error ? <div className="shortcut-error" role="alert"><p>{shortcuts.error}</p><button type="button" onClick={() => void shortcuts.reload()}>Try again</button></div> : captureModes.map((mode) => (
            <div className="shortcut-row" key={mode}><span>Capture {mode === 'visible' ? 'visible area' : captureLabels[mode].toLowerCase()}</span>{shortcuts.loading ? <span>Loading…</span> : shortcuts.shortcuts[mode] ? <kbd>{shortcuts.shortcuts[mode]}</kbd> : <span className="unassigned-shortcut">Not assigned</span>}</div>
          ))}
          <button className="link-button" type="button" onClick={() => void customizeShortcuts()}>Customize in Chrome <ExternalLink size={14} aria-hidden="true" /></button>
        </section>
      </>}

      <aside className="privacy-note"><ShieldCheck size={20} aria-hidden="true" /><div><strong>Private by design</strong><p>Screenboard does not upload screenshots, page details, or capture history.</p></div></aside>
      <footer>Screenboard {chrome.runtime.getManifest().version}</footer>
    </main>
  );
}
