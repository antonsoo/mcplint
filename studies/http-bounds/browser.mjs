// Open the exact CLI artifacts offline, then use their real comparison download.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? resolve(here, 'results/browser'));
const images = resolve(here, '../../docs/assets/http-bounds');
await mkdir(out, { recursive: true }); await mkdir(images, { recursive: true });
const expected = JSON.parse(await readFile(resolve(here, 'results/diff.json'), 'utf8'));
assert.equal(expected.complete, false); assert.equal(expected.summary.removed, 0);
const observations = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    for (const width of [1440, 375]) {
      for (const name of ['incomplete', 'diff']) {
        const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: width === 1440 ? 'dark' : 'light' });
        try {
          const page = await context.newPage(); const errors = [], requests = [];
          page.on('pageerror', error => errors.push(error.message));
          await context.route('**/*', route => {
            if (!route.request().url().startsWith('file:')) { requests.push(route.request().url()); return route.abort(); }
            return route.continue();
          });
          await context.setOffline(true);
          const path = resolve(here, `results/${name}.html`), raw = await readFile(path);
          const response = await page.goto(pathToFileURL(path).href);
          if (response) assert.equal(createHash('sha256').update(await response.body()).digest('hex'), createHash('sha256').update(raw).digest('hex'));
          else assert.equal(page.url(), pathToFileURL(path).href); // Firefox file navigation exposes no response.
          if (name === 'incomplete') {
            await expect(page.locator('.audit-status h2')).toHaveText('Incomplete audit');
            await expect(page.locator('.score-band')).toHaveText('Not scored');
            await expect(page.locator('.coverage-table')).toContainText('10 MiB read limit');
            await expect(page.locator('.coverage-table tbody tr').first()).toContainText('incomplete');
            await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click();
            await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click();
          } else {
            await expect(page.locator('.md-title')).toHaveText('Comparison incomplete; unchanged metadata is not established');
            await expect(page.locator('#issues')).toContainText('tools/list is incomplete');
            await expect(page.locator('#changes')).toContainText('Collection gaps remain unresolved');
            await page.locator('summary').filter({ hasText: /^Collection coverage$/ }).click();
            await expect(page.locator('#coverage')).toContainText('10 MiB read limit');
            const pending = page.waitForEvent('download');
            await page.getByRole('button', { name: 'Download complete JSON', exact: true }).click();
            const download = await readFile(await (await pending).path(), 'utf8');
            assert.deepEqual(JSON.parse(download), expected);
            await writeFile(resolve(out, `${engine}-${width}-diff-download.json`), download);
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          const violations = (await new AxeBuilder({ page }).analyze()).violations.map(row => row.id);
          assert.deepEqual(violations, []); assert.deepEqual(errors, []); assert.deepEqual(requests, []);
          await page.screenshot({ path: resolve(images, `${name}-${engine}-${width}.png`), fullPage: true });
          observations.push({ name, engine, browser: browser.version(), width, offline: true,
            bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'), receivedBytesMatch: response ? true : undefined,
            fileNavigationResponseUnavailable: response ? undefined : true,
            body: await page.locator('body').innerText(), downloadMatches: name === 'diff' ? true : undefined,
            overflow: false, axeViolations: violations, pageErrors: errors, externalRequests: requests });
          console.log(`PASS ${name} ${engine} ${width}px offline`);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
}
await writeFile(resolve(out, 'receipt.json'), JSON.stringify({ observations }, null, 2) + '\n');
