// Full old/new audits over the retained native census, with no server launches.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const [beforePath, afterPath, output] = process.argv.slice(2);
if (!beforePath || !afterPath || !output) throw new Error('Usage: corpus.mjs BEFORE_INDEX AFTER_INDEX OUTPUT.json.gz');
const before = await import(pathToFileURL(resolve(beforePath)).href);
const after = await import(pathToFileURL(resolve(afterPath)).href);
const { readJson } = await import(pathToFileURL(join(dirname(resolve(afterPath)), 'core/read-json.js')).href);
const directory = dirname(fileURLToPath(import.meta.url));
const census = join(directory, '../registry-census');
const scratch = await mkdtemp('/tmp/claude-1000/mcplint-speed-corpus-');
const hash = raw => createHash('sha256').update(raw).digest('hex');
const results = [];
try {
  for (const [folder, filename] of [['servers', 'manifest.json'], ['heldout', 'manifest-heldout.json']]) {
    const manifest = JSON.parse(await readFile(join(census, filename), 'utf8'));
    for (const server of manifest.servers) {
      if (!server.tools) continue;
      const filename = createHash('sha1').update(server.name).digest('hex') + '.json';
      const raw = await readFile(join(census, 'cache', folder, filename));
      const detail = readJson(raw.toString('utf8'));
      const path = join(scratch, 'tools.json');
      await writeFile(path, JSON.stringify({ tools: detail.tools,
        ...(Array.isArray(detail.prompts) ? { prompts: detail.prompts } : {}),
        ...(Array.isArray(detail.resources) ? { resources: detail.resources } : {}) }));
      const left = before.lint(await before.collectFile(path, server.name), before.resolveConfig({ file: {} }));
      const right = after.lint(await after.collectFile(path, server.name), after.resolveConfig({ file: {} }));
      delete left.generatedAt; delete right.generatedAt;
      assert.deepEqual(right, left, `Audit changed for ${server.name}`);
      results.push({ server: server.name, folder, sourceSha256: hash(raw), tools: right.summary.toolCount,
        findings: right.findings.length, summary: right.summary,
        findingsSha256: hash(JSON.stringify(right.findings)) });
    }
  }
  const result = { servers: results.length, tools: results.reduce((n, row) => n + row.tools, 0),
    skipped: 0, allAuditsIdenticalExcludingGeneratedAt: true, results,
    scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))) };
  await writeFile(output, gzipSync(JSON.stringify(result, null, 2) + '\n', { mtime: 0 }));
  console.log(`Compared ${result.servers} complete audits and ${result.tools} tools; every result unchanged.`);
} finally { await rm(scratch, { recursive: true, force: true }); }
