import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases, privateMarker, privateState, responseFor, scopes } from './cases.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
for (const name of ['--engine-root', '--out', '--label']) assert.ok(args.includes(name));
const root = resolve(option('--engine-root'));
const library = await import(pathToFileURL(join(root, 'dist/index.js')).href);
const output = resolve(option('--out'));
await mkdir(dirname(output), { recursive: true });
const scratchRoot = args.includes('--scratch-root') ? resolve(option('--scratch-root')) : tmpdir();
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(scratchRoot, 'mcplint-result-types-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
const cli = join(root, 'dist/cli.js');
const environment = { ...process.env, MCPLINT_ENGINE_ROOT: root,
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` };

function run(args, cwd) {
  const child = spawnSync(process.execPath, [cli, ...args], { cwd, env: environment,
    encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.error, undefined, child.stderr);
  assert.ok([0, 1, 2].includes(child.status), `Unexpected CLI status: ${child.stderr}`);
  const report = JSON.parse(child.stdout);
  assert.ok(!child.stdout.includes(privateState) && !child.stdout.includes(privateMarker));
  return { exitCode: child.status, report, rawStdout: child.stdout, rawStderr: child.stderr };
}

for (const item of cases) {
  const folder = join(scratch, item.id);
  await mkdir(folder);
  await copyFile(new URL('./server.mjs', import.meta.url), join(folder, 'server.mjs'));
  await copyFile(new URL('./cases.mjs', import.meta.url), join(folder, 'cases.mjs'));
  await writeFile(join(folder, 'case.json'), JSON.stringify(item));
  if (item.suppressed) await writeFile(join(folder, '.mcplintrc.json'), JSON.stringify({
    severities: { 'collection/incomplete': 'off' }
  }));
  const live = run(['stdio', '--format', 'json', '--fail-on', 'error', '--snapshot', 'snapshot.json',
    '--', 'node', 'server.mjs', 'case.json', 'calls.jsonl'], folder);
  const calls = (await readFile(join(folder, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.every(call => ['initialize', 'notifications/initialized', ...Object.keys(scopes)].includes(call.method)));
  const snapshot = JSON.parse(await readFile(join(folder, 'snapshot.json'), 'utf8'));
  assert.ok(!JSON.stringify(snapshot).includes(privateState) && !JSON.stringify(snapshot).includes(privateMarker));
  const scopeCalls = calls.filter(call => call.method === item.scope);
  const liveAgrees = live.report.summary.complete === item.complete &&
    (item.complete || (live.report.summary.score === null && live.exitCode === 1)) &&
    (!item.paginated || scopeCalls.length === 2) &&
    (!item.hidden || live.report.findings.some(finding => finding.ruleId === 'safety/hidden-unicode'));
  const savedBody = responseFor(item, item.scope, item.paginated ? 'second' : undefined);
  await writeFile(join(folder, 'saved.json'), JSON.stringify(savedBody));
  const saved = run(['file', 'saved.json', '--format', 'json', '--fail-on', 'error', '--snapshot', 'saved-snapshot.json'], folder);
  const savedAgrees = saved.report.summary.complete === item.complete &&
    (item.complete || (saved.report.summary.score === null && saved.exitCode === 1));
  records.push({ id: item.id, kind: 'native-stdio', agrees: liveAgrees,
    scope: item.scope, expectedComplete: item.complete, calls,
    collection: snapshot.collection, retainedDefinitions: snapshot.definitions.length,
    definitionsSha256: sha256(library.canonicalMetadata(snapshot.definitions)), ...live });
  records.push({ id: item.id, kind: 'saved-file', agrees: savedAgrees,
    scope: item.scope, expectedComplete: item.complete, ...saved });
}

// Disappearance must stay unproved when the after snapshot was explicitly non-complete.
const first = { name: 'first', description: 'Read the first synthetic record.', inputSchema: { type: 'object' } };
const second = { ...first, name: 'second' };
const diffPath = join(scratch, 'diff.json');
await writeFile(diffPath, JSON.stringify({ tools: [first, second] }));
const before = library.createMetadataSnapshot(await library.collectFile(diffPath), '2026-10-14T00:00:00.000Z');
await writeFile(diffPath, JSON.stringify({ tools: [first], resultType: 'input_required' }));
const after = library.createMetadataSnapshot(await library.collectFile(diffPath), '2026-10-14T00:00:00.000Z');
const diff = library.compareMetadata(before, after);
records.push({ id: 'saved-disappearance', kind: 'metadata-diff', agrees: !diff.complete && diff.summary.removed === 0, diff });
await writeFile(join(scratch, 'before-snapshot.json'), JSON.stringify(before));
await writeFile(join(scratch, 'after-snapshot.json'), JSON.stringify(after));
const cliDiff = run(['diff', 'before-snapshot.json', 'after-snapshot.json', '--format', 'json'], scratch);
records.push({ id: 'saved-disappearance-cli', kind: 'metadata-diff-cli',
  agrees: !cliDiff.report.complete && cliDiff.report.summary.removed === 0 && cliDiff.exitCode === 2, ...cliDiff });
const require = createRequire(join(root, 'package.json'));
const sdkRoot = dirname(dirname(dirname(require.resolve('@modelcontextprotocol/sdk/types.js'))));
const sdkVersion = JSON.parse(await readFile(join(sdkRoot, 'package.json'), 'utf8')).version;
const runtime = {};
for (const file of ['collectors/collect.js', 'collectors/file.js', 'collectors/list-result.js']) {
  try { runtime[file] = sha256(await readFile(join(root, 'dist', file))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const result = { label: option('--label'), node: process.version, sdkVersion, runtime,
  workflows: records.length, disagreements: records.filter(record => !record.agrees).length, records };
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ label: result.label, node: result.node, sdkVersion,
  workflows: result.workflows, disagreements: result.disagreements }));
if (!args.includes('--observe-only')) assert.equal(result.disagreements, 0);
