import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const reports = resolve(process.argv[2] ?? 'studies/metadata-diff/results');
const output = resolve(process.argv[3] ?? '/tmp/claude-1000/mcplint-metadata-diff/browser');
await mkdir(output, { recursive: true });
const full = JSON.parse(await readFile(join(reports, 'after.diff.json')));
const partial = JSON.parse(await readFile(join(reports, 'partial.diff.json')));
async function download(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download complete JSON', exact: true }).click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}
const results = [];
for (const [engine, driver] of Object.entries({ chromium, firefox })) {
  const browser = await driver.launch();
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: width === 1440 ? 'dark' : 'light' });
      const page = await context.newPage(); const errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => { window.csp = []; addEventListener('securitypolicyviolation', event => window.csp.push(event.violatedDirective)); });
      await context.route('**/*', route => {
        if (!route.request().url().startsWith('file:')) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
      });
      try {
        await context.setOffline(true);
        await page.goto(pathToFileURL(join(reports, 'after.html')).href);
        await expect(page.getByRole('heading', { name: 'Recorded metadata changed', exact: true })).toBeVisible();
        await expect(page.locator('.md-card')).toHaveCount(7);
        assert.deepEqual(await download(page), full);
        await page.getByRole('combobox', { name: 'Change type', exact: true }).selectOption('changed');
        await expect(page.locator('.md-card')).toHaveCount(5);
        await page.getByLabel('Find a definition or changed path', { exact: true }).fill('search_records');
        await expect(page.locator('.md-card')).toHaveCount(1);
        await expect(page.locator('.md-field')).toHaveCount(2);
        await expect(page.locator('.md-field').filter({ hasText: '/inputSchema/properties/limit/maximum' })).toContainText('200');
        assert.deepEqual(await download(page), full);
        const body = await page.locator('body').innerText();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const audit = await new AxeBuilder({ page }).analyze();
        const violations = audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
        await page.screenshot({ path: join(output, `${engine}-${width}.png`), fullPage: true });
        assert.deepEqual(violations, []);
        await page.getByLabel('Find a definition or changed path', { exact: true }).fill('');
        await page.getByRole('combobox', { name: 'Change type', exact: true }).selectOption('added');
        await expect(page.locator('.md-card')).toHaveCount(1);
        await expect(page.locator('.md-card summary')).toContainText('export_records');
        await page.getByRole('combobox', { name: 'Change type', exact: true }).selectOption('removed');
        await expect(page.locator('.md-card summary')).toContainText('read_record');
        await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click();
        assert.deepEqual(await download(page), full);
        assert.deepEqual(await page.evaluate(() => window.csp), []);
        await page.goto(pathToFileURL(join(reports, 'partial.html')).href);
        await expect(page.locator('.md-title')).toContainText('Comparison incomplete');
        await expect(page.locator('#issues')).toContainText('absent definitions cannot be classified');
        await expect(page.locator('#changes')).toContainText('Collection gaps remain unresolved');
        assert.deepEqual(await download(page), partial);
        assert.deepEqual(await page.evaluate(() => window.csp), []);
        assert.deepEqual(errors, []); assert.deepEqual(external, []);
        results.push({ engine, browser: browser.version(), width, offline: true, completeReport: full.summary, incompleteReport: partial.summary,
          downloadsMatchUnfilteredJson: true, downloads: 4, body, axeViolations: violations, pageErrors: errors, externalRequests: external,
          files: await Promise.all(['after.html', 'partial.html'].map(async name => {
            const data = await readFile(join(reports, name)); return { name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
          })) });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(join(output, 'observations.json'), JSON.stringify({ cases: results }, null, 2) + '\n');
console.log(`${results.length} standalone offline browser workflows verified`);
