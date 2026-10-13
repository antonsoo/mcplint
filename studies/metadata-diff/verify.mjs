import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = resolve(process.argv[2] ?? join(root, 'dist/cli.js'));
const output = resolve(process.argv[3] ?? join(root, 'studies/metadata-diff/results'));
await mkdir(output, { recursive: true });
const snapshots = {}, audits = {}, comparisons = {};
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30_000 });
for (const revision of ['before', 'contract', 'after', 'reordered', 'partial', 'duplicate']) {
  const path = join(output, `${revision}.snapshot.json`);
  const transcript = join(output, `${revision}.transcript.jsonl`);
  await rm(path, { force: true }); await rm(transcript, { force: true });
  const audit = run(['stdio', '--format', 'json', '--snapshot', path, '--', process.execPath, join(root, 'studies/metadata-diff/server.mjs'), revision, transcript]);
  assert.equal(audit.status, 0, audit.stderr);
  const parsed = JSON.parse(audit.stdout);
  audits[revision] = { summary: parsed.summary, findings: parsed.findings };
  const snapshot = JSON.parse(await readFile(path));
  const replies = (await readFile(transcript, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const wire = replies.flatMap(reply => Object.values(reply.response).filter(Array.isArray).flat().map(value => ({ serverId: 'metadata-review-fixture', scope: reply.method, value })));
  assert.deepEqual(snapshot.definitions, wire);
  assert.equal(snapshot.servers[0].serverInfo.name, 'metadata-review-fixture');
  assert.ok(!JSON.stringify(snapshot).includes(root));
  assert.ok(!JSON.stringify(snapshot).includes(process.execPath));
  snapshots[revision] = path;
}
for (const revision of ['contract', 'after', 'reordered', 'partial', 'duplicate']) {
  const result = run(['diff', snapshots.before, snapshots[revision], '--format', 'json']);
  const comparison = JSON.parse(result.stdout);
  comparisons[revision] = { exit: result.status, ...comparison };
  assert.equal(result.status, revision === 'reordered' ? 0 : ['partial', 'duplicate'].includes(revision) ? 2 : 1, result.stderr);
  if (revision === 'contract') {
    assert.deepEqual(comparison.summary, { added: 0, removed: 0, changed: 2, unchanged: 5, unpaired: 0 });
    assert.ok(comparison.changes.every(change => change.fields.length === 1 && change.fields[0].pointer === '/inputSchema/properties/limit/maximum'
      && change.fields[0].before.value === 100 && change.fields[0].after.value === 200));
  }
  if (revision === 'reordered') { assert.equal(comparison.complete, true); assert.equal(comparison.changes.length, 0); }
  if (revision === 'partial') { assert.equal(comparison.complete, false); assert.equal(comparison.summary.removed, 0); assert.equal(comparison.summary.unpaired, 1); }
  if (revision === 'duplicate') { assert.equal(comparison.complete, false); assert.ok(comparison.issues.some(issue => issue.includes('duplicate identity'))); }
  if (revision === 'after') {
    assert.deepEqual(comparison.summary, { added: 1, removed: 1, changed: 5, unchanged: 1, unpaired: 0 });
    assert.ok(comparison.changes.some(change => change.scope === 'resources/list' && change.identity === 'fixture:///catalog'));
    assert.ok(!comparison.changes.some(change => change.identity === 'fixture:///policy'));
    assert.ok(comparison.changes.some(change => change.fields.some(field => field.pointer === '/_meta/fixture~1review')));
  }
  if (['after', 'partial'].includes(revision)) {
    const html = run(['diff', snapshots.before, snapshots[revision], '--format', 'html', '--output', join(output, `${revision}.html`)]);
    assert.equal(html.status, result.status, html.stderr);
  }
  await writeFile(join(output, `${revision}.diff.json`), JSON.stringify(comparison, null, 2) + '\n');
}
const original = await readFile(snapshots.before);
const refused = run(['file', join(root, 'studies/metadata-diff/fixtures/minimal.json'), '--snapshot', snapshots.before]);
assert.equal(refused.status, 2);
assert.deepEqual(await readFile(snapshots.before), original);
await writeFile(join(output, 'observations.json'), JSON.stringify({ workload: 'Actual SDK metadata collection; controlled revisions; no tools called', audits,
  comparisons: Object.fromEntries(Object.entries(comparisons).map(([key, value]) => [key, { exit: value.exit, complete: value.complete, summary: value.summary, issues: value.issues }])),
  snapshotOverwriteRefused: true }, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(comparisons).map(([key, value]) => [key, { exit: value.exit, complete: value.complete, summary: value.summary }]))));
