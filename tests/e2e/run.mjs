import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { verifyFullPageScrolling } from './full-page-scroll.mjs';
import { verifyContentScriptInjection } from './content-injection.mjs';

const root = resolve('.');
const nodeExecutable = process.execPath;
async function findChromeExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cacheRoot = resolve(homedir(), '.cache', 'puppeteer', 'chrome');
  try {
    const versions = (await readdir(cacheRoot)).sort().reverse();
    for (const version of versions) {
      const candidate = resolve(cacheRoot, version, process.platform === 'win32' ? 'chrome-win64/chrome.exe' : 'chrome-linux64/chrome');
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Try the next installed Chrome-for-Testing version.
      }
    }
  } catch {
    // Fall through to the system browser candidates.
  }
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return '/usr/bin/google-chrome';
}

const chromeExecutable = await findChromeExecutable();
const extensionDirectory = resolve('.e2e-extension');
const profileDirectory = resolve('.e2e-profile');
const resultsDirectory = resolve('test-results');

function safeGeneratedPath(path, expectedName) {
  assert.equal(resolve(path), path);
  assert.equal(path.split(/[\\/]/).at(-1), expectedName);
  assert.ok(path.startsWith(root), `Refusing to remove path outside workspace: ${path}`);
}

safeGeneratedPath(extensionDirectory, '.e2e-extension');
safeGeneratedPath(resultsDirectory, 'test-results');
safeGeneratedPath(profileDirectory, '.e2e-profile');
await rm(extensionDirectory, { recursive: true, force: true });
await rm(profileDirectory, { recursive: true, force: true });
await rm(resultsDirectory, { recursive: true, force: true });
await mkdir(resultsDirectory, { recursive: true });

