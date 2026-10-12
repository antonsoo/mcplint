import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps HTTP credentials within the configured origin throughout actual collection', () => {
  const capture = spawnSync(process.execPath,
    [resolve('studies/http-redirects/capture.mjs'), resolve('.'), '--check'],
    { encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  expect(capture.status, capture.stderr || capture.stdout).toBe(0);
  const receipt = JSON.parse(capture.stdout) as {
    cases: number; disagreements: number; receiver_requests: number;
  };
  expect(receipt.cases).toBe(71);
  expect(receipt.disagreements).toBe(0);
  expect(receipt.receiver_requests).toBe(0);
}, 95_000);
