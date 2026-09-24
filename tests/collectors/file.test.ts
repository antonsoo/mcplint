import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFile } from '../../src/collectors/file.js';

describe('collectFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcplint-file-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts a bare array of tools', async () => {
    const path = join(dir, 'tools.json');
    await writeFile(path, JSON.stringify([{ name: 'a', inputSchema: { type: 'object', properties: {} } }]));
    const target = await collectFile(path);
    expect(target.tools).toHaveLength(1);
  });

  it('tolerates a leading UTF-8 BOM (common in Windows-authored JSON files)', async () => {
    const path = join(dir, 'bom.json');
    await writeFile(path, '﻿' + JSON.stringify([{ name: 'a', inputSchema: { type: 'object', properties: {} } }]));
    const target = await collectFile(path);
    expect(target.tools).toHaveLength(1);
    expect(target.tools[0]!.name).toBe('a');
  });

  it('accepts a {tools, prompts, resources} object (a saved tools/list result)', async () => {
    const path = join(dir, 'result.json');
    await writeFile(
      path,
      JSON.stringify({
        tools: [{ name: 'a', description: 'd', inputSchema: { type: 'object', properties: {} } }],
        prompts: [{ name: 'p', description: 'pd' }],
        resources: [{ name: 'r', uri: 'file:///x' }]
      })
    );
    const target = await collectFile(path);
    expect(target.tools).toHaveLength(1);
    expect(target.prompts).toHaveLength(1);
    expect(target.resources).toHaveLength(1);
  });

  it('throws on invalid JSON', async () => {
    const path = join(dir, 'bad.json');
    await writeFile(path, '{ not json');
    await expect(collectFile(path)).rejects.toThrow(/not valid JSON/);
  });

  it('throws when there is nothing to collect', async () => {
    const path = join(dir, 'empty.json');
    await writeFile(path, JSON.stringify({}));
    await expect(collectFile(path)).rejects.toThrow(/no "tools"/);
  });
});
