import { useEffect, useState } from 'react';
import { Check, ExternalLink, ShieldCheck, Trash2 } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../shared/constants';
import type { CaptureSettings } from '../shared/types';
import { normalizeSettings } from '../shared/settings';
import { BrandMark } from '../ui/BrandMark';

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button className="switch" type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Options() {
  const [settings, setSettings] = useState<CaptureSettings>({ ...DEFAULT_SETTINGS });
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void chrome.storage.local.get('settings').then((stored) => {
      setSettings(normalizeSettings(stored.settings as Partial<CaptureSettings> | undefined));
      setReady(true);
    });
  }, []);

  const update = (patch: Partial<CaptureSettings>) => {
    const next = normalizeSettings({ ...settings, ...patch });
    setSettings(next);
    setSaved(false);
    void chrome.storage.local.set({ settings: next }).then(() => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    });
  };

  const clearHistory = async () => {
    if (!window.confirm('Delete all recent Screenboard captures?')) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_RECENTS' });
  };

  return (
    <main className={`options-page ${ready ? 'ready' : ''}`}>
      <header className="options-header">
        <div className="options-brand"><span><BrandMark size={32} /></span><div><strong>Screenboard</strong><small>Settings</small></div></div>
        <div className={`saved-indicator ${saved ? 'visible' : ''}`} role="status"><Check size={14} aria-hidden="true" /> Saved</div>
      </header>

      <section className="settings-group" aria-labelledby="after-capture-heading">
        <div className="group-heading"><h1 id="after-capture-heading">After capture</h1><p>Every screenshot is copied and confirmed automatically.</p></div>
        <div className="setting-row"><div><strong>Clipboard</strong><p>The newest screenshot is always ready to paste.</p></div><span className="static-value">Always</span></div>
        <div className="setting-row"><div><strong>Save automatically</strong><p>Download a PNG in addition to copying it.</p></div><Toggle label="Save automatically" checked={settings.saveAutomatically} onChange={(value) => update({ saveAutomatically: value })} /></div>
      </section>

      <section className="settings-group" aria-labelledby="image-heading">
        <div className="group-heading"><h2 id="image-heading">Image</h2></div>
        <div className="setting-row"><div><strong>Format</strong><p>Lossless and clipboard-friendly.</p></div><span className="static-value">PNG</span></div>
      </section>

      <section className="settings-group" aria-labelledby="history-heading">
        <div className="group-heading"><h2 id="history-heading">History</h2><p>Recent captures stay only on this device.</p></div>
        <div className="setting-row"><div><strong>Keep recent captures</strong><p>Maintain quick access in the popup.</p></div><Toggle label="Keep recent captures" checked={settings.keepRecent} onChange={(value) => update({ keepRecent: value })} /></div>
        <div className="setting-row"><label htmlFor="maximum-recent"><strong>Maximum recent captures</strong><p>Older items are cleaned up automatically.</p></label><select id="maximum-recent" value={settings.maxRecent} disabled={!settings.keepRecent} onChange={(event) => update({ maxRecent: Number(event.target.value) })}>{[5, 10, 15, 25].map((value) => <option value={value} key={value}>{value}</option>)}</select></div>
        <div className="setting-row danger-row"><div><strong>Clear capture history</strong><p>Delete all locally stored screenshots.</p></div><button className="danger-button" type="button" onClick={() => void clearHistory()}><Trash2 size={15} aria-hidden="true" /> Clear</button></div>
      </section>

      <section className="settings-group" aria-labelledby="shortcuts-heading">
        <div className="group-heading"><h2 id="shortcuts-heading">Keyboard shortcuts</h2></div>
        <div className="shortcut-row"><span>Capture area</span><kbd>{navigator.platform.includes('Mac') ? '⌘ ⇧ 5' : 'Ctrl + Shift + 5'}</kbd></div>
        <div className="shortcut-row"><span>Capture visible area</span><kbd>{navigator.platform.includes('Mac') ? '⌘ ⇧ 6' : 'Ctrl + Shift + 6'}</kbd></div>
        <button className="link-button" type="button" onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>Customize in Chrome <ExternalLink size={14} aria-hidden="true" /></button>
      </section>

      <aside className="privacy-note"><ShieldCheck size={20} aria-hidden="true" /><div><strong>Private by design</strong><p>Screenshots, page details, and capture history never leave your browser.</p></div></aside>
      <footer>Screenboard {chrome.runtime.getManifest().version}</footer>
    </main>
  );
}
