import assert from 'node:assert/strict';

export async function verifyContentScriptInjection(browser, extensionPage, fixtureUrl) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const url = fixtureUrl + '?content-injection';
  try {
    await page.goto(url, { waitUntil: 'load' });
    const tabId = await extensionPage.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, url);
    assert.ok(tabId);
    const globals = () => extensionPage.evaluate(async (tabId) => (
      await chrome.scripting.executeScript({ target: { tabId }, func: () => Object.getOwnPropertyNames(window) })
    )[0].result, tabId);
    const initialGlobals = await globals();
    const expectedMetrics = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      return {
        width: innerWidth, height: innerHeight,
        pageWidth: Math.max(root.scrollWidth, root.offsetWidth, body.scrollWidth, body.offsetWidth),
        pageHeight: Math.max(root.scrollHeight, root.offsetHeight, body.scrollHeight, body.offsetHeight),
        scrollX, scrollY, devicePixelRatio,
      };
    });
    const send = (message) => extensionPage.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message), { tabId, message });
    for (let iteration = 0; iteration < 3; iteration += 1) {
      for (const file of ['assets/selector.js', 'assets/fullPage.js']) {
        await extensionPage.evaluate(({ tabId, file }) => chrome.scripting.executeScript({ target: { tabId }, files: [file] }), { tabId, file });
      }
      for (let request = 0; request < 3; request += 1) {
        assert.deepEqual(await send({ type: 'GET_PAGE_METRICS' }), expectedMetrics, 'Repeated injection must preserve the metrics listener');
      }
      assert.equal((await send({ type: 'HIDE_SCREENBOARD_UI' })).ok, true);
      assert.equal((await send({ type: 'PREPARE_FULL_PAGE' })).ok, true);
      assert.equal(await page.$$eval('style[data-screenboard-capture]', (styles) => styles.length), 1, 'Reinjection must not register duplicate capture listeners');
      assert.equal((await send({ type: 'RESTORE_FULL_PAGE' })).ok, true);
      assert.equal(await page.$$eval('style[data-screenboard-capture]', (styles) => styles.length), 0);
    }
    const addedGlobals = (await globals()).filter((name) => !initialGlobals.includes(name)).sort();
    assert.deepEqual(addedGlobals, ['__screenboardFullPageLoaded', '__screenboardSelectorLoaded'], 'Content bundles must not leak module bindings into their shared isolated world');
    assert.deepEqual(errors, [], 'Injected bundles must not throw syntax or runtime errors');
    console.log('Content-script injection regression passed: repeated selector/full-page injection, metrics routing, isolated globals, and single cleanup state.');
  } finally {
    await page.close();
  }
}
