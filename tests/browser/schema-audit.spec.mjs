import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectFile, lint, renderHtml, resolveConfig } from '../../dist/index.js';

let directory;
const urls = {};
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mcplint-schema-report-'));
  for (const mode of ['mixed', 'valid']) {
    const target = await collectFile(`examples/schema-audit/${mode}.json`, 'invoice-schemas');
    target.servers.forEach(server => { server.label = `schema-audit/${mode}.json`; });
    const result = lint(target, resolveConfig({ file: {} }));
    result.generatedAt = '2026-10-09T00:00:00.000Z';
    const filename = join(directory, `${mode}.html`);
    await writeFile(filename, renderHtml(result));
    urls[mode] = pathToFileURL(filename).href;
  }
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

for (const width of [1440, 375]) {
  test(`schema findings remain readable offline at ${width}px`, async ({ page, context, browserName }) => {
    const requests = [], errors = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(String(error)));
    await context.setOffline(true);
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto(urls.mixed);
    await expect(page.getByRole('heading', { name: 'Incomplete audit', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Score unavailable' })).toBeVisible();
    await expect(page.locator('body')).toContainText('outputSchema does not compile as JSON Schema');
    await expect(page.locator('body')).toContainText('Unresolved schema reference');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Toggle color theme' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    if (process.env.UPDATE_SCHEMA_SCREENSHOTS && browserName === 'chromium') {
      await page.screenshot({ path: `docs/assets/schema-audit-${width}.png`, fullPage: true });
    }
    await page.goto(urls.valid);
    await expect(page.getByRole('heading', { name: 'Incomplete audit', exact: true })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('schema/invalid');
    expect(errors).toEqual([]); expect(requests).toEqual([]);
  });
}
