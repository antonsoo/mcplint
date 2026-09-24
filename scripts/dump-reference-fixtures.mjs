#!/usr/bin/env node
/**
 * Captures the raw, unvalidated `tools/list` (+ prompts/resources where
 * supported) response from each official reference server, straight off the
 * wire with no SDK-side schema filtering, into tests/fixtures/reference-servers/.
 * These are used both as `mcplint file` regression fixtures and as the
 * ground truth for manually auditing every rule's findings against a real,
 * Anthropic-maintained server (see README "Real-world run").
 *
 * Usage: node scripts/dump-reference-fixtures.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'tests', 'fixtures', 'reference-servers');

const RAW = z.object({}).passthrough();

const SERVERS = [
  { name: 'server-everything', args: ['-y', '@modelcontextprotocol/server-everything', 'stdio'] },
  { name: 'server-filesystem', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
  { name: 'server-memory', args: ['-y', '@modelcontextprotocol/server-memory'] }
];

async function dump({ name, args }) {
  const transport = new StdioClientTransport({ command: 'npx', args });
  const client = new Client({ name: 'mcplint-fixture-dump', version: '0.0.0' });
  await client.connect(transport);

  const out = { _capturedFrom: name, _capturedAt: new Date().toISOString().slice(0, 10) };
  for (const method of ['tools/list', 'prompts/list', 'resources/list']) {
    try {
      out[method.split('/')[0]] = (await client.request({ method, params: {} }, RAW))[method.split('/')[0]] ?? [];
    } catch {
      out[method.split('/')[0]] = [];
    }
  }
  await client.close();

  const file = join(outDir, `${name}.json`);
  await writeFile(file, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`wrote ${file} (${out.tools?.length ?? 0} tools, ${out.prompts?.length ?? 0} prompts, ${out.resources?.length ?? 0} resources)`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const server of SERVERS) await dump(server);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
