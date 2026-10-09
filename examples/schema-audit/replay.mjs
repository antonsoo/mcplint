// Exercise a built or installed CLI over files, stdio and real loopback HTTP.
// node replay.mjs /absolute/path/to/dist/cli.js /tmp/mcplint-schema-replay [--verify]
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const [cliArg, outputArg, verify] = process.argv.slice(2);
if (!cliArg || !outputArg) throw new Error('Usage: replay.mjs <dist/cli.js> <output-dir> [--verify]');
const cli = resolve(cliArg), output = resolve(outputArg);
const here = dirname(fileURLToPath(import.meta.url));
const execute = promisify(execFile);
await mkdir(output, { recursive: true });

async function run(args) {
  try {
    const { stdout, stderr } = await execute(process.execPath, [cli, ...args], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (error.code !== 1) throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}
function observation(report) {
  return {
    tools: report.summary.toolCount, complete: report.summary.complete, score: report.summary.score,
    findings: report.findings.filter(f => ['schema/invalid', 'safety/unchecked'].includes(f.ruleId))
      .map(f => ({ rule: f.ruleId, subject: f.subject.name, message: f.message }))
  };
}

const rows = [];
for (const mode of ['valid', 'invalid', 'unresolved', 'mixed']) {
  for (const transport of ['file', 'stdio', 'http']) {
    let server;
    const log = join(output, `${mode}-${transport}-requests.jsonl`);
    if (transport !== 'file') await writeFile(log, '');
    try {
      let args;
      const options = ['--format', 'json', '--fail-on', 'error'];
      if (transport === 'file') args = ['file', join(here, `${mode}.json`), ...options];
      if (transport === 'stdio') args = ['stdio', ...options, '--', process.execPath, join(here, 'server.mjs'), mode, 'stdio', log];
      if (transport === 'http') {
        server = spawn(process.execPath, [join(here, 'server.mjs'), mode, 'http', log], { stdio: ['ignore', 'pipe', 'inherit'] });
        const lines = createInterface({ input: server.stdout });
        const timeout = setTimeout(() => server.kill(), 20_000);
        try {
          const [url] = await Promise.race([
            once(lines, 'line'),
            once(server, 'exit').then(() => { throw new Error('HTTP fixture exited before listening'); })
          ]);
          args = ['http', url, ...options];
        } finally { clearTimeout(timeout); lines.close(); }
      }
      const result = await run(args);
      const report = JSON.parse(result.stdout);
      await writeFile(join(output, `${mode}-${transport}.json`), result.stdout);
      const row = { mode, transport, exit: result.code, ...observation(report) };
      rows.push(row);
      if (transport !== 'file') {
        const requests = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line).method);
        assert.deepEqual(requests, ['initialize', 'notifications/initialized', 'tools/list']);
      }
      if (verify === '--verify') {
        assert.equal(row.exit, mode === 'valid' ? 0 : 1, `${mode}/${transport}: exit`);
        assert.equal(row.complete, ['valid', 'invalid'].includes(mode), `${mode}/${transport}: complete`);
        assert.equal(row.findings.filter(f => f.rule === 'schema/invalid').length, ['invalid', 'mixed'].includes(mode) ? 1 : 0);
        assert.equal(row.findings.filter(f => f.rule === 'safety/unchecked').length, ['unresolved', 'mixed'].includes(mode) ? 1 : 0);
        if (!row.complete) assert.equal(row.score, null);
      }
    } finally {
      if (server && server.exitCode === null) { const done = once(server, 'exit'); server.kill(); await done; }
    }
  }
}

for (const format of ['terminal', 'markdown', 'html', 'sarif']) {
  const result = await run(['file', join(here, 'mixed.json'), '--format', format, '--fail-on', 'error']);
  await writeFile(join(output, `mixed.${format === 'terminal' ? 'txt' : format}`), result.stdout);
  if (verify === '--verify') {
    assert.equal(result.code, 1);
    assert.ok(result.stdout.includes('outputSchema'));
    if (format === 'sarif') assert.equal(JSON.parse(result.stdout).runs[0].invocations[0].executionSuccessful, false);
    else assert.ok(result.stdout.includes('Incomplete audit'));
  }
}
const hidden = await run(['file', join(here, 'unresolved.json'), '--format', 'json', '--ignore', 'safety/unchecked', '--fail-on', 'error']);
const suppression = { exit: hidden.code, ...observation(JSON.parse(hidden.stdout)) };
if (verify === '--verify') {
  assert.equal(suppression.exit, 1); assert.equal(suppression.complete, false);
  assert.equal(suppression.score, null); assert.deepEqual(suppression.findings, []);
}

// Separate same-process checks expose validator state that a fresh CLI process conceals.
const { collectFile, lint, resolveConfig } = await import(pathToFileURL(join(dirname(cli), 'index.js')).href);
const target = await collectFile(join(here, 'valid.json'));
target.tools = target.tools.slice(0, 1);
delete target.collection; // The following cases are explicit library inputs, not the whole saved list.
const config = resolveConfig({ file: {}, failOnFlag: 'error' });
const first = observation(lint(target, config));
const repeated = observation(lint(structuredClone(target), config));
target.tools[0].inputSchema = { type: 'object', properties: { invoice: { $ref: 'https://example.invalid/invoice' } } };
delete target.tools[0].outputSchema;
const externalAfterEarlierAudit = observation(lint(target, config));
if (verify === '--verify') {
  assert.deepEqual(first.findings, []); assert.deepEqual(repeated.findings, []);
  assert.equal(externalAfterEarlierAudit.complete, false);
  assert.equal(externalAfterEarlierAudit.findings[0].rule, 'safety/unchecked');
}
const dialects = [];
for (const uri of ['http://json-schema.org/draft-06/schema#', 'http://json-schema.org/draft-07/schema#',
  'https://json-schema.org/draft/2019-09/schema', 'https://json-schema.org/draft/2020-12/schema']) {
  const tuple = [{ type: 'string' }, { type: 'number' }];
  target.tools[0].inputSchema = { $schema: uri, type: 'object', properties: {
    pair: { type: 'array', ...(uri.includes('2020-12') ? { prefixItems: tuple } : { items: tuple }) }
  } };
  const result = observation(lint(target, config));
  dialects.push({ uri, ...result });
  if (verify === '--verify') { assert.equal(result.complete, true); assert.deepEqual(result.findings, []); }
}
const evidence = { node: process.version, rows, suppression, sameProcess: { first, repeated, externalAfterEarlierAudit }, dialects };
await writeFile(join(output, 'observations.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ workflows: rows.length, formats: 4, verified: verify === '--verify', output }));
