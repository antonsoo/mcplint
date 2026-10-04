import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { marked } from 'marked';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectFile, lint, resolveConfig, renderHtml, renderMarkdown } from '../../dist/index.js';

let dir;
let incomplete;
const hostile = '<img src="https://example.invalid/leak">![leak](https://example.invalid/image) | `</script><script>globalThis.pwned=1</script>';
const good = { name: 'read_invoice', description: 'Read a single invoice by its identifier.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
const urls = {};
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcplint-browser-'));
  for (const [name, data] of Object.entries({
    incomplete: { tools: [good, { ...good, name: hostile }, null], nextCursor: 'page2' },
    findings: { tools: [{ ...good, description: '' }] }, clean: { tools: [] },
  })) {
    const source = join(dir, `${name}.json`);
    await writeFile(source, JSON.stringify(data));
    const result = lint(await collectFile(source, name === 'incomplete' ? hostile : name), resolveConfig({ file: {} }));
    // Stable, portable screenshot labels. Collection still ran on the saved data above.
    result.target.servers.forEach(server => { server.label = `${name}.json`; });
    result.generatedAt = '2026-10-03T00:00:00.000Z';
    if (name === 'incomplete') incomplete = result;
    const html = join(dir, `${name}.html`);
    await writeFile(html, renderHtml(result));
    urls[name] = pathToFileURL(html).href;
  }
  const result = lint({ servers: [{ id: 'archived', label: 'archived' }], tools: [], prompts: [], resources: [],
    collection: [{ serverId: 'archived', scope: 'config', status: 'disabled', pages: 0, received: 0, retained: 0 }] }, resolveConfig({ file: {} }));
  const html = join(dir, 'disabled.html');
  await writeFile(html, renderHtml(result)); urls.disabled = pathToFileURL(html).href;
});
test.afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

for (const width of [1440, 375]) for (const theme of ['dark', 'light']) {
  test(`offline evidence ${width}px ${theme}`, async ({ page, context, browserName }) => {
    const errors = []; const requests = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await context.setOffline(true);
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(() => { globalThis.policyViolations = []; document.addEventListener('securitypolicyviolation', event => globalThis.policyViolations.push(event.violatedDirective)); });
    await page.goto(urls.incomplete);
    await expect(page.getByRole('heading', { name: 'Incomplete audit' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Score unavailable' })).toBeVisible();
    await expect(page.locator('.coverage-table tbody tr')).toHaveCount(2);
    await expect(page.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => globalThis.pwned)).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
    expect(axe.violations).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Toggle color theme' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('region', { name: 'Collection coverage table' })).toBeFocused();
    if (width === 375) {
      const before = await page.locator('.coverage-scroll').evaluate(el => el.scrollLeft);
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => page.locator('.coverage-scroll').evaluate(el => el.scrollLeft)).toBeGreaterThan(before);
    }
    expect(errors).toEqual([]); expect(requests).toEqual([]);
    expect(await page.evaluate(() => globalThis.policyViolations)).toEqual([]);
    if (process.env.UPDATE_SCREENSHOTS && browserName === 'chromium') {
      await page.getByRole('button', { name: 'Toggle color theme' }).click();
      await page.locator('.coverage-scroll').evaluate(el => { el.scrollLeft = 0; });
      await page.screenshot({ path: `docs/assets/coverage-${theme}-${width}.png`, fullPage: true });
    }
  });
}
for (const [name, heading] of [['clean', 'No findings'], ['findings', 'Findings to review'], ['disabled', 'No enabled servers']]) {
  test(`${name} verdict is independent of score`, async ({ page }) => {
    await page.goto(urls[name]);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('.score-band')).not.toContainText('clean');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
test('Markdown metadata stays literal after real GFM rendering', async ({ page, context }) => {
  const requests = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await context.setOffline(true);
  const html = join(dir, 'markdown.html');
  await writeFile(html, `<!doctype html><html lang="en"><head><title>Markdown regression</title></head><body>${await marked(renderMarkdown(incomplete))}</body></html>`);
  await page.goto(pathToFileURL(html).href);
  await expect(page.locator('img, script')).toHaveCount(0);
  expect(await page.locator('body').innerText()).toContain(hostile);
  expect(await page.locator('a[href*="example.invalid"]').count()).toBe(0);
  expect(requests).toEqual([]);
});
test('theme toggle works when storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', { value: () => { throw Error('blocked'); } });
    Object.defineProperty(Storage.prototype, 'setItem', { value: () => { throw Error('blocked'); } });
  });
  await page.goto(urls.incomplete);
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
});


test('built demo navigation keeps three distinct audit outcomes usable on a phone', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await context.setOffline(true);
  const errors = []; const network = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.goto(pathToFileURL(resolve('site/index.html')).href);
  await expect(page.getByRole('heading', { name: 'Findings to review', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'incomplete collection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Incomplete audit' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Score unavailable' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('link', { name: 'well-behaved fixture', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No findings', exact: true })).toBeVisible();
  expect(errors).toEqual([]); expect(network).toEqual([]);
});
