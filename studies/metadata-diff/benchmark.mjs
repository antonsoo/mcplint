import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { compareMetadata } from '../../dist/index.js';
const before = JSON.parse(await readFile(new URL('./results/before.snapshot.json', import.meta.url)));
before.servers = [{ id: 'synthetic-benchmark' }];
before.collection = [{ serverId: 'synthetic-benchmark', scope: 'tools/list', status: 'complete', pages: 4, received: 4000, retained: 4000 }];
before.definitions = Array.from({ length: 4000 }, (_, i) => ({ serverId: 'synthetic-benchmark', scope: 'tools/list', value: {
  name: `tool_${i}`, description: 'Synthetic benchmark definition. '.repeat(10),
  inputSchema: { type: 'object', properties: Object.fromEntries(Array.from({ length: 10 }, (_, j) => [`parameter_${j}`, { type: 'integer', maximum: 100 }])) },
} }));
const after = structuredClone(before);
for (let i = 0; i < after.definitions.length; i += 10) after.definitions[i].value.inputSchema.properties.parameter_0.maximum = 200;
const times = [];
for (let run = 0; run < 6; run++) {
  const start = performance.now(); const result = compareMetadata(before, after);
  if (run) times.push(performance.now() - start);
  assert.equal(result.complete, true); assert.equal(result.summary.changed, 400); assert.equal(result.summary.unchanged, 3601);
}
const result = { workload: 'Synthetic; 4,000 definitions, ten parameters each, 400 changed bounds. In-memory comparison only, excluding collection, file decoding and HTML rendering.',
  node: process.version, platform: process.platform, arch: process.arch, cpus: cpus().length, memoryGiB: +(totalmem() / 1024 ** 3).toFixed(1),
  beforeBytes: Buffer.byteLength(JSON.stringify(before)), afterBytes: Buffer.byteLength(JSON.stringify(after)),
  samplesMs: times, medianMs: [...times].sort((a, b) => a - b)[2] };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
