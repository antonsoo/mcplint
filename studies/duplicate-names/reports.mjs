import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const [cli = 'dist/cli.js', output = 'studies/duplicate-names/reports.json', screenshots, runtime = process.execPath] = process.argv.slice(2);
const study = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'mcplint-duplicate-reports-'));
const formats = []; const browsers = [];
try {
  for (const format of ['json', 'sarif', 'markdown', 'terminal', 'html']) {
    const result = spawnSync(runtime, [resolve(cli), 'file', 'tools.json', '--format', format, '--fail-on', 'error'], { cwd: study, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stdout.includes('naming/collision'));
    if (format === 'json') {
      const report = JSON.parse(result.stdout);
      assert.equal(report.summary.complete, true);
      assert.equal(report.summary.toolCount, 2);
      assert.equal(report.summary.bySeverity.error, 1);
    } else if (format === 'sarif') {
      const run = JSON.parse(result.stdout).runs[0];
      assert.equal(run.invocations[0].executionSuccessful, true);
      assert.equal(run.results.length, 1);
      assert.equal(run.results[0].level, 'error');
    } else assert.ok(result.stdout.includes('occurs 2 times'));
    if (format === 'html') writeFileSync(join(dir, 'report.html'), result.stdout);
    formats.push({ format, exitCode: result.status, collisionRetained: true });
  }
  for (const [engine, type] of [['chromium', chromium], ['firefox', firefox]]) {
    const browser = await type.launch();
    try {
      for (const width of [1440, 375]) {
        const context = await browser.newContext({ viewport: { width, height: 950 }, colorScheme: 'light', offline: true });
        const page = await context.newPage();
        const errors = []; const network = [];
        page.on('pageerror', error => errors.push(String(error)));
        page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
        await page.goto(pathToFileURL(join(dir, 'report.html')).href);
        assert.equal(await page.getByRole('heading', { name: 'Findings to review', exact: true }).count(), 1);
        assert.ok((await page.locator('.subjects').innerText()).includes('occurs 2 times'));
        assert.ok((await page.locator('.subjects').innerText()).includes('remove repeated list entries'));
        assert.equal(await page.locator('.bar-row').count(), 2);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const axe = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(axe.violations, []);
        await page.keyboard.press('Tab');
        assert.equal(await page.getByRole('button', { name: 'Toggle color theme' }).evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
        if (screenshots && engine === 'chromium') {
          mkdirSync(screenshots, { recursive: true });
          await page.screenshot({ path: join(screenshots, `duplicates-${width}.png`), fullPage: true });
        }
        assert.deepEqual(errors, []); assert.deepEqual(network, []);
        browsers.push({ engine, width, findingVisible: true, retainedToolBars: 2, overflow: false, accessibilityViolations: 0, pageErrors: errors, httpRequests: network });
        await context.close();
      }
    } finally { await browser.close(); }
  }
  writeFileSync(output, JSON.stringify({ formats, browsers }, null, 2) + '\n');
  console.log({ formats: formats.length, browsers: browsers.length });
} finally { rmSync(dir, { recursive: true, force: true }); }
