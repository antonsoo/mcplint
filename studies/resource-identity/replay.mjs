import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ResourceSchema, ResourceTemplateSchema } from '@modelcontextprotocol/sdk/types.js';

const [rootArg = '.', output = 'studies/resource-identity/after.json', mode = 'verify'] = process.argv.slice(2);
const root = resolve(rootArg);
const { collectFile } = await import(pathToFileURL(join(root, 'dist/collectors/file.js')));
const { lint, shouldFail } = await import(pathToFileURL(join(root, 'dist/core/lint.js')));
const { resolveConfig } = await import(pathToFileURL(join(root, 'dist/core/config.js')));
const raw = await readFile(new URL('cases.json', import.meta.url));
const cases = JSON.parse(raw);
const server = fileURLToPath(new URL('server.mjs', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-resource-'));
const results = [];
try {
  for (const c of cases) {
    const path = join(scratch, `${c.id}.json`);
    await writeFile(path, JSON.stringify(c.snapshot));
    const oracle = Object.entries(c.snapshot).flatMap(([key, items]) => items.map((item, index) => {
      const result = (key === 'resources' ? ResourceSchema : ResourceTemplateSchema).safeParse(item);
      return { list: key, index, valid: result.success, issues: result.success ? [] : result.error.issues.map(e => e.path.join('.')) };
    }));
    const target = await collectFile(path);
    const suppressed = lint(target, resolveConfig({ failOnFlag: 'error', file: { severities: { 'collection/incomplete': 'off' } } }));
    const observations = [];
    for (const transport of ['file', 'stdio']) {
      const args = transport === 'file' ? ['file', path] : ['stdio', '--', process.execPath, server, path];
      // Flags precede '--' for the stdio child command.
      args.splice(1, 0, '--format', 'json', '--fail-on', 'error');
      const proc = spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 15000 });
      if (proc.error) throw proc.error;
      assert.ok(proc.status === 0 || proc.status === 1, proc.stderr);
      const report = JSON.parse(proc.stdout);
      observations.push({ transport, exit: proc.status, summary: report.summary, collection: report.collection, findings: report.findings });
      if (mode === 'verify') {
        const valid = oracle.every(r => r.valid);
        assert.equal(report.summary.complete, valid, `${c.id}/${transport}`);
        assert.equal(proc.status, valid ? 0 : 1, `${c.id}/${transport}`);
        assert.equal(report.summary.resourceCount, oracle.length);
        if (!valid) assert.equal(report.summary.score, null);
        if (c.id === 'retained-warning') assert.ok(report.findings.some(f => f.ruleId === 'safety/hidden-unicode'));
      }
    }
    results.push({ id: c.id, oracle, retainedNames: target.resources.map(r => r.name),
      gateFailsWithCollectionDiagnosticSuppressed: shouldFail(suppressed), observations });
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
await writeFile(output, JSON.stringify({ node: process.version,
  casesSha256: createHash('sha256').update(raw).digest('hex'), results }, null, 2) + '\n');
console.log(results.map(r => `${r.id}: SDK valid=${r.oracle.every(o => o.valid)} complete=${r.observations[0].summary.complete} score=${r.observations[0].summary.score}`).join('\n'));
