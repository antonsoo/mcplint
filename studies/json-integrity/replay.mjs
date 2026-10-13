// Real CLI capture/diff workflows. All definitions and faults are synthetic.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const [cliArg, workArg, mode] = process.argv.slice(2);
assert(cliArg && workArg, 'Usage: node replay.mjs CLI NEW_WORK_DIRECTORY [check]');
const cli = resolve(cliArg), work = resolve(workArg);
mkdirSync(work); // Existing evidence is never replaced.
const sha = b => createHash('sha256').update(b).digest('hex');
const marker = 'PREVIOUS REPORT MUST SURVIVE\n';
const tool = literal => JSON.stringify({ name: 'read_account', description: 'Read one account by its integer account ID without modifying stored records.',
  inputSchema: { type: 'object', properties: { account_id: { type: 'integer', description: 'Identifier of the account to inspect.', maximum: 'NUMBER' } }, required: ['account_id'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }).replace('"NUMBER"', literal);
const normal = tool('100');
const withMeta = raw => normal.slice(0, -1) + ',"_meta":' + raw + '}';
const saved = raw => '{"tools":[' + raw + ']}';
const snapshot = raw => '{"format":"mcplint-metadata-snapshot","schemaVersion":1,"createdAt":"2026-10-13T00:00:00Z",' +
  '"servers":[{"id":"file"}],"collection":[{"serverId":"file","scope":"tools/list","status":"complete","pages":1,"received":1,"retained":1}],' +
  '"definitions":[{"serverId":"file","scope":"tools/list","value":' + raw + '}]}';
const bad = [
  ['rounded-integer', saved(tool('9007199254740993')), /rounded/],
  ['rounded-negative', saved(tool('-9007199254740993')), /rounded/],
  ['rounded-decimal', saved(tool('0.10000000000000001')), /rounded/],
  ['underflow', saved(tool('1e-400')), /underflows/],
  ['overflow', saved(withMeta('{"limit":1e400}')), /finite JavaScript/],
  ['duplicate-name', saved(normal.replace('"name":"read_account"', '"name":"erased","name":"read_account"')), /Duplicate JSON/],
  ['duplicate-inventory', '{"tools":[{"name":"erased"}],"tools":[' + normal + ']}', /Duplicate JSON/],
  ['escaped-duplicate', saved(normal.replace('"name":"read_account"', '"name":"erased","\\u006eame":"read_account"')), /Duplicate JSON/],
  ['duplicate-extension', saved(withMeta('{"secret-field-marker":1,"secret-field-marker":2}')), /Duplicate JSON/],
  ['same-value-duplicate', saved(withMeta('{"x":1,"x":1}')), /Duplicate JSON/],
  ['excessive-depth', saved(withMeta('['.repeat(140) + '0' + ']'.repeat(140))), /128 levels/],
  ['invalid-syntax', saved(normal).slice(0, -1), /not valid JSON/],
];
const good = [
  ['ordinary', saved(normal)], ['large-exact', saved(tool('9007199254740992'))],
  ['equivalent-exponent', saved(tool('1.000e+2'))], ['ordinary-decimal', saved(tool('0.1'))],
  ['subnormal', saved(withMeta('{"tiny":5e-324}'))],
  ['string-lookalikes', saved(withMeta(JSON.stringify({ text: '{"x":1e400,"x":9007199254740993}\\"' })))],
  ['separate-objects', saved(withMeta('{"a":{"name":1},"b":{"name":2},"__proto__":{"name":3}}'))],
  ['duplicate-list-identities', '{"tools":[' + normal + ',' + normal + ']}'],
];
const diffCases = [
  ['rounded-integer', snapshot(tool('9007199254740992')), snapshot(tool('9007199254740993')), 2, /rounded/],
  ['rounded-before', snapshot(tool('9007199254740993')), snapshot(tool('9007199254740992')), 2, /rounded/],
  ['rounded-decimal', snapshot(tool('0.1')), snapshot(tool('0.10000000000000001')), 2, /rounded/],
  ['underflow', snapshot(tool('0')), snapshot(tool('1e-400')), 2, /underflows/],
  ['duplicate-field', snapshot(normal), snapshot(normal.replace('"maximum":100', '"maximum":200,"maximum":100')), 2, /Duplicate JSON/],
  ['duplicate-envelope', snapshot(normal), snapshot(normal).replace('"schemaVersion":1', '"schemaVersion":99,"schemaVersion":1'), 2, /Duplicate JSON/],
  ['excessive-depth', snapshot(normal), snapshot(withMeta('['.repeat(140) + '0' + ']'.repeat(140))), 2, /128 levels/],
  ['unchanged', snapshot(normal), snapshot(normal), 0],
  ['changed-limit', snapshot(tool('100')), snapshot(tool('200')), 1],
  ['decimal-change', snapshot(tool('0.1')), snapshot(tool('0.2')), 1],
  ['equivalent-exponent', snapshot(tool('100')), snapshot(tool('1.000e+2')), 0],
  ['key-order', snapshot(withMeta('{"a":1,"b":2}')), snapshot(withMeta('{"b":2,"a":1}')), 0],
  ['ordered-array', snapshot(withMeta('[1,2]')), snapshot(withMeta('[2,1]')), 1],
];
const results = [];
function invoke(directory, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8', timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
for (const [label, text, diagnostic] of [...bad, ...good]) {
  const directory = resolve(work, 'file-' + label); mkdirSync(directory);
  writeFileSync(resolve(directory, 'input.json'), text);
  writeFileSync(resolve(directory, 'report.json'), marker);
  const result = invoke(directory, ['file', 'input.json', '--format', 'json', '--output', 'report.json', '--snapshot', 'snapshot.json']);
  const reportText = readFileSync(resolve(directory, 'report.json'), 'utf8');
  const snapshotFile = resolve(directory, 'snapshot.json');
  const captured = existsSync(snapshotFile) ? JSON.parse(readFileSync(snapshotFile, 'utf8')) : null;
  const report = reportText === marker ? null : JSON.parse(reportText);
  // Only wall-clock fields vary between genuine captures. Relative input names stay exact.
  if (captured) delete captured.createdAt;
  if (report) delete report.generatedAt;
  const checks = { exit: result.status === (diagnostic ? 2 : 0),
    input_unchanged: readFileSync(resolve(directory, 'input.json'), 'utf8') === text,
    report: diagnostic ? reportText === marker : report !== null,
    snapshot: diagnostic ? captured === null : captured !== null,
    diagnostic: !diagnostic || diagnostic.test(result.stderr),
    diagnostic_does_not_echo_private_key: label !== 'duplicate-extension' || !result.stderr.includes('secret-field-marker'),
  };
  results.push({ case: 'file-' + label, expected_exit: diagnostic ? 2 : 0, exit: result.status,
    input_sha256: sha(text), stderr: result.stderr, report_preserved: reportText === marker,
    snapshot_written: captured !== null, snapshot: captured, report,
    checks, agrees: Object.values(checks).every(Boolean) });
}
for (const [label, before, after, exit, diagnostic] of diffCases) {
  const directory = resolve(work, 'diff-' + label); mkdirSync(directory);
  writeFileSync(resolve(directory, 'before.json'), before); writeFileSync(resolve(directory, 'after.json'), after);
  writeFileSync(resolve(directory, 'report.json'), marker);
  const result = invoke(directory, ['diff', 'before.json', 'after.json', '--format', 'json', '--output', 'report.json']);
  const raw = readFileSync(resolve(directory, 'report.json'), 'utf8');
  const checks = { exit: result.status === exit, report: diagnostic ? raw === marker : raw !== marker,
    inputs_unchanged: readFileSync(resolve(directory, 'before.json'), 'utf8') === before && readFileSync(resolve(directory, 'after.json'), 'utf8') === after,
    diagnostic: !diagnostic || diagnostic.test(result.stderr) };
  // Also retain the actual HTML for accepted comparisons. No renderer source changed.
  let html = null;
  if (!diagnostic) {
    const rendered = invoke(directory, ['diff', 'before.json', 'after.json', '--format', 'html', '--output', 'report.html']);
    checks.html_exit = rendered.status === exit;
    html = sha(readFileSync(resolve(directory, 'report.html')));
  }
  results.push({ case: 'diff-' + label, expected_exit: exit, exit: result.status,
    before_sha256: sha(before), after_sha256: sha(after), stderr: result.stderr, report_preserved: raw === marker,
    report: raw === marker ? null : JSON.parse(raw), html_sha256: html,
    checks, agrees: Object.values(checks).every(Boolean) });
}
for (const row of results) row.outcome_agrees = Object.entries(row.checks).filter(([key]) => key !== 'diagnostic').every(([, value]) => value);
const receipt = { scope: 'Synthetic saved tool inventories and snapshots through actual CLI capture/diff; only capture timestamps omitted from recorded JSON objects.',
  node: process.version, cases: results.length, cli_invocations: results.length + diffCases.filter(row => !row[4]).length,
  disagreements: results.filter(row => !row.agrees).length, outcome_disagreements: results.filter(row => !row.outcome_agrees).length, results };
console.log(JSON.stringify(receipt, null, 2));
if (mode === 'check' && receipt.disagreements) process.exitCode = 1;
