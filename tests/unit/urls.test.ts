import { describe, expect, it } from 'vitest';
import { isKnownProtectedPage } from '../../src/shared/urls';

describe('isKnownProtectedPage', () => {
  it('identifies browser-owned and extension pages', () => {
    expect(isKnownProtectedPage('chrome://extensions/')).toBe(true);
    expect(isKnownProtectedPage('edge://settings/')).toBe(true);
    expect(isKnownProtectedPage('devtools://devtools/bundled/')).toBe(true);
    expect(isKnownProtectedPage('chrome-extension://example/options.html')).toBe(true);
  });

  it('identifies both Chrome Web Store URL forms', () => {
    expect(isKnownProtectedPage('https://chromewebstore.google.com/detail/example/abc')).toBe(true);
    expect(isKnownProtectedPage('https://chrome.google.com/webstore/detail/example/abc')).toBe(true);
  });

  it('allows normal pages and unknown URLs to use Chrome permission checks', () => {
    expect(isKnownProtectedPage('https://example.com/chrome-extension/')).toBe(false);
    expect(isKnownProtectedPage('file:///C:/capture-me.html')).toBe(false);
    expect(isKnownProtectedPage(undefined)).toBe(false);
    expect(isKnownProtectedPage('not a URL')).toBe(false);
  });
});
