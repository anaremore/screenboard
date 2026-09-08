import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function verifyFullPageScrolling(browser, script) {
  const contentScript = script ?? await readFile('dist/assets/fullPage.js', 'utf8');
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1024, height: 640, deviceScaleFactor: 1.25 });
    await page.setContent('<style>html,body{margin:0}body{height:2400px}.heading{position:sticky;top:0;height:60px;background:red}</style><div class="heading">Scrolling regression</div>');
    await page.bringToFront();
    // Exercise the real bundled content script; only Chrome's message transport
    // is substituted so requested and returned scroll positions can be asserted.
    await page.evaluate(() => {
      window.chrome = { runtime: { onMessage: { addListener(listener) { window.screenboardTestListener = listener; } } } };
    });
    await page.addScriptTag({ content: contentScript });
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const result = await page.evaluate(async () => {
        const send = (message) => new Promise((done) => window.screenboardTestListener(message, {}, done));
        window.scrollTo({ left: 0, top: 173, behavior: 'instant' });
        // Let the initial user position paint before capture changes sticky layout.
        // Headful Chrome can otherwise apply its pending scroll anchor after PREPARE.
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        document.documentElement.style.setProperty('scroll-behavior', 'smooth', 'important');
        await send({ type: 'PREPARE_FULL_PAGE' });
        const positions = [];
        const observed = [];
        for (const y of [0, 640, 1280, 2400]) {
          positions.push(await send({ type: 'SCROLL_FULL_PAGE', x: 0, y, hideFixed: y > 0 }));
          observed.push({ requestedY: y, scrollX, scrollY, visibility: document.visibilityState, viewportHeight: innerHeight });
        }
        const restored = await send({ type: 'RESTORE_FULL_PAGE' });
        return {
          positions, observed, restored, scrollY,
          behavior: document.documentElement.style.getPropertyValue('scroll-behavior'),
          priority: document.documentElement.style.getPropertyPriority('scroll-behavior'),
          captureStylePresent: !!document.querySelector('style[data-screenboard-capture]'),
        };
      });
      assert.deepEqual(result.positions, [0, 640, 1280, 1760].map((scrollY) => ({ scrollX: 0, scrollY })), `Capture scrolling must reach each target despite smooth!important (iteration ${iteration + 1}: ${JSON.stringify(result.observed)})`);
      assert.equal(result.restored.ok, true, result.restored.error);
      assert.equal(result.scrollY, 173);
      assert.equal(result.behavior, 'smooth');
      assert.equal(result.priority, 'important');
      assert.equal(result.captureStylePresent, false);
    }
    console.log('Full-page scrolling regression passed: 8 runs with smooth!important, clamped final slices, and exact restoration.');
  } finally {
    await page.close();
  }
}
