// Compare one pinned official server under two retained dependency resolutions.
// Install the supplied locks separately before running; this script never installs packages.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [zod3, zod4, destination, executable] = process.argv.slice(2);
assert.ok(zod3 && zod4 && destination, 'Usage: node studies/metadata-diff/reference.mjs <zod3-install> <zod4-install> <output> [cli]');
const output = resolve(destination), cli = resolve(executable ?? join(root, 'dist/cli.js'));
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-reference-'));
const allowed = join(scratch, 'empty-root'); await mkdir(allowed);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Independent JSON-RPC probe: no MCP SDK or mcplint parsing code, no tools/call.
async function probe(server) {
  const child = spawn(process.execPath, [server, allowed], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const replies = new Map(), pending = new Map(), transcript = [];
  let id = 0;
  const timer = setTimeout(() => child.kill(), 20_000);
  const closed = new Promise(resolveClose => child.once('close', resolveClose));
  child.on('error', error => { for (const pair of pending.values()) pair.reject(error); });
  child.on('close', () => { for (const pair of pending.values()) pair.reject(new Error('Server closed before replying')); });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) {
        const method = replies.get(message.id);
        transcript.push({ method, response: message });
        const pair = pending.get(message.id);
        if (pair) { pending.delete(message.id); message.error ? pair.reject(new Error(JSON.stringify(message.error))) : pair.resolve(message.result); }
      }
    } catch (error) { for (const pair of pending.values()) pair.reject(error); }
  });
  function request(method, params) {
    const next = ++id; replies.set(next, method);
    return new Promise((resolveRequest, reject) => {
      pending.set(next, { resolve: resolveRequest, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
    });
  }
  try {
    const initialized = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'independent-metadata-probe', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = []; let cursor; const seen = new Set();
    do {
      const result = await request('tools/list', cursor === undefined ? {} : { cursor });
      assert.ok(Array.isArray(result.tools)); tools.push(...result.tools); cursor = result.nextCursor;
      if (cursor !== undefined) { assert.equal(typeof cursor, 'string'); assert.ok(!seen.has(cursor)); seen.add(cursor); assert.ok(seen.size < 100); }
    } while (cursor !== undefined);
    return { initialized, tools, transcript };
  } finally { clearTimeout(timer); lines.close(); child.kill(); await closed; }
}

try {
  const installations = { zod3: resolve(zod3), zod4: resolve(zod4) }, evidence = {};
  const locks = {};
  for (const [name, installation] of Object.entries(installations)) {
    locks[name] = JSON.parse(await readFile(join(installation, 'package-lock.json')));
    const server = join(installation, 'node_modules/@modelcontextprotocol/server-filesystem/dist/index.js');
    const wire = await probe(server);
    const config = join(scratch, `${name}.json`);
    await writeFile(config, JSON.stringify({ mcpServers: { filesystem: { command: process.execPath, args: [server, allowed] } } }));
    const snapshotPath = join(output, `${name}.snapshot.json`); await rm(snapshotPath, { force: true });
    const audit = spawnSync(process.execPath, [cli, 'config', config, '--snapshot', snapshotPath, '--format', 'json'], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(audit.status, 0, audit.stderr);
    const snapshot = JSON.parse(await readFile(snapshotPath));
    assert.deepEqual(snapshot.definitions.map(entry => entry.value), wire.tools);
    assert.deepEqual(snapshot.servers[0].serverInfo, wire.initialized.serverInfo);
    assert.deepEqual(snapshot.servers[0].capabilities, wire.initialized.capabilities);
    assert.ok(!JSON.stringify(snapshot).includes(scratch));
    await writeFile(join(output, `${name}.wire.jsonl`), wire.transcript.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    evidence[name] = { node: process.version, serverCompiledSha256: sha256(await readFile(server)),
      packageLockSha256: sha256(await readFile(join(installation, 'package-lock.json'))),
      serverVersion: locks[name].packages['node_modules/@modelcontextprotocol/server-filesystem'].version,
      zodVersion: locks[name].packages['node_modules/zod'].version,
      definitions: wire.tools.length, rawProbeMatchesSnapshot: true, toolsCalled: 0,
      readTextFileSchema: wire.tools.find(tool => tool.name === 'read_text_file').inputSchema };
  }
  const changedPackages = [...new Set([...Object.keys(locks.zod3.packages), ...Object.keys(locks.zod4.packages)])]
    .filter(key => key && JSON.stringify(locks.zod3.packages[key]) !== JSON.stringify(locks.zod4.packages[key]));
  assert.deepEqual(changedPackages, ['node_modules/zod']);
  assert.equal(evidence.zod3.serverCompiledSha256, evidence.zod4.serverCompiledSha256);
  assert.ok(evidence.zod3.readTextFileSchema.properties.path);
  assert.deepEqual(Object.keys(evidence.zod4.readTextFileSchema), ['$schema']);
  const comparison = spawnSync(process.execPath, [cli, 'diff', join(output, 'zod3.snapshot.json'), join(output, 'zod4.snapshot.json'), '--format', 'json'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(comparison.status, 1, comparison.stderr);
  const diff = JSON.parse(comparison.stdout); assert.equal(diff.complete, true);
  // The no-argument list_allowed_directories schema is already empty in both.
  assert.equal(diff.summary.changed, 13);
  await writeFile(join(output, 'dependency.diff.json'), comparison.stdout);
  await writeFile(join(output, 'observations.json'), JSON.stringify({ package: '@modelcontextprotocol/server-filesystem@2025.8.21',
    interpretation: 'Current fresh installs of one historical package under two dependency resolutions, not a reconstruction of its original publication environment.',
    changedPackageRecords: changedPackages, evidence, comparison: { exit: comparison.status, complete: diff.complete, summary: diff.summary } }, null, 2) + '\n');
  console.log(JSON.stringify({ changedPackages, ...diff.summary }));
} finally { await rm(scratch, { recursive: true, force: true }); }
