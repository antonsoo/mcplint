// Schema rule only, using the same retained registry corpus. Run in a fresh process per build.
// node --expose-gc studies/schema-audit/benchmark.mjs <dist/index.js> <result.json>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!globalThis.gc) throw new Error('Run Node with --expose-gc');
const [library, output] = process.argv.slice(2);
if (!library || !output) throw new Error('Usage: benchmark.mjs <dist/index.js> <result.json>');
const { allRules, resolveConfig } = await import(pathToFileURL(resolve(library)).href);
const rule = allRules.find(rule => rule.id === 'schema/invalid');
const config = resolveConfig({ file: {} });
const census = join(dirname(fileURLToPath(import.meta.url)), '../registry-census');
const manifests = [['servers', 'manifest.json'], ['heldout', 'manifest-heldout.json']];
async function collectGarbage() {
  // Allow dead compiler frames and weak references to leave the current job before measuring.
  for (let round = 0; round < 3; round++) {
    await new Promise(resolve => setImmediate(resolve));
    globalThis.gc();
  }
}
await collectGarbage();
const initialHeap = process.memoryUsage().heapUsed;
let peakRss = process.memoryUsage().rss, tools = 0, outputs = 0, findings = 0;
const started = performance.now();
for (const [directory, manifest] of manifests) {
  for (const server of JSON.parse(readFileSync(join(census, manifest), 'utf8')).servers) {
    if (!server.tools) continue;
    const filename = createHash('sha1').update(server.name).digest('hex') + '.json';
    const data = JSON.parse(readFileSync(join(census, 'cache', directory, filename), 'utf8'));
    const target = { servers: [{ id: server.name, label: server.name }], prompts: [], resources: [],
      tools: data.tools.map(tool => ({ ...tool, kind: 'tool', serverId: server.name })) };
    tools += target.tools.length;
    outputs += target.tools.filter(tool => tool.outputSchema !== undefined).length;
    findings += rule.check({ target, config }).length;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
}
const elapsedMs = performance.now() - started;
await collectGarbage();
const result = { node: process.version, tools, outputs, findings, elapsedMs,
  initialHeapBytes: initialHeap, retainedHeapBytes: process.memoryUsage().heapUsed,
  peakRssBytes: peakRss };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
