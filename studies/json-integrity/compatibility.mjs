// Existing repository inputs through both actual CLIs. Run from the repo root.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [beforeArg, afterArg] = process.argv.slice(2);
assert(beforeArg && afterArg, 'Usage: node compatibility.mjs BASELINE_CLI AFTER_CLI');
const before = resolve(beforeArg), after = resolve(afterArg);
const { readJson } = await import(pathToFileURL(resolve(after, '../core/read-json.js')).href);
const sha = x => createHash('sha256').update(x).digest('hex');
const names = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(n => n.endsWith('.json'));
const files = [];
for (const path of names) {
  const bytes = readFileSync(path); let decoded;
  try { decoded = JSON.parse(bytes.toString('utf8')); } catch { continue; }
  assert.deepEqual(readJson(bytes.toString('utf8')), decoded, path);
  files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
}
const inventories = ['examples/highlights.tools.json', 'examples/schema-audit/invalid.json', 'examples/schema-audit/mixed.json',
  'examples/schema-audit/unresolved.json', 'examples/schema-audit/valid.json', 'examples/tools.json',
  'studies/duplicate-names/tools.json', 'studies/metadata-diff/fixtures/minimal.json',
  'tests/fixtures/reference-servers/server-everything.json', 'tests/fixtures/reference-servers/server-filesystem.json', 'tests/fixtures/reference-servers/server-memory.json'];
const snapshots = names.filter(n => n.startsWith('studies/metadata-diff/') && n.endsWith('.snapshot.json'));
const requests = inventories.map(path => ({ name: path, args: ['file', path, '--format', 'json', '--fail-on', 'error'] }));
requests.push(...snapshots.map(path => ({ name: path, args: ['diff', path, path, '--format', 'json'] })));
requests.push({ name: 'retained zod3 to zod4 server captures', args: ['diff', 'studies/metadata-diff/reference/captures/zod3.snapshot.json', 'studies/metadata-diff/reference/captures/zod4.snapshot.json', '--format', 'json'] });
const results = [];
for (const request of requests) {
  const observed = [before, after].map(cli => {
    const result = spawnSync(process.execPath, [cli, ...request.args], { encoding: 'utf8', timeout: 60_000 });
    if (result.error) throw result.error;
    assert(result.stdout, result.stderr);
    const report = JSON.parse(result.stdout); delete report.generatedAt;
    return { exit: result.status, sha256: sha(JSON.stringify(report)), summary: report.summary };
  });
  assert.deepEqual(observed[0], observed[1], request.name);
  results.push({ name: request.name, ...observed[0], identical: true });
}
console.log(JSON.stringify({ scope: 'All tracked syntactically valid JSON decoded without change; 11 inventories, eight existing snapshots and a real saved server-version comparison through both CLIs. Audit generatedAt is the only omitted report field.',
  files: files.length, manifest: files, workflows: results.length, results }, null, 2));
