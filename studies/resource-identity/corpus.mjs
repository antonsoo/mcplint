// Check retained resource metadata against both collectors. No live servers contacted.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const [baseline] = process.argv.slice(2);
if (!baseline) throw new Error('Usage: corpus.mjs <compiled-baseline-root>');
const old = (await import(pathToFileURL(join(resolve(baseline), 'dist/collectors/items.js')))).appendItems;
const current = (await import('../../dist/collectors/items.js')).appendItems;
const census = fileURLToPath(new URL('../registry-census/', import.meta.url));
const receipts = JSON.parse(readFileSync(new URL('../required-properties/corpus.json', import.meta.url)));
const results = { serversWithResources: 0, resources: 0, templates: 0, missingRequiredIdentity: 0, changedCollections: 0 };
for (const source of receipts.sources) {
  const bytes = readFileSync(join(census, source.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  if (!source.file.startsWith('cache/')) continue;
  const data = JSON.parse(bytes);
  if (data.resources?.length) results.serversWithResources++;
  for (const [key, field] of [['resources', 'uri'], ['resourceTemplates', 'uriTemplate']]) {
    const items = data[key];
    if (!Array.isArray(items)) continue;
    results[key === 'resources' ? 'resources' : 'templates'] += items.length;
    results.missingRequiredIdentity += items.filter(item => typeof item?.[field] !== 'string').length;
    const observations = [old, current].map(append => {
      const target = { servers: [], tools: [], prompts: [], resources: [] };
      const record = { serverId: 'snapshot', scope: key, status: 'complete', pages: 1, received: items.length, retained: 0 };
      append(target, key, items, record);
      return { target, record };
    });
    if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) results.changedCollections++;
  }
}
const result = { scope: 'Cached registry resource metadata, no URI dereferencing or body reads.',
  inputHashes: '../required-properties/corpus.json', node: process.version, ...results };
writeFileSync(new URL('corpus.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
