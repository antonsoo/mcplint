// Open the exact standalone report emitted by replay.mjs, with networking disabled.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const [reportArg, outputArg] = process.argv.slice(2);
assert(reportArg && outputArg, 'Usage: node browser.mjs REPLAY_DIRECTORY OUTPUT_DIRECTORY');
const report = resolve(reportArg), output = resolve(outputArg);
await mkdir(output, { recursive: true });
const html = await readFile(join(report, 'diff.html'));
const expected = JSON.parse(await readFile(join(report, 'diff.stdout'), 'utf8'));
assert.equal(expected.complete, false);
const cases = [];
for (const [engine, driver] of Object.entries({ chromium, firefox })) {
  const browser = await driver.launch();
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({
        viewport: { width, height: 960 }, colorScheme: width === 1440 ? 'dark' : 'light',
      });
      try {
        const page = await context.newPage();
        const errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', route => {
          if (!route.request().url().startsWith('file:')) {
            requests.push(route.request().url());
            return route.abort();
          }
          return route.continue();
        });
        await context.setOffline(true);
        await page.goto(pathToFileURL(join(report, 'diff.html')).href);
        await expect(page.locator('.md-title')).toHaveText('Comparison incomplete; unchanged metadata is not established');
        await expect(page.locator('#issues')).toContainText('tools/list is incomplete');
        await expect(page.locator('#changes')).toContainText('Collection gaps remain unresolved');
        await page.locator('summary').filter({ hasText: /^Collection coverage$/ }).click();
        await expect(page.locator('#coverage')).toContainText('would be rounded during analysis');
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download complete JSON', exact: true }).click();
        assert.deepEqual(JSON.parse(await readFile(await (await pending).path(), 'utf8')), expected);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const violations = (await new AxeBuilder({ page }).analyze()).violations.map(row => row.id);
        assert.deepEqual(violations, []);
        await page.screenshot({ path: join(output, `${engine}-${width}.png`), fullPage: true });
        assert.deepEqual(errors, []);
        assert.deepEqual(requests, []);
        cases.push({ engine, browser: browser.version(), width, offline: true,
          body: await page.locator('body').innerText(), downloadMatches: true,
          overflow: false, axeViolations: violations, pageErrors: errors, externalRequests: requests });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(join(output, 'observations.json'), JSON.stringify({
  reportBytes: html.length, reportSha256: createHash('sha256').update(html).digest('hex'), cases,
}, null, 2) + '\n');
console.log(`${cases.length} offline report workflows verified`);
