# Screenboard

Screenshots, straight to your clipboard.

Screenboard is a local-first Chrome extension for capturing an area, the visible viewport, a full page, or a DOM element. A successful capture is already a PNG on the clipboard, ready to paste. There is no account, server, upload step, editor, or analytics dependency.

## Features

- Clipboard-first area capture with drag-in-any-direction selection and live dimensions
- One-click visible-area capture
- Full-page scroll and stitch with partial-slice handling and scroll restoration
- Element picker with parent/child keyboard traversal
- Automatic PNG clipboard writes and optional automatic downloads
- Local recent-capture history with copy, save, and delete actions
- Compact settings, light/dark themes, keyboard focus states, and reduced-motion support
- Friendly handling for protected pages, lost tabs, clipboard failures, and oversized pages

## Install for development

Requirements: Node.js 20+ and Chrome 116+.

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist` directory.

For continuous development builds:

```bash
npm run dev
```

Reload Screenboard from `chrome://extensions` after a rebuild.

## Commands

```bash
npm run build       # deterministic production extension in dist/
npm run typecheck   # strict TypeScript
npm run lint        # ESLint
npm test            # unit tests
npm run test:e2e    # real unpacked-extension tests in Chrome
npm run check       # typecheck, lint, unit tests, and production build
```

The E2E suite uses Puppeteer and an installed Chrome-for-Testing build. Set `CHROME_PATH` if it is not in Puppeteer's normal cache. Set `SCREENBOARD_HEADFUL=1` when clipboard integration or UI screenshots need a visible browser. The suite generates a test-only extension copy with `<all_urls>` because a directly opened popup tab cannot receive Chrome's normal toolbar `activeTab` gesture; the production manifest remains unchanged.

## Keyboard shortcuts

| Action | Windows/Linux | macOS |
| --- | --- | --- |
| Capture area | `Ctrl+Shift+5` | `Command+Shift+5` |
| Capture visible area | `Ctrl+Shift+6` | `Command+Shift+6` |

Full-page and element commands are included but unbound by default. Chrome can reject a default that conflicts with the OS or another extension. Review or change every shortcut at `chrome://extensions/shortcuts`.

## Architecture

- **MV3 service worker** — coordinates Chrome APIs, capture jobs, error recovery, downloads, and session diagnostics.
- **On-demand content scripts** — render isolated Shadow DOM selectors, measure page geometry, coordinate scrolling, remove all Screenboard UI before capture, and perform the final focused-page clipboard handoff.
- **Offscreen document** — decodes screenshots, crops and stitches canvases, creates PNG blobs and thumbnails, and stores recent captures in IndexedDB.
- **Shared core** — pure geometry, scaling, slice planning, filename, settings, and history-policy modules covered by unit tests.
- **React surfaces** — the small popup and options page use a token-based light/dark design system without a runtime UI framework.

Capture jobs are recorded in `chrome.storage.session`; durable images live as blobs in IndexedDB rather than extension settings. Crop scale comes from actual screenshot dimensions divided by measured CSS viewport dimensions, not from an assumed device pixel ratio.

## Privacy

Screenshot pixels, thumbnails, URLs, and capture metadata are never sent to an external service. Screenboard has no network client, account, telemetry, or remote processing. Captures remain in the browser's local extension storage until the user deletes them or automatic history cleanup removes older items.

The production extension requests only `activeTab`, `scripting`, `storage`, `offscreen`, `clipboardWrite`, and `downloads`. It does not request permanent access to every website.

## Known limitations

- Chrome blocks script injection on `chrome://` pages, the Chrome Web Store, and some other protected surfaces. A visible screenshot may still be retained locally, but automatic clipboard handoff and page-based selection cannot run there.
- Chrome and the operating system impose maximum canvas and clipboard sizes. Screenboard rejects unsafe full-page dimensions and keeps a recoverable recent capture when clipboard writing fails.
- Very dynamic, infinitely scrolling, animated, or virtualized pages can change while a multi-slice capture is in progress. Animations are paused and fixed/sticky elements are hidden after the first slice to reduce seams.
- Full-page capture represents the document's scrollable content width; browser scrollbar chrome is intentionally excluded.
