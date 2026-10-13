import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, symlink, link, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const run = (args: string[]) => spawnSync(process.execPath, [resolve('dist/cli.js'), ...args], { encoding: 'utf8', timeout: 20_000 });

it('captures actual paginated SDK replies and preserves incomplete/duplicate evidence through the CLI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcplint-metadata-sdk-'));
  try {
    const result = spawnSync(process.execPath, [resolve('studies/metadata-diff/verify.mjs'), resolve('dist/cli.js'), directory],
      { encoding: 'utf8', timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8')) as { snapshotOverwriteRefused: boolean };
    expect(receipt.snapshotOverwriteRefused).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 65_000);

it('protects snapshots from report aliases and rejects invalid comparison inputs without changing them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcplint-metadata-cli-'));
  try {
    const source = join(directory, 'tools.json'), snapshot = join(directory, 'snapshot.json');
    await writeFile(source, '{"tools":[]}');
    expect(run(['file', source, '--snapshot', snapshot]).status).toBe(0);
    const original = await readFile(snapshot);
    expect(run(['diff', snapshot, snapshot, '--format', 'json']).status).toBe(0);
    for (const makeAlias of [symlink, link]) {
      const alias = join(directory, makeAlias === symlink ? 'symlink.json' : 'hardlink.json');
      await makeAlias(snapshot, alias);
      const result = run(['diff', snapshot, snapshot, '--output', alias]);
      expect(result.status).toBe(2); expect(result.stderr).toContain('cannot replace');
      expect(await readFile(snapshot)).toEqual(original);
    }
    const newSnapshot = join(directory, 'new-snapshot.json'), outputAlias = join(directory, 'report.json');
    await symlink(newSnapshot, outputAlias);
    const result = run(['file', source, '--snapshot', newSnapshot, '--output', outputAlias]);
    expect(result.status).toBe(2); expect(result.stderr).toContain('cannot replace');
    expect(JSON.parse(await readFile(newSnapshot, 'utf8')) as unknown).toHaveProperty('format', 'mcplint-metadata-snapshot');
    for (const args of [[], ['--format', 'markdown'], ['--snapshot', join(directory, 'no.json')], ['--fail-on', 'error'], ['--output', snapshot]]) {
      const inputs = args.length ? [snapshot, snapshot] : [snapshot];
      expect(run(['diff', ...inputs, ...args]).status).toBe(2);
    }
    const broken = join(directory, 'broken.json'); await writeFile(broken, Buffer.from([0xff]));
    expect(run(['diff', snapshot, broken]).status).toBe(2);
    await writeFile(broken, '{"format":"wrong"}');
    expect(run(['diff', snapshot, broken]).status).toBe(2);
    const large = await open(broken, 'w'); try { await large.truncate(50 * 1024 * 1024 + 1); } finally { await large.close(); }
    const limited = run(['diff', snapshot, broken]);
    expect(limited.status).toBe(2); expect(limited.stderr).toContain('50 MB');
    expect(await readFile(snapshot)).toEqual(original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
