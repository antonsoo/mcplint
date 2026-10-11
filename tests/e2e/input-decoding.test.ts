import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('refuses damaged source bytes before auditing or starting configured servers', () => {
  const run = spawnSync(process.execPath,
    [resolve('studies/input-decoding/capture.mjs'), resolve('dist/cli.js'), '--check'],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  expect(run.status, run.stderr || run.stdout).toBe(0);
  const receipt = JSON.parse(run.stdout) as { cases: number; disagreements: number };
  expect(receipt.cases).toBe(9);
  expect(receipt.disagreements).toBe(0);
}, 65_000);
