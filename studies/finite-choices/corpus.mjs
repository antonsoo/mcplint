// Compare the complete old/new audit on retained registry lists, without running servers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const [beforePath, afterPath, out] = process.argv.slice(2);
if (!beforePath || !afterPath || !out) throw new Error('Usage: corpus.mjs BEFORE/dist/index.js AFTER/dist/index.js OUTPUT.json');
const before = await import(pathToFileURL(resolve(beforePath)).href);
const after = await import(pathToFileURL(resolve(afterPath)).href);
const { readJson } = await import(pathToFileURL(join(dirname(resolve(afterPath)), 'core/read-json.js')).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = dirname(fileURLToPath(import.meta.url));
const census = join(directory, '../registry-census');
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-choice-corpus-'));
const results = [], skipped = [];
async function modules(root, relative = '') {
  const result = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(result, await modules(root, path));
    else if (entry.name.endsWith('.js')) result[path] = hash(await readFile(join(root, path)));
  }
  return result;
}
try {
  for (const [folder, filename] of [['servers', 'manifest.json'], ['heldout', 'manifest-heldout.json']]) {
    const manifest = JSON.parse(await readFile(join(census, filename), 'utf8'));
    for (const server of manifest.servers) {
      if (!server.tools) continue;
      const name = createHash('sha1').update(server.name).digest('hex') + '.json';
      let raw, detail;
      try {
        raw = await readFile(join(census, 'cache', folder, name));
        detail = readJson(raw.toString('utf8'));
      } catch (error) {
        skipped.push({ server: server.name, folder, reason: String(error) });
        continue;
      }
      const projection = { tools: detail.tools,
        ...(Array.isArray(detail.prompts) ? { prompts: detail.prompts } : {}),
        ...(Array.isArray(detail.resources) ? { resources: detail.resources } : {}) };
      const path = join(scratch, 'tools.json');
      await writeFile(path, JSON.stringify(projection));
      const left = before.lint(await before.collectFile(path, server.name), before.resolveConfig({ file: {} }));
      const right = after.lint(await after.collectFile(path, server.name), after.resolveConfig({ file: {} }));
      const retained = right.findings.filter(row => row.ruleId !== 'schema/enum-type');
      assert.deepEqual(retained, left.findings, `Existing findings changed for ${server.name}`);
      assert.equal(left.summary.complete, right.summary.complete);
      assert.equal(left.summary.totalEstimatedTokens, right.summary.totalEstimatedTokens);
      const added = right.findings.filter(row => row.ruleId === 'schema/enum-type');
      results.push({ server: server.name, folder, sourceSha256: hash(raw), tools: right.summary.toolCount,
        existingFindings: left.findings.length, existingFindingsSha256: hash(JSON.stringify(left.findings)),
        complete: right.summary.complete, added });
    }
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
const result = { beforeRuleIds: before.allRules.map(row => row.id), afterRuleIds: after.allRules.map(row => row.id),
  beforeModuleHashes: await modules(dirname(resolve(beforePath))),
  afterModuleHashes: await modules(dirname(resolve(afterPath))),
  inspectedServers: results.length, inspectedTools: results.reduce((sum, row) => sum + row.tools, 0),
  addedFindings: results.reduce((sum, row) => sum + row.added.length, 0),
  existingFindingsUnchanged: true, skipped, results,
  scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))) };
const payload = JSON.stringify(result, null, 2) + '\n';
await writeFile(out, out.endsWith('.gz') ? gzipSync(payload) : payload);
console.log(`Checked ${result.inspectedServers} retained servers, ${result.inspectedTools} tools; ` +
  `${result.addedFindings} new enum/type findings; ${skipped.length} skipped records.`);
