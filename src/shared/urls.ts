const PROTECTED_PROTOCOLS = new Set([
  'chrome:',
  'chrome-extension:',
  'devtools:',
  'edge:',
]);

const CHROME_WEB_STORE_HOSTS = new Set([
  'chrome.google.com',
  'chromewebstore.google.com',
]);

export function isKnownProtectedPage(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    if (PROTECTED_PROTOCOLS.has(url.protocol)) return true;
    return CHROME_WEB_STORE_HOSTS.has(url.hostname)
      && (url.hostname === 'chromewebstore.google.com' || url.pathname.startsWith('/webstore'));
  } catch {
    return false;
  }
}
