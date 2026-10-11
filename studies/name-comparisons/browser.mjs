// Inspect an actual CLI-generated standalone report, offline in both browser engines.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';
const [report, output, screenshots] = process.argv.slice(2);
if (!report || !output) throw Error('Usage: node browser.mjs report.html results.json [screenshots-directory]');
if (screenshots) await mkdir(screenshots, { recursive: true });
const results = [];
for (const [engine, browserType] of Object.entries({ chromium, firefox })) {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, offline: true, colorScheme: 'dark' });
      const page = await context.newPage();
      const requests = [], errors = [];
      page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(pathToFileURL(resolve(report)).href);
      assert.ok(await page.getByRole('heading', { name: 'Findings to review', exact: true }).isVisible());
      const invalid = page.locator('.finding').filter({ has: page.getByText('naming/invalid-chars', { exact: true }) });
      assert.equal(await invalid.count(), 2);
      const shadowing = page.locator('.finding').filter({ has: page.getByText('naming/shadowing', { exact: true }) });
      assert.equal(await shadowing.count(), 1);
      const message = await shadowing.locator('.finding-msg').innerText();
      assert.ok(message.includes('is 1 edit(s) from'));
      assert.ok(message.includes('fetch_' + 'a'.repeat(8192)));
      assert.ok(message.includes('fetch_' + 'a'.repeat(8191) + 'b'));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 0);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Toggle color theme');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      if (screenshots && engine === 'chromium') await page.screenshot({ path: resolve(screenshots, `name-audit-${width}.png`) });
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      results.push({ engine, width, invalidNames: 2, shadowing: 1, retainedNameLengths: [8198, 8198], offline: true, httpRequests: requests.length, pageErrors: errors, overflow, keyboardThemeToggle: true });
      await context.close();
    }
  } finally { await browser.close(); }
}
await writeFile(output, JSON.stringify({ results }, null, 2) + '\n');
console.log(results);
