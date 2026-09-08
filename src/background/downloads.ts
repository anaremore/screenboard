export async function savePng(url: string, filename: string): Promise<void> {
  const id = await chrome.downloads.download({ url, filename, saveAs: false });
  await waitForDownload(id);
}

export function waitForDownload(id: number, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.downloads.onErased.removeListener(onErased);
      if (error) reject(error);
      else resolve();
    };
    const checkState = (state?: string) => {
      if (state === 'complete') finish();
      if (state === 'interrupted') finish(new Error('The PNG download was interrupted. Try saving it again from Recent.'));
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id === id) checkState(delta.state?.current);
    };
    const onErased = (erasedId: number) => {
      if (erasedId === id) finish(new Error('The PNG download was removed before completion.'));
    };
    const timeout = setTimeout(() => finish(new Error('The PNG download has not finished. Check Chrome Downloads or retry from Recent.')), timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.onErased.addListener(onErased);
    // A small PNG may finish before its ID is returned and the listener is added.
    void chrome.downloads.search({ id }).then(([download]) => {
      if (!download) finish(new Error('The PNG download is no longer available.'));
      else checkState(download.state);
    }).catch((error: unknown) => finish(error instanceof Error ? error : new Error('Could not check the PNG download.')));
  });
}
