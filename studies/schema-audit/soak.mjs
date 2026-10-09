// Equal-work memory check: 5,000 distinct synthetic input schemas in one process.
// node --expose-gc studies/schema-audit/soak.mjs <dist/index.js> <result.json>
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [library, output] = process.argv.slice(2);
if (!library || !output || !globalThis.gc) throw new Error('Usage: node --expose-gc soak.mjs <dist/index.js> <result.json>');
const { allRules, resolveConfig } = await import(pathToFileURL(resolve(library)).href);
const rule = allRules.find(rule => rule.id === 'schema/invalid');
const config = resolveConfig({ file: {} });
const samples = [];
async function sample(schemas) {
  for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); globalThis.gc(); }
  samples.push({ schemas, heapBytes: process.memoryUsage().heapUsed });
}
function batch(offset) {
  for (let index = offset; index < offset + 500; index++) {
    const schema = { $id: `https://example.invalid/schema-${index}`, type: 'object',
      properties: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field_${i}`, { type: 'string', description: `Record field ${i}.` }])) };
    const target = { servers: [{ id: 'synthetic', label: 'synthetic' }], prompts: [], resources: [],
      tools: [{ kind: 'tool', name: 'read_record', serverId: 'synthetic', inputSchema: schema }] };
    assert.deepEqual(rule.check({ target, config }), []);
  }
}
await sample(0);
const started = performance.now();
for (let offset = 0; offset < 5000; offset += 500) { batch(offset); await sample(offset + 500); }
const result = { node: process.version, elapsedMs: performance.now() - started, samples };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
