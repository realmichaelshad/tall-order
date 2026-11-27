import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __tallOrder: any }
}

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => problems.push('request failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return problems;
}

async function ready(page: Page, q = '') {
  await page.goto(q);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30_000 });
}

const layoutTexts = (page: Page) => page.evaluate(() => window.__tallOrder.layout.lines.map((l: { text: string }) => l.text));

/** Fraction of proof pixels that are not paper colored. */
async function inkCoverage(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById('proof') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] < 360) ink++;
    return ink / (d.length / 16);
  });
}

test('loads a finished starter poster with no errors or outside requests', async ({ page }) => {
  const problems = watch(page);
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await ready(page);
  expect(await layoutTexts(page)).toEqual(['BIG HOLLOW', 'BRASS BAND', 'NIGHT', 'FRIDAY', 'AT THE', 'BANDSTAND']);
  expect(await inkCoverage(page)).toBeGreaterThan(0.2);
  await expect(page.locator('#pull')).toBeVisible();
  expect([...hosts]).toEqual(['127.0.0.1:5413']);
  expect(problems).toEqual([]);
});

test('typing in a line re-sets the poster, every line still filling the measure', async ({ page }) => {
  const problems = watch(page);
  await ready(page);
  const input = page.locator('#lines input[data-i="2"]');
  if (test.info().project.name === 'phone') await input.tap(); else await input.click();
  await input.fill('');
  await page.keyboard.type('Swap meet', { delay: 25 });
  await expect.poll(() => layoutTexts(page)).toContain('SWAP MEET');
  const fit = await page.evaluate(() => {
    const L = window.__tallOrder.layout;
    return L.lines.filter((l: any) => l.mode === 'fill').map((l: any) => [l.ink.left, l.ink.right]);
  });
  for (const [left, right] of fit) {
    expect(Math.abs(left - 0.8)).toBeLessThan(0.01);
    expect(Math.abs(right - 13.2)).toBeLessThan(0.01);
  }
  // Adding a line adds it to the sheet.
  const spare = page.locator('#lines input').last();
  await spare.fill('Coffee & pie');
  await expect.poll(() => layoutTexts(page)).toContain('COFFEE & PIE');
  expect(problems).toEqual([]);
});

test('tapping a line on the sheet prints it in the second ink', async ({ page }) => {
  const problems = watch(page);
  await ready(page);
  const target = await page.evaluate(() => {
    const L = window.__tallOrder.layout;
    const l = L.lines.find((x: any) => x.text === 'NIGHT');
    return { y: (l.ink.top + l.ink.bottom) / 2 / 22, ink2: l.ink2 };
  });
  expect(target.ink2).toBe(false);
  const box = (await page.locator('#stage').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height * target.y;
  if (test.info().project.name === 'phone') await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await expect.poll(() => page.evaluate(() => window.__tallOrder.layout.lines.find((l: any) => l.text === 'NIGHT').ink2)).toBe(true);
  await expect(page.locator('.ink-toggle[data-i="2"]')).toHaveAttribute('aria-pressed', 'true');
  expect(problems).toEqual([]);
});

test('shuffle, paper and ink choices change the poster', async ({ page }) => {
  const problems = watch(page);
  await ready(page);
  const before = await page.evaluate(() => window.__tallOrder.layout.faces.join());
  let after = before;
  for (let k = 0; k < 4 && after === before; k++) {
    await page.locator('#shuffle').click();
    after = await page.evaluate(() => window.__tallOrder.layout.faces.join());
  }
  expect(after).not.toBe(before);
  await page.locator('[data-paper="1"]').click();
  await expect(page.locator('[data-paper="1"]')).toHaveAttribute('aria-pressed', 'true');
  // Canary #f3d55b with a faint paper tooth.
  await expect.poll(() => page.evaluate(() => {
    const c = document.getElementById('proof') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(4, 4, 1, 1).data;
    return Math.abs(d[0] - 0xf3) < 40 && Math.abs(d[1] - 0xd5) < 40 && Math.abs(d[2] - 0x5b) < 40;
  })).toBe(true);
  expect(problems).toEqual([]);
});

test('pulling the print presses it and offers save, another pull and changing the type', async ({ page }) => {
  const problems = watch(page);
  await ready(page);
  const pull = page.locator('#pull');
  if (test.info().project.name === 'phone') await pull.tap(); else await pull.click();
  await expect(page.locator('#press')).toHaveAttribute('data-mode', 'pulling');
  await expect(page.locator('#press')).toHaveAttribute('data-mode', 'pulled', { timeout: 15_000 });
  await expect(page.locator('#save')).toBeVisible();
  await expect(page.locator('#again')).toBeVisible();
  await expect(page.locator('#change')).toBeVisible();
  const stats = await page.evaluate(() => {
    const c = document.getElementById('printView') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] < 360) ink++;
    return { ink: ink / (d.length / 16), printer: document.documentElement.dataset.printer };
  });
  expect(stats.ink).toBeGreaterThan(0.15);
  expect(stats.printer).toBe('webgl');
  // Another pull of the same forme comes out different.
  const first = await page.evaluate(() => window.__tallOrder.pullSeed);
  await page.locator('#again').click();
  await expect(page.locator('#press')).toHaveAttribute('data-mode', 'pulled', { timeout: 15_000 });
  expect(await page.evaluate(() => window.__tallOrder.pullSeed)).not.toBe(first);
  await page.locator('#change').click();
  await expect(page.locator('#press')).toHaveAttribute('data-mode', 'set');
  expect(problems).toEqual([]);
});

test('saves the print as a PNG at print resolution', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'Phones use the share sheet where the browser supports it.');
  const problems = watch(page);
  await ready(page);
  await page.locator('#pull').click();
  await expect(page.locator('#press')).toHaveAttribute('data-mode', 'pulled', { timeout: 15_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#save').click()]);
  expect(dl.suggestedFilename()).toBe('tall-order-poster.png');
  const path = await dl.path();
  const fs = await import('node:fs');
  const buf = fs.readFileSync(path!);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.readUInt32BE(16)).toBe(1400);
  expect(buf.readUInt32BE(20)).toBe(2200);
  expect(problems).toEqual([]);
});

test('attract mode opens on a print and hands over on the first touch', async ({ page }) => {
  const problems = watch(page);
  await ready(page, '?attract=1');
  await expect(page.locator('#page')).toHaveClass(/attract/);
  await expect(page.locator('#press')).toHaveAttribute('data-mode', 'pulled');
  await expect(page.locator('.bar')).toBeHidden();
  await page.waitForTimeout(2500);
  const box = (await page.locator('#stage').boundingBox())!;
  if (test.info().project.name === 'phone') await page.touchscreen.tap(box.x + 10, box.y + box.height - 10);
  else await page.mouse.click(box.x + 10, box.y + box.height - 10);
  await expect(page.locator('#page')).not.toHaveClass(/attract/);
  await expect(page.locator('.bar')).toBeVisible();
  expect(problems).toEqual([]);
});

test('works inside a frame from a subpath', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/e2e/frame.html');
  const frame = page.frameLocator('#f');
  await expect(frame.locator('#press')).toHaveAttribute('data-mode', 'pulled', { timeout: 30_000 });
  await expect(frame.locator('#stage')).toBeVisible();
  expect(problems).toEqual([]);
});
