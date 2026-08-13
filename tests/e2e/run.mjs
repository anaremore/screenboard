import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

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
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-component-update',
      '--window-size=1100,850',
    ],
  });

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
  await fixturePage.setViewport({ width: 900, height: 640, deviceScaleFactor: 1.25 });
  await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  const popupPage = await browser.newPage();
  await popupPage.setViewport({ width: 366, height: 486, deviceScaleFactor: 1 });
  await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded' });
  await popupPage.waitForSelector('.popup-shell');
  const activeWorkerTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().startsWith(`chrome-extension://${extensionId}/`),
    { timeout: 15_000 },
  );
  const emptyPopupHeight = await popupPage.$eval('.popup-shell', (element) => Math.ceil(element.getBoundingClientRect().height));
  await popupPage.setViewport({ width: 366, height: emptyPopupHeight, deviceScaleFactor: 1 });
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

  await clearRecents();
  const visibleStartedAt = Date.now();
  assert.equal((await startCapture('visible')).started, true);
  const visible = await waitForCapture('visible', visibleStartedAt);
  assert.notEqual(visible.failed, true, visible.error);
  assert.equal(visible.clipboardAttempted, true);
  assert.equal(visible.clipboardOk, true, `Offscreen image clipboard write failed: ${visible.clipboardError ?? 'unknown error'}`);
  await waitForCopiedFeedback();
  await fixturePage.screenshot({ path: resolve(resultsDirectory, 'capture-complete.png') });
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
  await popupPage.setViewport({ width: 366, height: recentPopupHeight, deviceScaleFactor: 1 });
  await popupPage.screenshot({ path: resolve(resultsDirectory, 'popup-recent.png'), fullPage: true });
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
  const fullPageStartedAt = Date.now();
  assert.equal((await begin('full-page')).started, true);
  const fullPage = await wait('full-page', fullPageStartedAt);
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

  console.log(`E2E passed: extension ${extensionId}, visible ${visible.width}×${visible.height}, full page ${fullPage.width}×${fullPage.height}, ${fullPage.sliceCount} slices.`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
