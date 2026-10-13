import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareMetadata, renderMetadataHtml } from '../../dist/index.js';
let directory, url, expected;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mcplint-metadata-report-'));
  const snapshot = revision => ({ format: 'mcplint-metadata-snapshot', schemaVersion: 1, createdAt: '2026-10-12T00:00:00.000Z',
    servers: [{ id: 'fixture' }], collection: [{ serverId: 'fixture', scope: 'tools/list', status: 'complete', pages: 1, received: 24, retained: 24 }],
    definitions: Array.from({ length: 24 }, (_, i) => ({ serverId: 'fixture', scope: 'tools/list', value: {
      name: `tool_${String(i).padStart(2, '0')}`, description: revision ? '</script><img src="https://example.invalid/payload" onerror="window.injected=true">\u202e' + 'x'.repeat(7000) : 'original',
      _meta: Object.fromEntries(Array.from({ length: 12 }, (_, j) => [`field${String(j).padStart(2, '0')}`, revision ? j : -1])),
    } })) });
  expected = compareMetadata(snapshot(false), snapshot(true));
  const path = join(directory, 'report.html'); await writeFile(path, renderMetadataHtml(expected)); url = pathToFileURL(path).href;
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
for (const width of [1440, 375]) test(`metadata report pages fields and retains hostile full values at ${width}px`, async ({ page, context }) => {
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.addInitScript(() => { window.violations = []; addEventListener('securitypolicyviolation', event => window.violations.push(event.violatedDirective)); });
  await context.setOffline(true); await page.setViewportSize({ width, height: 960 }); await page.goto(url);
  await expect(page.locator('.md-card')).toHaveCount(20);
  await expect(page.locator('.md-field')).toHaveCount(10);
  await page.getByRole('button', { name: 'Next fields for tool_00', exact: true }).click();
  await expect(page.locator('.md-field')).toHaveCount(3);
  await expect(page.locator('.md-field')).toContainText(['/_meta/field10', '/_meta/field11', '/description']);
  await expect(page.locator('body')).toContainText('Preview: first 6,000');
  await expect(page.locator('body')).toContainText('\\u{202e}');
  await expect(page.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.getByRole('button', { name: 'Next changed entries', exact: true }).click();
  await expect(page.locator('.md-card')).toHaveCount(4);
  await expect(page.locator('.md-card summary').first()).toContainText('tool_20');
  await page.getByLabel('Find a definition or changed path', { exact: true }).fill('tool_23');
  await expect(page.locator('.md-card')).toHaveCount(1);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download complete JSON', exact: true }).click();
  expect(JSON.parse(await readFile(await (await pending).path(), 'utf8'))).toEqual(expected);
  await page.getByLabel('Find a definition or changed path', { exact: true }).fill('absent');
  await expect(page.locator('#changes')).toHaveText('No changes match these filters.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => window.violations)).toEqual([]);
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});
