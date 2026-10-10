// Replay only the changed documentation rule, not a new whole-server security audit.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [before, after = '.', output = 'studies/required-properties/corpus.json'] = process.argv.slice(2);
if (!before) throw new Error('Usage: corpus.mjs <baseline-repo> [corrected-repo] [output.json]');
const rule = async root => (await import(pathToFileURL(join(resolve(root), 'dist/core/rules/descriptions.js')))).requiredUndeclared;
const rules = [await rule(before), await rule(after)];
const here = dirname(fileURLToPath(import.meta.url));
const census = join(here, '../registry-census');
const sha = data => createHash('sha256').update(data).digest('hex');
const counts = [{ error: 0, warning: 0 }, { error: 0, warning: 0 }];
let tools = 0;
const sources = [], changed = [];
for (const [directory, manifest] of [['servers', 'manifest.json'], ['heldout', 'manifest-heldout.json']]) {
  const manifestBytes = readFileSync(join(census, manifest));
  sources.push({ file: manifest, sha256: sha(manifestBytes) });
  for (const server of JSON.parse(manifestBytes).servers) {
    if (!server.tools) continue;
    const filename = createHash('sha1').update(server.name).digest('hex') + '.json';
    const bytes = readFileSync(join(census, 'cache', directory, filename));
    sources.push({ file: `cache/${directory}/${filename}`, sha256: sha(bytes) });
    for (const raw of JSON.parse(bytes).tools) {
      tools++;
      const target = { servers: [{ id: server.name, label: server.name }], prompts: [], resources: [],
        tools: [{ ...raw, kind: 'tool', serverId: server.name }] };
      const observations = rules.map((rule, i) => {
        const findings = rule.check({ target });
        for (const f of findings) counts[i][f.severity]++;
        return findings.map(f => ({ severity: f.severity, message: f.message }));
      });
      if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) {
        changed.push({ server: server.name, tool: raw.name, schemaSha256: sha(JSON.stringify(raw.inputSchema)),
          before: observations[0], after: observations[1] });
      }
    }
  }
}
const result = { scope: 'Only description/required-undeclared; cached registry snapshots, no live servers contacted.',
  node: process.version, tools, counts: { before: counts[0], after: counts[1] }, changed, sources };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ tools, counts, changedTools: changed.length }));
