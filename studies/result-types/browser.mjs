// Capture actual SDK-backed CLI reports, then open those exact files offline.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { cases, privateMarker, privateState } from './cases.mjs';

const [beforeArg, afterArg, outputArg, mode] = process.argv.slice(2);
assert(beforeArg && afterArg && outputArg,
  'Usage: node browser.mjs BASELINE_ENGINE_ROOT CORRECTED_ENGINE_ROOT OUTPUT_DIRECTORY [--corrected-only]');
assert.ok(mode === undefined || mode === '--corrected-only');
const output = resolve(outputArg);
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-result-types-browser-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const reports = [];
await mkdir(output, { recursive: true });
const phases = mode === '--corrected-only' ? [['after', afterArg]] : [['before', beforeArg], ['after', afterArg]];
for (const [phase, rootArg] of phases) {
  const root = resolve(rootArg);
  for (const id of ['input-required-tools', 'suppressed-gap']) {
    const item = cases.find(item => item.id === id);
    const cwd = join(scratch, `${phase}-${id}`);
    const destination = join(output, phase, id);
    await mkdir(cwd); await mkdir(destination, { recursive: true });
    for (const file of ['server.mjs', 'cases.mjs']) {
      await copyFile(new URL(file, import.meta.url), join(cwd, file));
    }
    await writeFile(join(cwd, 'case.json'), JSON.stringify(item));
    if (item.suppressed) await writeFile(join(cwd, '.mcplintrc.json'), JSON.stringify({
      severities: { 'collection/incomplete': 'off' }
    }));
    const env = { ...process.env, MCPLINT_ENGINE_ROOT: root,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` };
    const captures = {};
    for (const format of ['json', 'html']) {
      const args = [join(root, 'dist/cli.js'), 'stdio', '--format', format, '--fail-on', 'error',
        '--', 'node', 'server.mjs', 'case.json', 'calls.jsonl'];
      const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.error, undefined, result.stderr);
      assert.equal(result.status, phase === 'before' ? 0 : 1);
      assert.ok(!result.stdout.includes(privateState) && !result.stdout.includes(privateMarker));
      await writeFile(join(destination, `report.${format}`), result.stdout);
      await writeFile(join(destination, `${format}.stderr`), result.stderr);
      captures[format] = result.stdout;
    }
    const report = JSON.parse(captures.json);
    assert.equal(report.summary.complete, phase === 'before');
    if (phase === 'after') assert.equal(report.summary.score, null);
    reports.push({ phase, id, file: join(destination, 'report.html'),
      html: Buffer.from(captures.html), report });
  }
}

// Independently verify the bytes a local HTTP server serves before file/offline checks.
const served = [];
const server = createServer((request, response) => {
  const report = reports.find(report => request.url === `/${report.phase}/${report.id}`);
  if (!report) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(report.html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const report of reports) {
    const received = Buffer.from(await (await fetch(
      `http://127.0.0.1:${server.address().port}/${report.phase}/${report.id}`)).arrayBuffer());
    assert.deepEqual(received, report.html);
    served.push({ phase: report.phase, id: report.id, bytes: received.length, sha256: sha256(received) });
  }
} finally { await new Promise(resolve => server.close(resolve)); }

const observations = [];
for (const [engine, driver] of Object.entries({ chromium, firefox })) {
  const browser = await driver.launch();
  try {
    for (const width of [1440, 375]) for (const report of reports) {
      const context = await browser.newContext({ viewport: { width, height: 960 },
        colorScheme: width === 1440 ? 'dark' : 'light' });
      try {
        const page = await context.newPage();
        const errors = [], externalRequests = [], policyViolations = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
          globalThis.policyViolations = [];
          document.addEventListener('securitypolicyviolation', event => globalThis.policyViolations.push(event.violatedDirective));
        });
        await context.route('**/*', route => {
          if (!route.request().url().startsWith('file:')) {
            externalRequests.push(route.request().url()); return route.abort();
          }
          return route.continue();
        });
        await context.setOffline(true);
        assert.equal(sha256(await readFile(report.file)), sha256(report.html));
        await page.goto(pathToFileURL(report.file).href);
        if (report.phase === 'after') {
          await expect(page.getByRole('heading', { name: 'Incomplete audit', exact: true })).toBeVisible();
          await expect(page.getByRole('img', { name: 'Score unavailable', exact: true })).toBeVisible();
          await expect(page.locator('.coverage-table')).toContainText('not permitted for list requests');
        } else {
          await expect(page.getByRole('heading', { name: 'Incomplete audit', exact: true })).toHaveCount(0);
          await expect(page.getByRole('img', { name: 'Score unavailable', exact: true })).toHaveCount(0);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const violations = (await new AxeBuilder({ page }).analyze()).violations.map(row => row.id);
        assert.deepEqual(violations, []);
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Toggle color theme' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('html')).toHaveAttribute('data-theme', width === 1440 ? 'light' : 'dark');
        await page.keyboard.press('Enter');
        if (report.id === 'input-required-tools') {
          await page.screenshot({ path: join(output, report.phase, `${engine}-${width}.png`), fullPage: true });
        }
        policyViolations.push(...await page.evaluate(() => globalThis.policyViolations));
        assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(policyViolations, []);
        observations.push({ phase: report.phase, id: report.id, engine, browser: browser.version(), width,
          offline: true, reportSha256: sha256(report.html), body: await page.locator('body').innerText(),
          overflow: false, axeViolations: violations, pageErrors: errors, externalRequests, policyViolations,
          keyboardThemeToggle: true });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(join(output, 'observations.json'), JSON.stringify({ node: process.version, served,
  workflows: observations.length, observations }, null, 2) + '\n');
console.log(`${observations.length} actual CLI report workflows verified offline; ${served.length} served files match`);
