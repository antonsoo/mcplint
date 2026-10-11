import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectFile, lint, renderHtml, resolveConfig } from '../../dist/index.js';
let directory, url;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mcplint-enum-report-'));
  const fixtures = JSON.parse(await readFile('studies/enum-values/fixtures.json', 'utf8'));
  const file = join(directory, 'metadata.json');
  await writeFile(file, JSON.stringify({ tools: fixtures.filter(f => f.name !== 'structured_safety').flatMap(f => f.tools) }));
  const target = await collectFile(file, 'enum-fixture');
  target.servers.forEach(server => { server.label = 'Controlled enum metadata'; });
  const result = lint(target, resolveConfig({ file: {} }));
  expect(result.summary.complete).toBe(true);
  result.generatedAt = '2026-10-11T00:00:00.000Z';
  const report = join(directory, 'report.html');
  await writeFile(report, renderHtml(result)); url = pathToFileURL(report).href;
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
for (const width of [1440, 375]) test(`scalar enum evidence remains readable offline at ${width}px`, async ({ page, context, browserName }) => {
  const requests = [], errors = [], csp = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.exposeFunction('recordCsp', directive => csp.push(directive));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => window.recordCsp(event.violatedDirective)));
  await context.setOffline(true); await page.setViewportSize({ width, height: 950 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Incomplete audit', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).toContainText('structured_mode');
  await expect(page.locator('body')).toContainText('has scalar enum [null,false]');
  await expect(page.locator('body')).toContainText('has scalar enum ["","safe"]');
  await expect(page.locator('body')).not.toContainText('safety/unchecked');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (process.env.CAPTURE_ENUM_EVIDENCE === '1') {
    await mkdir('docs/assets/enum-values', { recursive: true });
    await page.screenshot({ path: `docs/assets/enum-values/${browserName}-${width}.png`, fullPage: true });
    await writeFile(`studies/enum-values/browser-${browserName}-${width}.json`, JSON.stringify({ browser: browserName, width, offline: true,
      completeReport: true, structuredToolRetained: true, nullAndEmptyStringsVisible: true, noPageOverflow: true,
      accessibilityViolations: [], pageErrors: errors, externalRequests: requests, cspViolations: csp }, null, 2) + '\n');
  }
  expect(errors).toEqual([]); expect(requests).toEqual([]); expect(csp).toEqual([]);
});
