// Fresh-process CLI timings over unchanged public tool definitions, with exact report comparison.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { availableParallelism, cpus, release, totalmem } from 'node:os';

const [before, metaOnly, after, output] = process.argv.slice(2);
if (!before || !metaOnly || !after || !output) throw new Error('Usage: benchmark.mjs BEFORE_CLI META_ONLY_CLI AFTER_CLI OUTPUT.json');
const directory = dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp('/tmp/claude-1000/mcplint-audit-bench-');
const provenance = JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'));
const hash = raw => createHash('sha256').update(raw).digest('hex');
async function modules(root, path = '') {
  const result = {};
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const relative = join(path, entry.name);
    if (entry.isDirectory()) Object.assign(result, await modules(root, relative));
    else if (relative.endsWith('.js')) result[relative] = hash(await readFile(join(root, relative)));
  }
  return result;
}
const versions = [['before', resolve(before)], ['meta-only', resolve(metaOnly)], ['after', resolve(after)]];
const results = [];
try {
  await mkdir(join(scratch, 'inputs'));
  for (const source of provenance.cases) {
    const raw = gunzipSync(await readFile(join(directory, source.retained_gzip)));
    assert.equal(hash(raw), source.projection_sha256);
    assert.equal(JSON.parse(raw).tools.length, source.tools);
    const relative = `inputs/${source.label}.json`;
    await writeFile(join(scratch, relative), raw);
    const samples = [];
    let expected;
    for (let repetition = 0; repetition < 5; repetition++) {
      // Rotate order to avoid consistently favoring one variant's filesystem cache.
      const order = [...versions.slice(repetition % 3), ...versions.slice(0, repetition % 3)];
      for (const [label, cli] of order) {
        const started = performance.now();
        const run = spawnSync('/usr/bin/time', ['-f', '%U %S %M', '-o', 'time.txt', process.execPath,
          cli, 'file', relative, '--format', 'json', '--output', 'report.json', '--fail-on', 'warning'], {
          cwd: scratch, env: { ...process.env, NODE_OPTIONS: '', TMPDIR: scratch },
          encoding: 'utf8', timeout: 120_000,
        });
        const wallMs = performance.now() - started;
        assert.equal(run.status, 1, run.stderr); // Every native catalog already has warnings.
        const report = JSON.parse(await readFile(join(scratch, 'report.json'), 'utf8'));
        delete report.generatedAt; // The sole intentionally variable report field.
        assert.equal(report.summary.complete, true);
        assert.equal(report.summary.toolCount, source.tools);
        if (expected) assert.deepEqual(report, expected);
        else expected = report;
        const timing = (await readFile(join(scratch, 'time.txt'), 'utf8')).trim().split('\n').at(-1).split(' ').map(Number);
        const [userSeconds, systemSeconds, peakRssKiB] = timing;
        assert.ok(timing.length === 3 && timing.every(Number.isFinite));
        samples.push({ variant: label, repetition, wallMs, userSeconds, systemSeconds, peakRssKiB,
          reportSha256ExcludingGeneratedAt: hash(JSON.stringify(report)) });
        console.log(JSON.stringify({ catalog: source.label, variant: label, repetition,
          wallMs: Math.round(wallMs), peakRssKiB }));
      }
    }
    const medians = Object.fromEntries(versions.map(([variant]) => {
      const rows = samples.filter(row => row.variant === variant);
      const median = key => rows.map(row => row[key]).sort((a, b) => a - b)[2];
      return [variant, { wallMs: median('wallMs'), peakRssKiB: median('peakRssKiB') }];
    }));
    results.push({ source, samples, medians, summary: expected.summary, allReportsIdentical: true });
  }
  const moduleHashes = Object.fromEntries(await Promise.all(versions.map(async ([label, cli]) => [label, await modules(dirname(cli))])));
  await writeFile(output, JSON.stringify({ baselineSourceCommit: provenance.baseline_source_commit,
    environment: { node: process.version, availableCpus: availableParallelism(), cpuModel: cpus()[0]?.model,
      kernel: release(), memoryBytes: totalmem(), nodeOptions: '', processes: 'one fresh CLI per sample; variants run sequentially' },
    moduleHashes, results, scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    provenanceSha256: hash(await readFile(join(directory, 'provenance.json'))) }, null, 2) + '\n');
} finally { await rm(scratch, { recursive: true, force: true }); }