execFileSync(nodeExecutable, [resolve('scripts/generate-icons.mjs')], { stdio: 'inherit' });
execFileSync(nodeExecutable, [resolve('node_modules/vite/bin/vite.js'), 'build'], { stdio: 'inherit' });
await cp(resolve('dist'), extensionDirectory, { recursive: true });
const manifestPath = resolve(extensionDirectory, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
// A directly opened popup tab does not receive the user-invocation activeTab grant.
// The generated test copy gets broad host access solely so Puppeteer can drive the same capture code.
manifest.host_permissions = ['<all_urls>'];
manifest.permissions = [...manifest.permissions, 'tabs'];
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const fixture = await readFile(resolve('tests/e2e/fixture.html'));
const server = createServer((request, response) => {
  if (request.url === '/' || request.url?.startsWith('/fixture')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(fixture);
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});
await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const fixtureUrl = `http://127.0.0.1:${address.port}/fixture`;

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: chromeExecutable,
    headless: process.env.SCREENBOARD_HEADFUL !== '1',
    userDataDir: profileDirectory,
    defaultViewport: null,
    args: [
      // Ubuntu 24 AppArmor can block CfT user namespaces. CI opens only repository
      // fixtures in disposable profiles; normal local runs retain Chrome's sandbox.
      // https://pptr.dev/troubleshooting#issues-with-apparmor-on-ubuntu
      ...(process.env.CI === 'true' && process.platform === 'linux' ? ['--no-sandbox'] : []),
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-component-update',
      '--window-size=1100,850',
    ],
  });

  await verifyFullPageScrolling(browser);
  console.log('Chrome connected; discovering the unpacked extension.');
  const extensionsPage = await browser.newPage();
  await extensionsPage.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
  await extensionsPage.waitForFunction(() => {
    const manager = document.querySelector('extensions-manager');
    const list = manager?.shadowRoot?.querySelector('extensions-item-list');
    return Boolean(list?.shadowRoot?.querySelector('extensions-item'));
  }, { timeout: 15_000 });
  const installedExtensions = await extensionsPage.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    const list = manager?.shadowRoot?.querySelector('extensions-item-list');
    return [...(list?.shadowRoot?.querySelectorAll('extensions-item') ?? [])].map((item) => ({
      id: item.id,
      name: item.data?.name,
      state: item.data?.state,
      errors: item.data?.manifestErrors?.map((error) => error.message) ?? [],
    }));
  });
  const screenboard = installedExtensions.find((item) => item.name === 'Screenboard');
  assert.ok(screenboard, `Screenboard was not loaded by Chrome. Installed: ${JSON.stringify(installedExtensions)}`);
  assert.deepEqual(screenboard.errors, [], `Manifest errors: ${screenboard.errors.join('; ')}`);
  const extensionId = screenboard.id;
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;

  const fixturePage = await browser.newPage();
  // 1024 × 640 CSS pixels at 1.25 DPR produces Chrome Web Store's preferred 1280 × 800 screenshots.
  await fixturePage.setViewport({ width: 1024, height: 640, deviceScaleFactor: 1.25 });
  await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  const popupPage = await browser.newPage();
  await popupPage.setViewport({ width: 366, height: 486, deviceScaleFactor: 2 });
  await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded' });
  await popupPage.waitForSelector('.popup-shell');
  const activeWorkerTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().startsWith(`chrome-extension://${extensionId}/`),
    { timeout: 15_000 },
  );
  await verifyContentScriptInjection(browser, popupPage, fixtureUrl);
  const emptyPopupHeight = await popupPage.$eval('.popup-shell', (element) => Math.ceil(element.getBoundingClientRect().height));
  await popupPage.setViewport({ width: 366, height: emptyPopupHeight, deviceScaleFactor: 2 });
  const settleTheme = (page) => page.evaluate(() => new Promise((resolvePromise) => {
    requestAnimationFrame(() => requestAnimationFrame(resolvePromise));
  }));

  await popupPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await popupPage.evaluate(() => { document.documentElement.style.colorScheme = 'light'; });
  await settleTheme(popupPage);
  assert.equal(
    await popupPage.$eval('.secondary-captures button', (element) => getComputedStyle(element).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await popupPage.screenshot({ path: resolve(resultsDirectory, 'popup-light.png'), fullPage: true });
  await popupPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await popupPage.evaluate(() => { document.documentElement.style.colorScheme = 'dark'; });
  await settleTheme(popupPage);
  assert.equal(
    await popupPage.$eval('.secondary-captures button', (element) => getComputedStyle(element).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await popupPage.screenshot({ path: resolve(resultsDirectory, 'popup-dark.png'), fullPage: true });
  const optionsPage = await browser.newPage();
  await optionsPage.setViewport({ width: 760, height: 900, deviceScaleFactor: 1 });
  await optionsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded' });
  await optionsPage.waitForSelector('.options-page.ready');
  await optionsPage.screenshot({ path: resolve(resultsDirectory, 'settings.png'), fullPage: true });

  const extensionCall = (page, message) => page.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
  const clearRecents = () => extensionCall(popupPage, { type: 'CLEAR_RECENTS' });
  const recents = async () => {
    const response = await extensionCall(popupPage, { type: 'LIST_RECENTS' });
    assert.equal(response.ok, true, response.error);
    return response.captures;
  };
  const diagnostics = () => popupPage.evaluate(async () => (await chrome.storage.session.get('lastCaptureDiagnostics')).lastCaptureDiagnostics);
  const startCapture = async (mode) => popupPage.evaluate(async ({ captureMode, url }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url?.startsWith(url));
    if (!tab?.id) throw new Error('Fixture tab not found');
    await chrome.tabs.update(tab.id, { active: true });
    return chrome.runtime.sendMessage({ type: 'CAPTURE_REQUEST', mode: captureMode, tabId: tab.id });
  }, { captureMode: mode, url: fixtureUrl });
  const waitForCapture = async (mode, after = 0) => {
    await popupPage.waitForFunction(async (expectedMode, completedAfter) => {
      const value = (await chrome.storage.session.get('lastCaptureDiagnostics')).lastCaptureDiagnostics;
      return value?.captureType === expectedMode && value.completedAt > completedAfter;
    }, { timeout: 20_000, polling: 100 }, mode, after);
    return diagnostics();
  };
  const waitForCopiedFeedback = () => fixturePage.waitForFunction((expectedMessage) => (
    document.getElementById('screenboard-toast-root')?.getAttribute('aria-label') === expectedMessage
  ), { timeout: 10_000, polling: 50 }, 'Screenshot complete — copied to clipboard');

  const toastStyle = async () => {
    const session = await fixturePage.createCDPSession();
    try {
      await session.send('DOM.enable');
      await session.send('CSS.enable');
      const { root: documentNode } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
      const findNode = (node, predicate) => {
        if (predicate(node)) return node;
        for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
          const found = findNode(child, predicate);
          if (found) return found;
        }
      };
      const host = findNode(documentNode, (node) => node.attributes?.includes('screenboard-toast-root'));
      const toast = host && findNode(host, (node) => node.attributes?.includes('toast'));
      assert.ok(toast, 'The completion toast should exist inside the closed shadow root');
      const { computedStyle } = await session.send('CSS.getComputedStyleForNode', { nodeId: toast.nodeId });
      return Object.fromEntries(computedStyle.map(({ name, value }) => [name, value]));
    } finally {
      await session.detach();
    }
  };

  await clearRecents();
  await fixturePage.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const visibleStartedAt = Date.now();
  assert.equal((await startCapture('visible')).started, true);
  const visible = await waitForCapture('visible', visibleStartedAt);
  assert.notEqual(visible.failed, true, visible.error);
  assert.equal(visible.clipboardAttempted, true);
  assert.equal(visible.clipboardOk, true, `Offscreen image clipboard write failed: ${visible.clipboardError ?? 'unknown error'}`);
  await waitForCopiedFeedback();
  const reducedMotionToast = await toastStyle();
  assert.equal(reducedMotionToast.opacity, '1', 'Reduced-motion feedback must be visible without an animation');
  assert.equal(reducedMotionToast['animation-name'], 'none');
  await fixturePage.screenshot({ path: resolve(resultsDirectory, 'capture-complete.png') });
  await fixturePage.emulateMediaFeatures([]);
  const visibleRecents = await recents();
  assert.equal(visibleRecents.length, 1);
  const downloadDirectory = resolve(resultsDirectory, 'downloads');
  await mkdir(downloadDirectory, { recursive: true });
  const downloadSession = await browser.target().createCDPSession();
  await downloadSession.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDirectory,
  });
  const saved = await extensionCall(popupPage, { type: 'SAVE_RECENT', id: visibleRecents[0].id });
  assert.equal(saved.ok, true, saved.error);
  let downloadedPng;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const names = await readdir(downloadDirectory);
    downloadedPng = names.find((name) => name.endsWith('.png') && !name.endsWith('.crdownload'));
    if (downloadedPng && (await stat(resolve(downloadDirectory, downloadedPng))).size > 0) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  assert.ok(downloadedPng, 'Save PNG should produce a downloaded image file');
  await popupPage.bringToFront();
  await popupPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await settleTheme(popupPage);
  await popupPage.reload({ waitUntil: 'domcontentloaded' });
  await popupPage.waitForSelector('.recent-item');
  await popupPage.evaluate(() => { document.documentElement.style.colorScheme = 'light'; });
  const recentPopupHeight = await popupPage.$eval('.popup-shell', (element) => Math.ceil(element.getBoundingClientRect().height));
  await popupPage.setViewport({ width: 366, height: recentPopupHeight, deviceScaleFactor: 2 });
  await popupPage.screenshot({ path: resolve(resultsDirectory, 'popup-recent.png'), fullPage: true });
  await popupPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await popupPage.evaluate(() => { document.documentElement.style.colorScheme = 'dark'; });
  await settleTheme(popupPage);
  await popupPage.screenshot({ path: resolve(resultsDirectory, 'popup-recent-dark.png'), fullPage: true });
  await popupPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await popupPage.evaluate(() => { document.documentElement.style.colorScheme = 'light'; });
  await settleTheme(popupPage);
  await popupPage.click('.recent-copy');
  await popupPage.waitForFunction(() => document.querySelector('.notice.success')?.textContent?.includes('Copied again'));

  const targetSession = await browser.target().createCDPSession();
  await targetSession.send('Target.closeTarget', { targetId: activeWorkerTarget._targetId });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  const resumedPopup = popupPage;
  assert.equal((await extensionCall(resumedPopup, { type: 'LIST_RECENTS' })).captures.length, 1, 'History should survive a service-worker restart');
  await resumedPopup.click('.danger-tool');
  await resumedPopup.waitForSelector('.recent-item', { hidden: true });
  assert.equal((await extensionCall(resumedPopup, { type: 'LIST_RECENTS' })).captures.length, 0, 'Delete should remove the local capture');

  const call = (message) => extensionCall(resumedPopup, message);
  const clear = () => call({ type: 'CLEAR_RECENTS' });
  const latestDiagnostics = () => resumedPopup.evaluate(async () => (await chrome.storage.session.get('lastCaptureDiagnostics')).lastCaptureDiagnostics);
  const begin = async (mode) => resumedPopup.evaluate(async ({ captureMode, url }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url?.startsWith(url));
    await chrome.tabs.update(tab.id, { active: true });
    return chrome.runtime.sendMessage({ type: 'CAPTURE_REQUEST', mode: captureMode, tabId: tab.id });
  }, { captureMode: mode, url: fixtureUrl });
  const wait = async (mode, after) => {
    await resumedPopup.waitForFunction(async (expectedMode, completedAfter) => {
      const value = (await chrome.storage.session.get('lastCaptureDiagnostics')).lastCaptureDiagnostics;
      return value?.captureType === expectedMode && value.completedAt > completedAfter;
    }, { timeout: 25_000, polling: 100 }, mode, after);
    return latestDiagnostics();
  };

  const geometryViewport = await fixturePage.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const baselineStartedAt = Date.now();
  assert.equal((await begin('visible')).started, true);
  const geometryBaseline = await wait('visible', baselineStartedAt);
  await waitForCopiedFeedback();
  await clear();
  const regionStartedAt = Date.now();
  assert.equal((await begin('area')).started, true);
  await fixturePage.waitForSelector('#screenboard-capture-root');
  assert.equal(await fixturePage.$('#screenboard-toast-root'), null, 'Previous feedback must be hidden before selecting');
  await fixturePage.mouse.move(100, 120);
  await fixturePage.mouse.down();
  await fixturePage.mouse.move(420, 340, { steps: 8 });
  await fixturePage.screenshot({ path: resolve(resultsDirectory, 'selection.png') });
  await fixturePage.mouse.up();
  await fixturePage.waitForSelector('#screenboard-capture-root', { hidden: true });
  const region = await wait('area', regionStartedAt);
  const expectedRegionWidth = Math.round(320 * geometryBaseline.width / geometryViewport.width);
  const expectedRegionHeight = Math.round(220 * geometryBaseline.height / geometryViewport.height);
  assert.equal(region.width, expectedRegionWidth);
  assert.equal(region.height, expectedRegionHeight);
  assert.equal(region.clipboardOk, true);
  await waitForCopiedFeedback();

  await clear();
  const beforeCancel = (await latestDiagnostics()).completedAt;
  assert.equal((await begin('area')).started, true);
  await fixturePage.waitForSelector('#screenboard-capture-root');
  await fixturePage.keyboard.press('Escape');
  await fixturePage.waitForSelector('#screenboard-capture-root', { hidden: true });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  assert.equal((await latestDiagnostics()).completedAt, beforeCancel);
  assert.equal((await call({ type: 'LIST_RECENTS' })).captures.length, 0);

  for (const mode of ['area', 'element']) {
    assert.equal((await begin(mode)).started, true);
    await fixturePage.waitForSelector('#screenboard-capture-root');
    await fixturePage.reload({ waitUntil: 'load' });
    assert.equal((await begin(mode)).started, true, `${mode} capture should restart immediately after a reload`);
    await fixturePage.waitForSelector('#screenboard-capture-root', { timeout: 5000 });
    await fixturePage.keyboard.press('Escape');
    await fixturePage.waitForSelector('#screenboard-capture-root', { hidden: true });
    await resumedPopup.waitForFunction(async () => Object.keys((await chrome.storage.session.get('captureJobs')).captureJobs ?? {}).length === 0);
  }

  await clear();
  const elementStartedAt = Date.now();
  assert.equal((await begin('element')).started, true);
  await fixturePage.waitForSelector('#screenboard-capture-root');
  await fixturePage.hover('#known-element');
  await fixturePage.keyboard.press('ArrowUp');
  await fixturePage.keyboard.press('ArrowDown');
  await fixturePage.screenshot({ path: resolve(resultsDirectory, 'element-selection.png') });
  await fixturePage.click('#known-element');
  const element = await wait('element', elementStartedAt);
  assert.equal(element.width, Math.round(240 * geometryBaseline.width / geometryViewport.width));
  assert.equal(element.height, Math.round(130 * geometryBaseline.height / geometryViewport.height));
  assert.equal(element.clipboardOk, true);
  await waitForCopiedFeedback();

  await clear();
  await fixturePage.evaluate(() => window.scrollTo(0, 173));
  const fixedMarker = await fixturePage.evaluate(() => {
    const marker = document.createElement('div');
    marker.id = 'fixed-regression-marker';
    marker.style.cssText = 'position:fixed !important;visibility:visible !important;right:20px;top:10px;width:16px;height:16px;background:rgb(17,200,99);z-index:9999';
    document.body.append(marker);
    const rect = marker.getBoundingClientRect();
    return { x: rect.left, y: rect.top, style: marker.getAttribute('style') };
  });
  const originalSticky = await fixturePage.$eval('#below-fold-sticky', (heading) => {
    const rect = heading.getBoundingClientRect();
    document.documentElement.style.setProperty('scroll-behavior', 'smooth', 'important');
    return {
      x: rect.left,
      y: rect.top + scrollY,
      properties: ['position', 'top', 'right', 'bottom', 'left', 'visibility'].map((name) => [name, heading.style.getPropertyValue(name), heading.style.getPropertyPriority(name)]),
    };
  });
  assert.ok(originalSticky.y > geometryViewport.height, 'The regression heading must start below the first slice');
  const fullPageStartedAt = Date.now();
  assert.equal((await begin('full-page')).started, true);
  const fullPage = await wait('full-page', fullPageStartedAt);
  assert.notEqual(fullPage.failed, true, fullPage.error);
  await fixturePage.waitForFunction(() => !document.querySelector('style[data-screenboard-capture]'));
  const pageMetrics = await fixturePage.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    contentWidth: document.documentElement.scrollWidth,
    pageHeight: document.documentElement.scrollHeight,
    scrollY,
  }));
  assert.equal(pageMetrics.scrollY, 173, 'Original scroll position should be restored');
  assert.equal(
    fullPage.width,
    Math.round(pageMetrics.contentWidth * geometryBaseline.width / geometryViewport.width),
    'Full-page capture should exclude browser scrollbar chrome',
  );
  assert.equal(fullPage.height, Math.round(pageMetrics.pageHeight * geometryBaseline.height / geometryViewport.height));
  assert.equal(fullPage.sliceCount, Math.ceil(pageMetrics.pageHeight / pageMetrics.height));
  assert.equal(fullPage.clipboardOk, true);
  await waitForCopiedFeedback();
  const restoredSticky = await fixturePage.$eval('#below-fold-sticky', (heading) => ({
    visibility: getComputedStyle(heading).visibility,
    properties: ['position', 'top', 'right', 'bottom', 'left', 'visibility'].map((name) => [name, heading.style.getPropertyValue(name), heading.style.getPropertyPriority(name)]),
    scrollBehavior: document.documentElement.style.getPropertyValue('scroll-behavior'),
    scrollPriority: document.documentElement.style.getPropertyPriority('scroll-behavior'),
  }));
  assert.deepEqual(restoredSticky.properties, originalSticky.properties, 'Sticky inline values and priorities should be restored');
  assert.equal(restoredSticky.visibility, 'visible');
  assert.equal(restoredSticky.scrollBehavior, 'smooth');
  assert.equal(restoredSticky.scrollPriority, 'important');
  assert.equal(await fixturePage.$eval('#fixed-regression-marker', (marker) => marker.getAttribute('style')), fixedMarker.style, 'Fixed visibility and its priority should be restored');
  const [fullPageRecent] = await recents();
  const fullPagePng = await call({ type: 'COPY_RECENT', id: fullPageRecent.id });
  assert.equal(fullPagePng.ok, true, fullPagePng.error);
  await writeFile(resolve(resultsDirectory, 'full-page-capture.png'), Buffer.from(fullPagePng.dataUrl.split(',')[1], 'base64'));
  await writeFile(resolve(resultsDirectory, 'full-page-geometry.json'), JSON.stringify({ fullPage, pageMetrics, fixedMarker, originalSticky }, null, 2));
  const scaleX = fullPage.width / pageMetrics.contentWidth;
  const scaleY = fullPage.height / pageMetrics.pageHeight;
  const stickyPixel = await sharp(Buffer.from(fullPagePng.dataUrl.split(',')[1], 'base64'))
    .extract({ left: Math.round((originalSticky.x + 10) * scaleX), top: Math.round((originalSticky.y + 50) * scaleY), width: 1, height: 1 })
    .removeAlpha().raw().toBuffer();
  assert.deepEqual([...stickyPixel], [217, 24, 87], 'The below-fold sticky heading must appear at its document position in the stitched PNG');
  const fixedPixelAt = (documentY) => sharp(Buffer.from(fullPagePng.dataUrl.split(',')[1], 'base64'))
    .extract({ left: Math.round((fixedMarker.x + 5) * scaleX), top: Math.round(documentY * scaleY), width: 1, height: 1 })
    .removeAlpha().raw().toBuffer();
  assert.deepEqual([...(await fixedPixelAt(fixedMarker.y + 5))], [17, 200, 99], 'Fixed content should appear in the first slice');
  assert.notDeepEqual([...(await fixedPixelAt(pageMetrics.height + fixedMarker.y + 5))], [17, 200, 99], 'Fixed content should not repeat in the second slice');
  await fixturePage.evaluate(() => document.getElementById('fixed-regression-marker')?.remove());

  const protectedTabId = await resumedPopup.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.startsWith('chrome://extensions'))?.id;
  });
  assert.ok(protectedTabId, 'The Chrome extensions tab should be available to the test harness');
  const protectedStartedAt = Date.now();
  const protectedStart = await extensionCall(resumedPopup, {
    type: 'CAPTURE_REQUEST',
    mode: 'area',
    tabId: protectedTabId,
  });
  assert.equal(protectedStart.started, true);
  await resumedPopup.waitForFunction(async (completedAfter) => {
    const value = (await chrome.storage.session.get('lastCaptureDiagnostics')).lastCaptureDiagnostics;
    return value?.captureType === 'area' && value.failed === true && value.completedAt > completedAfter;
  }, { timeout: 10_000 }, protectedStartedAt);
  const protectedFailure = await latestDiagnostics();
  assert.equal(protectedFailure.error, "Screenboard can't capture this protected Chrome page.");

  await clear();
  for (let index = 0; index < 6; index += 1) {
    // Chrome permits at most two captureVisibleTab calls per second.
    await new Promise((done) => setTimeout(done, 600));
    const startedAt = Date.now();
    assert.equal((await begin('visible')).started, true);
    const completed = await wait('visible', startedAt);
    assert.notEqual(completed.failed, true, completed.error);
  }
  const retainedCaptures = await recents();
  assert.equal(retainedCaptures.length, 6);
  await resumedPopup.bringToFront();
  await resumedPopup.reload({ waitUntil: 'domcontentloaded' });
  await resumedPopup.waitForFunction(() => document.querySelectorAll('.recent-item').length === 6);
  const historyPopupHeight = await resumedPopup.$eval('.popup-shell', (element) => Math.ceil(element.getBoundingClientRect().height));
  await resumedPopup.setViewport({ width: 366, height: historyPopupHeight, deviceScaleFactor: 2 });
  const oldestReachable = await resumedPopup.$eval('.recent-list', (list) => {
    const last = list.lastElementChild;
    last.scrollIntoView({ block: 'nearest' });
    const bounds = list.getBoundingClientRect();
    const row = last.getBoundingClientRect();
    return { scrollable: list.scrollHeight > list.clientHeight, visible: row.top >= bounds.top && row.bottom <= bounds.bottom + 1 };
  });
  assert.deepEqual(oldestReachable, { scrollable: true, visible: true }, 'Every retained capture must remain reachable in the history list');
  const previewTargetPromise = browser.waitForTarget((target) => target.type() === 'page' && target.url().startsWith(optionsUrl + '?capture='));
  await resumedPopup.click('.recent-item:last-child .recent-preview');
  const previewPage = await (await previewTargetPromise).page();
  assert.ok(previewPage);
  await previewPage.bringToFront();
  await previewPage.waitForFunction(() => {
    const image = document.querySelector('.preview-image img');
    return image?.complete && image.naturalWidth > 0;
  });
  const previewDimensions = await previewPage.$eval('.preview-image img', (image) => [image.naturalWidth, image.naturalHeight]);
  const previewedCapture = retainedCaptures.at(-1);
  assert.deepEqual(previewDimensions, [previewedCapture.width, previewedCapture.height]);
  await previewPage.screenshot({ path: resolve(resultsDirectory, 'capture-preview.png'), fullPage: true });
  await previewPage.click('.preview-primary');
  await previewPage.waitForFunction(() => document.querySelector('.page-notice.success')?.textContent === 'Copied to clipboard.');
  const downloadsBeforePreview = await previewPage.evaluate(async () => (await chrome.downloads.search({})).map((download) => download.id));
  const previewPng = await previewPage.$eval('.preview-image img', (image) => image.src);
  await previewPage.click('::-p-aria(Save)');
  await previewPage.waitForFunction(() => document.querySelector('.page-notice.success')?.textContent === 'PNG saved.');
  const previewDownloads = await previewPage.evaluate(async (previousIds) => (
    await chrome.downloads.search({})
  ).filter((download) => !previousIds.includes(download.id)).map(({ id, state, filename, mime, error }) => ({ id, state, filename, mime, error })), downloadsBeforePreview);
  assert.equal(previewDownloads.length, 1, 'Preview Save should create a new Chrome download');
  const [previewDownload] = previewDownloads;
  assert.equal(previewDownload.state, 'complete', previewDownload.error);
  assert.equal(previewDownload.mime, 'image/png');
  // CDP may reuse download.png for data URLs. Verify the new download's actual
  // destination and bytes instead of counting filenames in the test directory.
  assert.deepEqual(await readFile(previewDownload.filename), Buffer.from(previewPng.split(',')[1], 'base64'));
  previewPage.once('dialog', (dialog) => { void dialog.accept(); });
  await previewPage.click('.preview-delete');
  await previewPage.waitForFunction(() => document.querySelector('.page-notice.success')?.textContent === 'Capture deleted.');
  assert.equal(await previewPage.$('.preview-image img'), null);
  const remaining = await extensionCall(previewPage, { type: 'LIST_RECENTS' });
  assert.equal(remaining.captures.length, 5);
  assert.ok(!remaining.captures.some((capture) => capture.id === previewedCapture.id));
  const previewClosed = new Promise((done) => previewPage.once('close', done));
  await previewPage.click('.preview-back');
  await previewClosed;

  console.log(`E2E passed: extension ${extensionId}, visible ${visible.width}×${visible.height}, full page ${fullPage.width}×${fullPage.height}, ${fullPage.sliceCount} slices.`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
