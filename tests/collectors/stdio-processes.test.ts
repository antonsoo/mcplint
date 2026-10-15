import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { collectStdio } from '../../src/collectors/stdio.js';
import { ConnectionTimeoutError } from '../../src/collectors/connect.js';

const require = createRequire(import.meta.url);
const modules = ['mcp', 'stdio'].map(name => pathToFileURL(require.resolve(`@modelcontextprotocol/sdk/server/${name}.js`)).href);
const fixtures = fileURLToPath(new URL('../../studies/stdio-processes/fixtures/', import.meta.url));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function live(pid: number): Promise<boolean> {
  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function setup(mode: string, launcher: 'direct' | 'npm' | 'exited-wrapper' = 'npm') {
  const directory = await mkdtemp(join(tmpdir(), 'mcplint-process-test-'));
  cleanups.push(async () => {
    for (const file of ['server.pid', 'helper.pid']) {
      try { process.kill(Number(await readFile(join(directory, file), 'utf8')), 'SIGKILL'); } catch { /* already stopped */ }
    }
    await delay(50);
    await rm(directory, { recursive: true, force: true });
  });
  const args = [directory, mode, ...modules];
  const options = {
    command: launcher === 'npm' ? 'npm' : process.execPath,
    args: launcher === 'npm' ? ['run', '--silent', '--prefix', fixtures, 'server', '--', ...args]
      : [join(fixtures, launcher === 'direct' ? 'server.mjs' : 'wrapper.mjs'), ...args],
    connectTimeoutMs: mode === 'stalled' || launcher === 'exited-wrapper' ? 1500 : 5000,
  };
  return {
    options,
    pid: async () => Number(await readFile(join(directory, 'server.pid'), 'utf8')),
    helperPid: async () => Number(await readFile(join(directory, 'helper.pid'), 'utf8')),
    events: async () => (await readFile(join(directory, 'events.jsonl'), 'utf8'))
      .trim().split('\n').map(line => (JSON.parse(line) as { event: string }).event),
    heartbeat: async () => (await readFile(join(directory, 'heartbeat'))).length,
  };
}

describe.skipIf(process.platform === 'win32')('owned POSIX stdio processes, actual native MCP and npm', () => {
  for (const launcher of ['direct', 'npm'] as const) {
    it(`lets ${launcher} exit on EOF before sending a signal`, async () => {
      const fixture = await setup('graceful', launcher);
      const target = await collectStdio(fixture.options);
      expect(target.tools.map(tool => tool.name)).toEqual(['read_fixture_status']);
      expect(await live(await fixture.pid())).toBe(false);
      expect(await fixture.events()).toEqual(['stdin:end', 'exit:0']);
    }, 12_000);
  }

  for (const mode of ['lingering', 'resistant']) {
    it(`stops the ${mode} server behind npm after collecting tools`, async () => {
      const control = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      await new Promise<void>((resolve, reject) => { control.once('spawn', resolve); control.once('error', reject); });
      cleanups.push(() => new Promise<void>(resolve => {
        control.once('close', () => resolve());
        control.kill('SIGKILL');
      }));
      const fixture = await setup(mode);
      const target = await collectStdio(fixture.options);
      expect(target.tools.map(tool => tool.name)).toEqual(['read_fixture_status']);
      expect(target.collection?.find(coverage => coverage.scope === 'tools/list')?.status).toBe('complete');
      expect(await live(await fixture.pid())).toBe(false);
      const bytes = await fixture.heartbeat();
      await delay(120);
      expect(await fixture.heartbeat()).toBe(bytes);
      expect(await fixture.events()).toContain(mode === 'resistant' ? 'SIGTERM:ignored' : 'SIGTERM');
      expect(await live(control.pid!)).toBe(true);
    }, 12_000);
  }

  it('joins descendant cleanup after a failed initialization', async () => {
    const fixture = await setup('stalled');
    await expect(collectStdio(fixture.options)).rejects.toBeInstanceOf(ConnectionTimeoutError);
    expect(await live(await fixture.pid())).toBe(false);
    expect(await fixture.events()).toContain('SIGTERM');
  }, 12_000);

  it('still stops the group when the original launcher has already exited', async () => {
    const fixture = await setup('resistant', 'exited-wrapper');
    await expect(collectStdio(fixture.options)).rejects.toThrow();
    expect(await live(await fixture.pid())).toBe(false);
    expect(await fixture.events()).toContain('SIGTERM:ignored');
  }, 12_000);

  it('stops a background helper even after the server exits and closes all its pipes', async () => {
    const fixture = await setup('background', 'direct');
    const target = await collectStdio(fixture.options);
    expect(target.tools.map(tool => tool.name)).toEqual(['read_fixture_status']);
    expect(await live(await fixture.pid())).toBe(false);
    expect(await live(await fixture.helperPid())).toBe(false);
    expect(await fixture.events()).toContain('helper:SIGTERM');
  }, 12_000);

  it('joins group cleanup when the live-JSON guard closed the connection first', async () => {
    const fixture = await setup('damaged');
    const target = await collectStdio(fixture.options);
    expect(target.tools).toHaveLength(0);
    expect(target.collection?.find(coverage => coverage.scope === 'tools/list')?.status).toBe('incomplete');
    expect(await live(await fixture.pid())).toBe(false);
    expect(await fixture.events()).toContain('SIGTERM');
  }, 12_000);
});
