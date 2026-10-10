import { chromium, firefox, expect } from '@playwright/test';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const [rootArg = '.', outputArg = 'studies/resource-identity/browser-after', mode = 'verify'] = process.argv.slice(2);
const root = resolve(rootArg), output = resolve(outputArg);
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-resource-report-'));
const cases = JSON.parse(await readFile(new URL('cases.json', import.meta.url)));
const records = [];
await mkdir(output, { recursive: true });
try {
  const name = 'missing-uri.json';
  await writeFile(join(scratch, name), JSON.stringify(cases[0].snapshot));
  const reports = {};
  for (const format of ['html', 'json', 'sarif']) {
    const proc = spawnSync(process.execPath, [join(root, 'dist/cli.js'), 'file', name, '--format', format], { cwd: scratch, encoding: 'utf8' });
    assert.equal(proc.status, 0, proc.stderr);
    reports[format] = proc.stdout;
    await writeFile(join(output, `report.${format}`), proc.stdout);
  }
  const summary = JSON.parse(reports.json).summary;
  const sarif = JSON.parse(reports.sarif).runs[0];
  assert.equal(sarif.invocations[0].executionSuccessful, summary.complete);
  assert.equal(sarif.properties.score, summary.score);
  if (mode === 'verify') { assert.equal(summary.complete, false); assert.equal(summary.score, null); }
  for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
    const browser = await type.launch();
    for (const width of [1440, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(join(output, 'report.html')).href);
      await expect(page.getByRole('heading', { name: summary.complete ? 'No findings' : 'Incomplete audit', exact: true })).toBeVisible();
      await expect(page.getByRole('img', { name: summary.complete ? 'Score 100 out of 100' : 'Score unavailable', exact: true })).toBeVisible();
      if (!summary.complete) await expect(page.locator('.coverage-table')).toContainText('string uri');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      if (name === 'chromium') await page.screenshot({ path: join(output, `${name}-${width}.png`), fullPage: true, animations: 'disabled' });
      records.push({ browser: name, version: browser.version(), width, errors, requests, summary });
      await page.close();
    }
    await browser.close();
  }
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ node: process.version,
    htmlSha256: createHash('sha256').update(reports.html).digest('hex'), records }, null, 2) + '\n');
  console.log(`${records.length} offline HTML workflows; JSON and SARIF agree; complete=${summary.complete}, score=${summary.score}`);
} finally { await rm(scratch, { recursive: true, force: true }); }
