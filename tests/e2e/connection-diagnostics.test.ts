import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('omits private response and credential text from every built CLI diagnostic path', () => {
  const capture = spawnSync(process.execPath,
    [resolve('studies/connection-diagnostics/capture.mjs'), resolve('dist/cli.js'), '--check'],
    { encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  expect(capture.status, capture.stderr || capture.stdout).toBe(0);
  const report = JSON.parse(capture.stdout) as {
    cases: number; disagreements: number; authorized_requests_unchanged: boolean;
  };
  expect(report.cases).toBe(10);
  expect(report.disagreements).toBe(0);
  expect(report.authorized_requests_unchanged).toBe(true);
}, 95_000);
