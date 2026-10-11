// Replay saved public registry snapshots, never connecting to the listed servers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [dist = 'dist', output = 'studies/duplicate-names/corpus.json', baseline] = process.argv.slice(2);
const current = await import(pathToFileURL(resolve(dist, 'core/rules/naming.js')));
const previous = baseline ? await import(pathToFileURL(resolve(baseline, 'core/rules/naming.js'))) : undefined;
const census = fileURLToPath(new URL('../registry-census/', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const results = [];
for (const [manifestName, dir] of [['manifest.json', 'servers'], ['manifest-heldout.json', 'heldout']]) {
  const bytes = readFileSync(resolve(census, manifestName));
  const manifest = JSON.parse(bytes);
  const inputs = []; const duplicates = []; const unchanged = [];
  let toolCount = 0;
  for (const server of manifest.servers.filter(s => s.tools)) {
    const key = createHash('sha1').update(server.name).digest('hex');
    const snapshot = readFileSync(resolve(census, 'cache', dir, key + '.json'));
    const tools = JSON.parse(snapshot).tools;
    toolCount += tools.length;
    inputs.push({ server: server.name, sha256: hash(snapshot) });
    const ctx = { target: { servers: [{ id: server.name, label: server.name }],
      tools: tools.map(t => ({ ...t, kind: 'tool', serverId: server.name })), prompts: [], resources: [] }, config: {} };
    // Independent direct occurrence count over the original wire entries.
    const expected = [...new Set(tools.map(t => t.name))].filter(name => tools.filter(t => t.name === name).length > 1);
    const found = current.collision.check(ctx);
    assert.deepEqual(found.map(f => f.subject.name), expected);
    assert.ok(found.every(f => f.serverId === server.name && f.severity === 'error'));
    if (previous) {
      assert.equal(previous.collision.check(ctx).length, 0);
      for (const rule of current.rules.filter(r => r.id !== 'naming/collision')) {
        const findings = rule.check(ctx);
        assert.deepEqual(findings, previous.rules.find(r => r.id === rule.id).check(ctx));
        unchanged.push({ server: server.name, ruleId: rule.id, findings });
      }
    }
    for (const name of expected) {
      const entries = tools.filter(t => t.name === name);
      duplicates.push({ server: server.name, name, count: entries.length,
        distinctDescriptions: new Set(entries.map(t => t.description)).size,
        distinctSchemas: new Set(entries.map(t => JSON.stringify(t.inputSchema))).size,
        sourceSha256: hash(snapshot) });
    }
  }
  results.push({ manifest: manifestName, manifestSha256: hash(bytes), servers: inputs.length, tools: toolCount,
    inputsSha256: hash(JSON.stringify(inputs)), duplicates, otherNamingRulesUnchanged: previous ? true : null,
    otherNamingFindingsSha256: previous ? hash(JSON.stringify(unchanged)) : null });
}
writeFileSync(output, JSON.stringify({ node: process.version, results }, null, 2) + '\n');
console.log(results.map(({ duplicates, ...r }) => ({ ...r, duplicateNames: duplicates.length })));
