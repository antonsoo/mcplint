import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('rejects duplicate names from saved, paginated and merged tools/list results', { timeout: 30_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcplint-duplicates-e2e-'));
  try {
    const result = spawnSync(process.execPath, ['studies/duplicate-names/verify.mjs', 'dist/cli.js', join(dir, 'receipt.json')], { encoding: 'utf8', timeout: 25_000 });
    expect(result.status, result.stderr).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
