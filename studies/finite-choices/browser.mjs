// Exercise the built native report offline in both installed browsers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const url = process.argv[2] ?? pathToFileURL(join(root, 'site/enum-choices.html')).href;
const out = process.argv[3] ?? join(directory, 'browser.json');
const assets = join(root, 'docs/assets/finite-choices');
await mkdir(assets, { recursive: true });
const cases = [];
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await page.addInitScript(() => {
        window.violations = [];
        addEventListener('securitypolicyviolation', event => window.violations.push(event.violatedDirective));
      });
      if (url.startsWith('file:')) await context.setOffline(true);
      await page.goto(url);
      await context.setOffline(true);
      assert.equal(await page.locator('.rule-id').filter({ hasText: /^schema\/enum-type$/ }).count(), 4);
      assert.equal(await page.locator('.finding-msg').filter({ hasText: 'none of the 2 enum choices' }).count(), 4);
      assert.equal(await page.locator('body').getByText('No value satisfies both type and enum at this schema node.', { exact: false }).count(), 4);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const audit = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(audit.violations, []);
      const screenshot = join(assets, `${name}-${width}-video.png`);
      await page.locator('.subject').filter({ has: page.getByRole('heading', { name: 'generate-ai-video', exact: true }) }).screenshot({ path: screenshot });
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('button', { name: 'Toggle color theme' }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      assert.deepEqual(await page.evaluate(() => window.violations), []);
      assert.deepEqual(errors, []);
      if (url.startsWith('file:')) assert.deepEqual(requests, []);
      cases.push({ browser: name, version: browser.version(), width, enumTypeFindings: 4,
        horizontalOverflow: false, offlineKeyboardThemeToggle: true, axeViolations: 0,
        pageErrors: errors, cspViolations: [], httpRequests: requests,
        screenshot: screenshot.slice(root.length + 1), screenshotSha256: createHash('sha256').update(await readFile(screenshot)).digest('hex') });
      await context.close();
    }
  } finally { await browser.close(); }
}
await writeFile(out, JSON.stringify({ urlKind: url.startsWith('file:') ? 'local-file' : 'public-url',
  scriptSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'), cases }, null, 2) + '\n');
console.log('Verified four offline native-report browser/viewport cases.');
