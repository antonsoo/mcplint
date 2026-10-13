import { spawnSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const cli = resolve(process.argv[2] ?? 'dist/cli.js');
const output = resolve(process.argv[3] ?? 'studies/metadata-diff/before.json');
const summaries = [];
for (const revision of ['before', 'contract']) {
  const transcript = resolve(`studies/metadata-diff/fixtures/${revision}.jsonl`);
  await rm(transcript, { force: true });
  const result = spawnSync(process.execPath, [cli, 'stdio', '--format', 'json', '--', process.execPath, resolve('studies/metadata-diff/server.mjs'), revision, transcript], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const replies = (await readFile(transcript, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const maximum = replies.filter(row => row.method === 'tools/list').flatMap(row => row.response.tools).map(tool => tool.inputSchema.properties.limit.maximum);
  summaries.push({ revision, summary: report.summary, findings: report.findings, wireMaximum: maximum,
    reportContainsDefinitions: Object.hasOwn(report, 'tools') || Object.hasOwn(report, 'definitions') });
}
assert.deepEqual(summaries[0].summary, summaries[1].summary);
assert.deepEqual(summaries[0].findings, summaries[1].findings);
assert.notDeepEqual(summaries[0].wireMaximum, summaries[1].wireMaximum);
const result = { workload: 'Controlled SDK metadata revisions, no tools called', cases: summaries };
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
