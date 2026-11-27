// Timings from the built dist/ at 390 x 844 (DPR 3, touch) with the CPU throttled 4 times:
// cost of re-setting the poster per keystroke, frame intervals while typing and while pulling,
// and the time to press a print. Usage: npm run build && npm run perf
import { serve } from './serve.mjs';
import { launch, BASE, ready } from './browser.mjs';

const server = await serve();
const browser = await launch();
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (a) => `median ${q(a, 0.5).toFixed(1)} ms, p95 ${q(a, 0.95).toFixed(1)} ms, n=${a.length}`;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(BASE);
  await ready(page);
  await page.waitForTimeout(1500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // 1. Re-set and redraw per keystroke, measured synchronously.
  const perKey = await page.evaluate(() => {
    const app = window.__tallOrder;
    const text = 'Tickets two dollars at the door';
    const set = [], draw = [];
    for (let k = 1; k <= text.length; k++) {
      const t0 = performance.now();
      app.setLineText(2, text.slice(0, k));
      const t1 = performance.now();
      app.drawProof();
      set.push(t1 - t0);
      draw.push(performance.now() - t1);
    }
    return { set, draw };
  });
  console.log('Re-set per keystroke (engine):', fmt(perKey.set));
  console.log('Redraw per keystroke (proof canvas):', fmt(perKey.draw));

  // 2. Frame intervals while typing with the real keyboard.
  await page.locator('#lines input[data-i="3"]').tap();
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const f = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 100000) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await page.keyboard.type('Grange hall dance', { delay: 90 });
  const typing = await page.evaluate(() => { const a = window.__frames.slice(5); window.__frames = []; return a; });
  console.log('Frame interval while typing:', fmt(typing));
  await page.locator('#done').tap();
  await page.waitForTimeout(500);

  // 3. The pull: wall time to press the print, then frame intervals during the animation.
  await page.locator('#pull').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__frames = [];
    document.getElementById('pull').addEventListener('click', () => {
      const t0 = performance.now();
      const poll = () => { if (window.__tallOrder.pullT > 0) window.__pullDelay = performance.now() - t0; else requestAnimationFrame(poll); };
      poll();
    }, { once: true, capture: true });
  });
  await page.locator('#pull').tap();
  await page.waitForFunction(() => window.__pullDelay != null, null, { timeout: 30000 });
  const startDelay = Math.round(await page.evaluate(() => window.__pullDelay));
  await page.evaluate(() => { window.__frames = []; });
  await page.waitForFunction(() => document.getElementById('press').dataset.mode === 'pulled', null, { timeout: 30000 });
  const pulling = await page.evaluate(() => window.__frames.slice(2));
  console.log(`Tap to first frame of the pull, including pressing the print: ${startDelay} ms`);
  console.log('Frame interval during the pull:', fmt(pulling));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
