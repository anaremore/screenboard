import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

// Native X11 input reaches Chrome's commands API and its real activeTab grant.
// CDP page events or action.openPopup() do not substitute for this user gesture.
// https://developer.chrome.com/docs/extensions/develop/concepts/activeTab#invoking-activetab
assert.equal(process.platform, 'linux', 'Run this permission smoke on Linux with xvfb-run and xdotool');
assert.ok(process.env.DISPLAY, 'An X11 display is required (use xvfb-run -a pnpm test:permissions)');
assert.ok(process.env.CHROME_PATH, 'Set CHROME_PATH to the pinned Chrome-for-Testing executable');
execFileSync('xdotool', ['version'], { stdio: 'ignore' });

const extensionDirectory = resolve('dist');
const sourceManifest = await readFile(resolve('public/manifest.json'), 'utf8');
const builtManifest = await readFile(join(extensionDirectory, 'manifest.json'), 'utf8');
assert.equal(builtManifest, sourceManifest, 'Permission smoke must use the unchanged production manifest');
const manifest = JSON.parse(builtManifest);
assert.deepEqual(manifest.host_permissions ?? [], []);
assert.deepEqual(manifest.optional_host_permissions ?? [], []);
assert.ok(!manifest.permissions.includes('tabs'), 'The permission smoke may not add the tabs permission');

const title = `Screenboard permission smoke ${process.pid}`;
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<title>${title}</title><body style="background:#e4f3ff;font:28px sans-serif"><h1>Production permission smoke</h1><p>Capture this local page through Chrome's keyboard command.</p></body>`);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const fixtureUrl = `http://127.0.0.1:${address.port}/fixture`;
const otherOrigin = `http://localhost:${address.port}/fixture`;
const profileDirectory = await mkdtemp(join(tmpdir(), 'screenboard-permissions-'));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: false,
    userDataDir: profileDirectory,
    defaultViewport: { width: 1000, height: 700 },
    args: [
      // Ubuntu 24 AppArmor can block CfT user namespaces. CI opens only repository
      // fixtures in disposable profiles; normal local runs retain Chrome's sandbox.
      // https://pptr.dev/troubleshooting#issues-with-apparmor-on-ubuntu
      ...(process.env.CI === 'true' && process.platform === 'linux' ? ['--no-sandbox'] : []),
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      '--no-first-run', '--no-default-browser-check', '--disable-component-update',
      '--ozone-platform=x11', '--window-size=1100,850',
    ],
  });
  const workerTarget = await browser.waitForTarget((target) => target.type() === 'service_worker'
    && target.url().startsWith('chrome-extension://'), { timeout: 15_000 });
  const worker = await workerTarget.worker();
  assert.ok(worker, 'The production service worker must start');
  const page = await browser.newPage();
  await page.goto(fixtureUrl, { waitUntil: 'load' });
  await page.bringToFront();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
  assert.ok(tabId);
  const inject = () => worker.evaluate(async (id) => {
    try {
      const result = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.title });
      return { ok: true, title: result[0]?.result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }, tabId);
  assert.equal((await inject()).ok, false, 'Injection must be denied before invoking Screenboard');
  const command = await worker.evaluate(async () => (await chrome.commands.getAll()).find((entry) => entry.name === 'capture-visible'));
  assert.equal(command?.shortcut, 'Ctrl+Shift+6', 'The production shortcut must be registered without modification');

  // Focus this unique test window, then deliver native keys with XTest (not DOM/CDP events).
  const windowIds = execFileSync('xdotool', ['search', '--onlyvisible', '--name', title], { encoding: 'utf8' }).trim().split(/\s+/);
  assert.ok(windowIds[0]);
  execFileSync('xdotool', ['windowfocus', '--sync', windowIds[0]]);
  const startedAt = Date.now();
  execFileSync('xdotool', ['key', '--clearmodifiers', 'ctrl+shift+6']);
  await page.waitForFunction(() => document.getElementById('screenboard-toast-root')?.getAttribute('aria-label')
    === 'Screenshot complete — copied to clipboard', { timeout: 20_000, polling: 100 });
  const diagnostics = await worker.evaluate(async () => (await chrome.storage.session.get('lastCaptureDiagnostics')).lastCaptureDiagnostics);
  assert.equal(diagnostics.captureType, 'visible');
  assert.ok(diagnostics.completedAt >= startedAt);
  assert.equal(diagnostics.failed, undefined, diagnostics.error);
  assert.equal(diagnostics.clipboardOk, true, diagnostics.clipboardError);
  assert.ok(diagnostics.width > 0 && diagnostics.height > 0);
  assert.deepEqual(await inject(), { ok: true, title });

  await page.goto(otherOrigin, { waitUntil: 'load' });
  assert.equal((await inject()).ok, false, 'Cross-origin navigation must revoke the temporary grant');
  console.log('Production permission smoke passed: denied before gesture, actual shortcut capture and clipboard succeeded, grant revoked on navigation.');
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
  // mkdtemp created this exact directory; never remove an arbitrary caller-supplied path.
  assert.equal(profileDirectory.startsWith(join(tmpdir(), 'screenboard-permissions-')), true);
  await rm(profileDirectory, { recursive: true, force: true });
}
