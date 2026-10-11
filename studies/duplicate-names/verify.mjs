// Exercise the installed or checkout CLI, including a real two-page MCP session.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [cli = 'dist/cli.js', output = 'studies/duplicate-names/after.json', mode = 'verify', runtime = process.execPath] = process.argv.slice(2);
const study = dirname(fileURLToPath(import.meta.url));
const fixtureBytes = readFileSync(join(study, 'tools.json'));
const fixture = JSON.parse(fixtureBytes);
const dir = mkdtempSync(join(tmpdir(), 'mcplint-duplicates-'));
const run = (args, format = 'json') => spawnSync(runtime, [resolve(cli), ...args, '--format', format, '--fail-on', 'error'], { cwd: dir, encoding: 'utf8', timeout: 20_000 });
const results = [];
try {
  for (const kind of ['different-definitions', 'identical-definitions', 'case-sensitive-control', 'paginated', 'within-and-across']) {
    const data = structuredClone(fixture);
    if (kind === 'identical-definitions') data.tools[1] = structuredClone(data.tools[0]);
    if (kind === 'case-sensitive-control') data.tools[1].name = 'READ_RECORD';
    const input = join(dir, `${kind}.json`);
    writeFileSync(input, JSON.stringify(data));
    const log = join(dir, `${kind}.jsonl`);
    let args = ['file', input];
    if (kind === 'paginated') args = ['stdio', '--', runtime, join(study, 'server.mjs'), input, log];
    if (kind === 'within-and-across') {
      const single = join(dir, 'single.json');
      writeFileSync(single, JSON.stringify({ tools: [data.tools[0]] }));
      const config = join(dir, 'config.json');
      writeFileSync(config, JSON.stringify({ mcpServers: {
        invoices: { command: runtime, args: [join(study, 'server.mjs'), input, log] },
        customers: { command: runtime, args: [join(study, 'server.mjs'), single, log] }
      } }));
      args = ['config', config];
    }
    // CLI options belong before the stdio command separator.
    const invocation = args[0] === 'stdio'
      ? spawnSync(runtime, [resolve(cli), 'stdio', '--format', 'json', '--fail-on', 'error', ...args.slice(1)], { cwd: dir, encoding: 'utf8', timeout: 20_000 })
      : run(args);
    assert.equal(invocation.error, undefined);
    assert.equal(invocation.signal, null);
    const report = JSON.parse(invocation.stdout);
    const collisions = report.findings.filter(f => f.ruleId === 'naming/collision');
    const control = kind === 'case-sensitive-control';
    const expected = control ? 0 : kind === 'within-and-across' ? 2 : 1;
    assert.equal(report.summary.complete, true);
    assert.equal(report.summary.toolCount, kind === 'within-and-across' ? 3 : 2);
    if (mode !== 'observe') {
      assert.equal(collisions.length, expected, kind);
      assert.equal(invocation.status, control ? 0 : 1, kind);
    }
    const requests = ['paginated', 'within-and-across'].includes(kind)
      ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    assert.ok(requests.every(r => r.method === 'tools/list'));
    if (kind === 'paginated') assert.deepEqual(requests.map(r => r.page), [0, 1]);
    results.push({ kind, exitCode: invocation.status, summary: report.summary, collisions, collection: report.collection, requests });
  }
  writeFileSync(output, JSON.stringify({ node: spawnSync(runtime, ['--version'], { encoding: 'utf8' }).stdout.trim(), inputSha256: createHash('sha256').update(fixtureBytes).digest('hex'), results }, null, 2) + '\n');
  console.log(results.map(r => ({ kind: r.kind, exitCode: r.exitCode, collisions: r.collisions.length, score: r.summary.score })));
} finally { rmSync(dir, { recursive: true, force: true }); }
