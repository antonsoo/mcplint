import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET, effectiveSeverity, isIgnored, loadConfigFile, resolveConfig } from '../src/core/config.js';
import { baseConfig } from './helpers.js';

describe('resolveConfig', () => {
  it('falls back to DEFAULT_BUDGET with no file or flag', () => {
    expect(resolveConfig({ file: {} }).budget).toBe(DEFAULT_BUDGET);
  });

  it('prefers the CLI flag over the config file budget', () => {
    const config = resolveConfig({ file: { budget: 100 }, budgetFlag: 250 });
    expect(config.budget).toBe(250);
  });

  it('merges ignore entries from file and flags', () => {
    const config = resolveConfig({ file: { ignore: ['a'] }, ignoreFlags: ['b'] });
    expect(config.ignore.has('a')).toBe(true);
    expect(config.ignore.has('b')).toBe(true);
  });
});

describe('effectiveSeverity / isIgnored', () => {
  it('returns the default severity when unset', () => {
    expect(effectiveSeverity(baseConfig(), 'x', 'warning')).toBe('warning');
  });

  it('returns the configured override', () => {
    const config = baseConfig({ severities: { x: 'off' } });
    expect(effectiveSeverity(config, 'x', 'warning')).toBe('off');
  });

  it('matches a bare rule id or a rule:subject pair', () => {
    const config = baseConfig({ ignore: new Set(['x', 'y:sub']) });
    expect(isIgnored(config, 'x', 'anything')).toBe(true);
    expect(isIgnored(config, 'y', 'sub')).toBe(true);
    expect(isIgnored(config, 'y', 'other')).toBe(false);
    expect(isIgnored(config, 'z', 'anything')).toBe(false);
  });
});

describe('loadConfigFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcplint-config-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns {} when no config file exists', async () => {
    expect(await loadConfigFile(dir)).toEqual({});
  });

  it('reads .mcplintrc.json from the given directory', async () => {
    await writeFile(join(dir, '.mcplintrc.json'), JSON.stringify({ budget: 321 }));
    expect(await loadConfigFile(dir)).toEqual({ budget: 321 });
  });

  it('throws a clear error on invalid JSON', async () => {
    const path = join(dir, '.mcplintrc.json');
    await writeFile(path, '{ not json');
    await expect(loadConfigFile(dir)).rejects.toThrow(/Failed to parse/);
  });
});
