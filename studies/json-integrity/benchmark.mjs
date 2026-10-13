// Parsing cost only, on a constructed 5,000-definition inventory; no audit timing claim.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus, availableParallelism, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { readJson } = await import(pathToFileURL(resolve(process.argv[2] ?? 'dist/core/read-json.js')).href);
const seed = JSON.parse(readFileSync('studies/metadata-diff/fixtures/minimal.json', 'utf8')).tools[0];
const text = JSON.stringify({ tools: Array.from({ length: 5000 }, (_, i) => ({ ...seed, name: `read_record_${i}`, _meta: { position: i, confidence: 0.1, nested: [{ x: i }, { x: i + 1 }] } })) });
assert.deepEqual(readJson(text), JSON.parse(text));
const samples = { native: [], checked: [] };
for (let i = 0; i < 8; i++) {
  for (const [label, parser] of (i % 2 ? [['checked', readJson], ['native', JSON.parse]] : [['native', JSON.parse], ['checked', readJson]])) {
    globalThis.gc?.(); const start = performance.now(); const parsed = parser(text);
    assert.equal(parsed.tools.length, 5000);
    const elapsed = performance.now() - start;
    if (i >= 2) samples[label].push(elapsed);
  }
}
const median = values => { const a = [...values].sort((x, y) => x - y); return (a[2] + a[3]) / 2; };
console.log(JSON.stringify({ scope: 'Synthetic inventory; parsing only. Two warmups, six alternating timed samples, explicit GC before each when available. Shared-host timings are descriptive, not a regression threshold.',
  node: process.version, machine: { platform: platform(), release: release(), cpu: cpus()[0].model, available_cpus: availableParallelism() },
  tools: 5000, bytes: Buffer.byteLength(text), input_sha256: createHash('sha256').update(text).digest('hex'),
  samples_ms: samples, median_ms: { native: median(samples.native), checked: median(samples.checked) } }, null, 2));
