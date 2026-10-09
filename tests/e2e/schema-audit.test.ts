import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('preserves independent input/output schema decisions through file, stdio, HTTP and every report', { timeout: 60_000 }, () => {
  const output = mkdtempSync(join(tmpdir(), 'mcplint-schema-audit-'));
  try {
    const result = spawnSync(process.execPath, [
      'examples/schema-audit/replay.mjs', resolve('dist/cli.js'), output, '--verify'
    ], { encoding: 'utf8', timeout: 55_000, maxBuffer: 4 * 1024 * 1024 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"workflows":12');
  } finally { rmSync(output, { recursive: true, force: true }); }
});
