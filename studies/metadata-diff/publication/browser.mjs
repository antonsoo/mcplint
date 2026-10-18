// node browser.mjs BASE_URL OUTPUT; exercise the actual delivered report offline.
/* global document, innerWidth, window */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const [base, output] = process.argv.slice(2);
assert.ok(base && output);
await mkdir(output, { recursive: true });
const expected = JSON.parse(await readFile(new URL('../reference/captures/dependency.diff.json', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [], blockedFavicons = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, colorScheme: width === 1440 ? 'dark' : 'light' });
      try {
        const errors = [], requests = [], policies = [];
        let offline = false;
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        context.on('request', request => { if (offline && /^https?:/.test(request.url())) requests.push(request.url()); });
        await context.exposeBinding('recordPolicy', (_, directive) => policies.push(directive));
        await context.addInitScript(() => document.addEventListener('securitypolicyviolation', event => window.recordPolicy({
          directive: event.violatedDirective, blockedURI: event.blockedURI,
        })));
        const page = await context.newPage();
        const response = await page.goto(new URL('filesystem-dependencies.html', base).href);
        assert.equal(response.status(), 200);
        const html = await response.body();
        const path = resolve(output, `${engine}-${width}.html`);
        await writeFile(path, html);
        await page.locator('.md-card').nth(12).waitFor();
        assert.equal(await page.locator('.md-card').count(), 13);
        await context.setOffline(true); offline = true;
        for (const [view, url] of [['hosted', null], ['standalone', pathToFileURL(path).href]]) {
          if (url) await page.goto(url);
          await page.getByLabel('Find a definition or changed path', { exact: true }).fill('read_text_file');
          assert.equal(await page.locator('.md-card').count(), 1);
          await page.locator('.md-field').nth(3).waitFor();
          const fields = await page.locator('.md-field').evaluateAll(rows => rows.map(row => ({
            pointer: row.querySelector('h3').textContent,
            values: [...row.querySelectorAll('pre')].map(pre => pre.textContent),
          })));
          const change = expected.changes.find(item => item.identity === 'read_text_file');
          assert.deepEqual(fields, change.fields.map(field => ({ pointer: field.pointer,
            values: [field.before, field.after].map(value => value.present ? JSON.stringify(value.value, null, 2) : '(absent)') })));
          const pending = page.waitForEvent('download');
          await page.getByRole('button', { name: 'Download complete JSON', exact: true }).click();
          const json = await readFile(await (await pending).path());
          assert.deepEqual(JSON.parse(json), expected);
          await writeFile(resolve(output, `${engine}-${width}-${view}.json`), json);
          await page.locator('#status-filter').selectOption('removed');
          assert.equal(await page.locator('#changes').innerText(), 'No changes match these filters.');
          await page.locator('#status-filter').selectOption('all');
          const previousTheme = await page.locator('html').getAttribute('data-theme') ?? (width === 1440 ? 'dark' : 'light');
          await page.getByRole('button', { name: 'Toggle color theme', exact: true }).focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('html').getAttribute('data-theme'), previousTheme === 'dark' ? 'light' : 'dark');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
          results.push({ engine, version: browser.version(), width, view, htmlSha256: sha(html),
            downloadedJsonSha256: sha(json), all13ChangesPreserved: true, fourExactSchemaRemovalsVisible: true,
            noOverflow: true, axeViolations: 0 });
          if (view === 'hosted') await page.screenshot({ path: resolve(output, `${engine}-${width}.png`), fullPage: true });
        }
        assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        // Firefox probes the origin favicon even without a link element. The
        // report's default-src 'none' blocks that browser-owned image request.
        // Retain this observed diagnostic; accept no other policy violation.
        for (const policy of policies) assert.deepEqual(policy, {
          directive: 'img-src', blockedURI: new URL('/favicon.ico', base).href,
        });
        blockedFavicons.push(...policies.map(policy => ({ engine, width, ...policy })));
        console.log(JSON.stringify({ engine, width, hostedAndOfflineReopen: true }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(resolve(output, 'browser.json'), JSON.stringify({ base, offlineAfterInitialLoad: true,
  pageErrors: [], offlineHttpRequests: [], blockedImplicitFavicons: blockedFavicons, results }, null, 2) + '\n');
