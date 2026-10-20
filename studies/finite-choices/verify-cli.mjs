// Compare current/previous CLIs through a real local SDK transport, then compare captured metadata.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compareMetadata, parseMetadataSnapshot } from '../../dist/index.js';

const [before, after, output] = process.argv.slice(2);
if (!before || !after || !output) throw new Error('Usage: verify-cli.mjs BEFORE_CLI AFTER_CLI OUTPUT.json');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-enum-sdk-'));
const cases = [];
const snapshots = [];
try {
  for (const [label, cli, status] of [['before', before, 0], ['after', after, 1]]) {
    const trace = join(scratch, `${label}.trace.jsonl`), snapshot = join(scratch, `${label}.snapshot.json`);
    const args = [resolve(cli), 'stdio', '--format', 'json', '--snapshot', snapshot,
      '--ignore', 'budget/tool-tokens', '--ignore', 'description/too-short', '--ignore', 'description/enum-unexplained',
      '--fail-on', 'warning', '--', 'node', 'studies/finite-choices/replay-server.mjs'];
    // Use the exact running Node without publishing this workstation's paths
    // as the report's server label. The trace location is not MCP metadata.
    const env = { ...process.env, MCPLINT_ENUM_TRACE: trace,
      PATH: dirname(process.execPath) + delimiter + process.env.PATH };
    const run = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
    assert.equal(run.status, status, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.summary.complete, true);
    const findings = report.findings.filter(row => row.ruleId === 'schema/enum-type');
    assert.equal(findings.length, label === 'before' ? 0 : 4);
    const methods = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line).method);
    assert.deepEqual(methods, ['tools/list']);
    const text = await readFile(snapshot, 'utf8');
    snapshots.push(parseMetadataSnapshot(text));
    cases.push({ label, exitCode: run.status, report, methods,
      snapshotSha256: createHash('sha256').update(text).digest('hex') });
  }
  const comparison = compareMetadata(...snapshots);
  assert.equal(comparison.complete, true);
  // Initialization metadata is compared alongside the three tool definitions.
  assert.deepEqual(comparison.summary, { added: 0, removed: 0, changed: 0, unchanged: 4, unpaired: 0 });
  await writeFile(output, JSON.stringify({ cases, capturedMetadataComparison: comparison,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    sdkReplay: 'unchanged retained tool definitions; no tool implementation or remote connection',
    scriptSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex') }, null, 2) + '\n');
} finally { await rm(scratch, { recursive: true, force: true }); }
console.log('Native SDK replay: metadata unchanged; gate 0 -> 1; four new findings; zero tools/call requests.');
