import { useCallback, useEffect, useState } from 'react';
import type { CaptureType } from '../shared/types';
import { errorMessage } from './captures';

export const captureModes: CaptureType[] = ['area', 'visible', 'full-page', 'element'];

export function useShortcuts() {
  const [shortcuts, setShortcuts] = useState<Partial<Record<CaptureType, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const commands = await chrome.commands.getAll();
      setShortcuts(Object.fromEntries(captureModes.map((mode) => [
        mode,
        commands.find((command) => command.name === `capture-${mode}`)?.shortcut ?? '',
      ])));
    } catch (cause) {
      setError(errorMessage(cause, 'Keyboard shortcuts could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [reload]);

  return { shortcuts, loading, error, reload };
}
