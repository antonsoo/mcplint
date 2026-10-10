import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';

const [rootArg = '.', outputArg = 'studies/required-properties/after.json', mode = 'verify'] = process.argv.slice(2);
const root = resolve(rootArg);
const { collectFile } = await import(pathToFileURL(join(root, 'dist/collectors/file.js')));
const { lint, shouldFail } = await import(pathToFileURL(join(root, 'dist/core/lint.js')));
const { resolveConfig } = await import(pathToFileURL(join(root, 'dist/core/config.js')));
const raw = await readFile(new URL('cases.json', import.meta.url));
const cases = JSON.parse(raw);
const dir = await mkdtemp(join(tmpdir(), 'mcplint-required-'));
const results = [];
try {
  for (const c of cases) {
    const path = join(dir, `${c.id}.json`);
    await writeFile(path, JSON.stringify({ tools: [{ name: 'lookup_region',
      description: 'Find the configured storage location for the supplied account region.', inputSchema: c.schema }] }));
    let validation;
    try {
      const ajv = new Ajv2020({ strict: false });
      const validate = ajv.compile(c.schema);
      validation = { compiles: true, acceptsInstance: validate(c.instance), acceptsEmpty: validate({}) };
    } catch { validation = { compiles: false }; }
    const target = await collectFile(path);
    const result = lint(target, resolveConfig({ failOnFlag: 'error' }));
    const cli = spawnSync(process.execPath, [join(root, 'dist/cli.js'), 'file', path, '--format', 'json', '--fail-on', 'error'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(cli.stdout).summary, result.summary);
    assert.equal(cli.status, shouldFail(result) ? 1 : 0);
    const record = { id: c.id, validation, exit: cli.status, summary: result.summary,
      findings: result.findings, failsOnWarning: shouldFail(lint(target, resolveConfig({ failOnFlag: 'warning' }))) };
    results.push(record);
    if (mode === 'verify') {
      assert.equal(cli.status, ['invalid-control', 'closed-contradiction'].includes(c.id) ? 1 : 0, c.id);
      const relevant = result.findings.filter(f => f.ruleId === 'description/required-undeclared');
      const severity = c.id === 'closed-contradiction' ? 'error'
        : ['undocumented-open', 'nested-is-not-root'].includes(c.id) ? 'warning' : null;
      assert.deepEqual(relevant.map(f => f.severity), severity ? [severity] : [], c.id);
    }
  }
} finally { await rm(dir, { recursive: true, force: true }); }
const report = { node: process.version, casesSha256: createHash('sha256').update(raw).digest('hex'), results };
await writeFile(outputArg, JSON.stringify(report, null, 2) + '\n');
console.log(results.map(r => `${r.id}: valid=${r.validation.acceptsInstance ?? 'invalid schema'} exit=${r.exit}`).join('\n'));
