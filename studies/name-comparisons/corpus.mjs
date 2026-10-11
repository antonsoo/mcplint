// Replay recorded public registry names in artificial eight-server groups.
// Grouping exercises cross-server checks; it is not a claim about any user's installed config.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [dist = 'dist', output = 'studies/name-comparisons/corpus-after.json', before] = process.argv.slice(2);
const { shadowing } = await import(pathToFileURL(resolve(dist, 'core/rules/naming.js')));
const census = fileURLToPath(new URL('../registry-census/', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const rows = [];
for (const [manifestName, dir] of [['manifest.json', 'servers'], ['manifest-heldout.json', 'heldout']]) {
  const manifestBytes = readFileSync(resolve(census, manifestName));
  const manifest = JSON.parse(manifestBytes);
  const servers = manifest.servers.filter(server => server.tools).map(server => {
    const key = createHash('sha1').update(server.name).digest('hex');
    const bytes = readFileSync(resolve(census, 'cache', dir, key + '.json'));
    const raw = JSON.parse(bytes);
    assert.ok(raw.tools.every(t => typeof t.name === 'string'));
    return { id: server.name, sha256: hash(bytes), names: raw.tools.map(t => t.name) };
  });
  const groups = [];
  const start = performance.now();
  for (let offset = 0; offset < servers.length; offset += 8) {
    const group = servers.slice(offset, offset + 8);
    const target = { servers: group.map(s => ({ id: s.id, label: s.id })),
      tools: group.flatMap(s => s.names.map(name => ({ kind: 'tool', serverId: s.id, name, inputSchema: {} }))), prompts: [], resources: [] };
    const findings = shadowing.check({ target, config: {} });
    groups.push({ offset, servers: group.length, tools: target.tools.length, findings: findings.length,
      findingsSha256: hash(JSON.stringify(findings)) });
  }
  rows.push({ manifest: manifestName, manifestSha256: hash(manifestBytes), servers: servers.map(({ names, ...s }) => ({ ...s, tools: names.length })), groups, elapsedMs: performance.now() - start });
}
if (before) {
  const old = JSON.parse(readFileSync(before));
  const stable = data => data.results.map(({ elapsedMs, ...row }) => row);
  assert.deepEqual(stable({ results: rows }), stable(old));
}
writeFileSync(output, JSON.stringify({ node: process.version, results: rows, unchangedFromBaseline: before ? true : null }, null, 2) + '\n');
console.log(rows.map(r => ({ manifest: r.manifest, servers: r.servers.length, tools: r.groups.reduce((n, g) => n + g.tools, 0), groups: r.groups.length, findings: r.groups.reduce((n, g) => n + g.findings, 0), elapsedMs: Math.round(r.elapsedMs) })));
