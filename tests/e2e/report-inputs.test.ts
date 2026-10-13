import { spawnSync } from 'node:child_process';
import { link, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const cli = resolve('dist/cli.js');
const server = resolve('tests/fixtures/servers/echo-environment.mjs');
const run = (cwd: string, args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 20_000 });

for (const kind of ['definitions', 'explicit-config', 'auto-config', 'client-config', 'env-file'] as const) {
  it.each(['direct', 'symlink', 'hardlink', 'parent-symlink'])(`${kind} is protected via %s before any server starts`, async alias => {
    const directory = await mkdtemp(join(tmpdir(), 'mcplint-output-'));
    try {
      await writeFile(join(directory, 'tools.json'), '{"tools":[]}');
      await writeFile(join(directory, 'rules.json'), '{"budget":400}');
      await writeFile(join(directory, 'server.env'), 'FIXTURE_FROM_FILE=synthetic-private-value\n');
      await writeFile(join(directory, 'mcp.json'), JSON.stringify({ servers: { local: {
        command: process.execPath, args: [server], envFile: '${workspaceFolder}/server.env'
      } } }));
      if (kind === 'auto-config') await writeFile(join(directory, '.mcplintrc.json'), '{"budget":400}');
      const source = { definitions: 'tools.json', 'explicit-config': 'rules.json', 'auto-config': '.mcplintrc.json', 'client-config': 'mcp.json', 'env-file': 'server.env' }[kind];
      const original = await readFile(join(directory, source));
      let output = source;
      if (alias === 'symlink') { output = 'alias'; await symlink(source, join(directory, output)); }
      if (alias === 'hardlink') { output = 'alias'; await link(join(directory, source), join(directory, output)); }
      if (alias === 'parent-symlink') { await symlink('.', join(directory, 'parent')); output = `parent/${source}`; }
      const target = kind === 'client-config' || kind === 'env-file' ? ['config', 'mcp.json'] : ['file', 'tools.json'];
      const result = run(directory, [...target, ...(kind === 'explicit-config' ? ['--config', 'rules.json'] : []), '--format', 'json', '--output', output]);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('cannot replace');
      expect(result.stderr).not.toContain('starting local');
      expect(result.stderr).not.toContain('synthetic-private-value');
      expect(await readFile(join(directory, source))).toEqual(original);
      expect(await readFile(join(directory, output))).toEqual(original);
      if (alias === 'symlink') expect((await lstat(join(directory, output))).isSymbolicLink()).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

it.each(['terminal', 'json', 'sarif', 'markdown', 'html'])('ordinary %s report replacement leaves its input intact', async format => {
  const directory = await mkdtemp(join(tmpdir(), 'mcplint-report-format-'));
  try {
    const input = '{"tools":[]}'; await writeFile(join(directory, 'tools.json'), input);
    await writeFile(join(directory, 'report'), 'previous report');
    const result = run(directory, ['file', 'tools.json', '--format', format, '--output', 'report']);
    expect(result.status, result.stderr).toBe(0);
    expect((await readFile(join(directory, 'report'))).length).toBeGreaterThan(20);
    expect(await readFile(join(directory, 'tools.json'), 'utf8')).toBe(input);
    expect((await readdir(directory)).sort()).toEqual(['report', 'tools.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('protects missing env files and all resolved server inputs before launching the first server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcplint-env-destination-'));
  try {
    await writeFile(join(directory, 'mcp.json'), JSON.stringify({ servers: {
      first: { command: process.execPath, args: [server] },
      second: { command: process.execPath, args: [server], envFile: '${input:envPath}' }
    } }));
    for (const flag of ['--output', '--snapshot']) {
      const result = run(directory, ['config', 'mcp.json', '--input', 'envPath=missing.env', flag, 'missing.env']);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain('cannot replace');
      expect(result.stderr).not.toContain('starting ');
      await expect(readFile(join(directory, 'missing.env'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    const ordinary = run(directory, ['config', 'mcp.json', '--input', 'envPath=missing.env', '--fail-on', 'error', '--format', 'json', '--output', 'report.json']);
    expect(ordinary.status, ordinary.stderr).toBe(1);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')) as { summary: { complete: boolean } };
    expect(report.summary.complete).toBe(false); // Missing source still yields the existing incomplete audit.
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('keeps new snapshot/report aliases untouched and preserves existing snapshots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcplint-output-pair-'));
  try {
    await writeFile(join(directory, 'tools.json'), '{"tools":[]}');
    await symlink('.', join(directory, 'parent'));
    const conflict = run(directory, ['file', 'tools.json', '--snapshot', 'new.json', '--output', 'parent/new.json']);
    expect(conflict.status).toBe(2); expect(conflict.stderr).toContain('cannot replace');
    await expect(readFile(join(directory, 'new.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(run(directory, ['file', 'tools.json', '--snapshot', 'snapshot.json', '--output', 'report']).status).toBe(0);
    const snapshot = await readFile(join(directory, 'snapshot.json'));
    expect(run(directory, ['file', 'tools.json', '--snapshot', 'snapshot.json']).status).toBe(2);
    expect(await readFile(join(directory, 'snapshot.json'))).toEqual(snapshot);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
