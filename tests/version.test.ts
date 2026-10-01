import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

describe('VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

describe('the CLI flags that take no target', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { encoding: 'utf8' });

  it('--version and -v print just the version and exit 0', () => {
    for (const flag of ['--version', '-v']) {
      const result = run(flag);
      expect(result.stdout).toBe(`${VERSION}\n`);
      expect(result.status).toBe(0);
    }
  });

  it('--help exits 0, and no arguments at all prints the help and exits 1', () => {
    expect(run('--help').status).toBe(0);
    const bare = run();
    expect(bare.stdout).toContain('Usage:');
    expect(bare.status).toBe(1);
  });
});
