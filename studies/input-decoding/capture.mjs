// Preserve acceptance/rejection of actual file bytes through the installed CLI.
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = resolve(process.argv[2] && process.argv[2] !== '--check' ? process.argv[2] : join(root, 'dist/cli.js'));
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-decoding-'));
const fixture = join(root, 'tests/fixtures/servers/collection-evidence.mjs');
const text = JSON.stringify([{ name: 'read_invoice', description: 'Read a single invoice by its identifier. MARKER',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false } }]);
const results = [];
const wide = (value, be = false) => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le')]);
  return be ? bytes.swap16() : bytes;
};
const damaged = value => {
  const [prefix, suffix] = value.split('MARKER');
  return Buffer.concat([Buffer.from(prefix), Buffer.from([0xc3]), Buffer.from(suffix)]);
};
async function run(name, args, expected, extraChecks = () => ({})) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15_000 });
  const report = result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
  const checks = { expected_exit: result.status === expected,
    ...(expected === 0 ? { complete: report?.summary.complete === true } : {}),
    ...(expected === 1 ? { incomplete: report?.summary.complete === false && report?.summary.score === null } : {}),
    ...(expected === 2 ? { no_report_from_changed_text: !report } : {}),
    ...await extraChecks(report) };
  results.push({ case: name, code: result.status,
    summary: report?.summary ?? null, stderr: result.stderr.replaceAll(scratch, '<scratch>'),
    checks, agrees: Object.values(checks).every(Boolean) });
}
try {
  const cases = [
    ['invalid-utf8', damaged(text), 2],
    ['invalid-utf16le', wide(text.replace('MARKER', '\ud800')), 2],
    ['invalid-utf16be', wide(text.replace('MARKER', '\ud800'), true), 2],
    ['valid-utf8', Buffer.from(text.replace('MARKER', 'café \ufffd \u{1f642}')), 0],
    ['valid-utf8-bom', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]), 0],
    ['valid-utf16le', wide(text.replace('MARKER', 'café \ufffd \u{1f642}')), 0],
    ['valid-utf16be', wide(text.replace('MARKER', 'café \ufffd \u{1f642}'), true), 0]
  ];
  for (const [name, bytes, expected] of cases) {
    const path = join(scratch, `${name}.json`);
    await writeFile(path, bytes);
    await run(name, ['file', path, '--format', 'json', '--fail-on', 'error'], expected);
  }
  for (const source of ['config', 'envFile']) {
    const log = join(scratch, `${source}-started.log`);
    const config = join(scratch, `${source}.json`);
    const entry = { command: process.execPath, args: [fixture, 'good', log] };
    if (source === 'config') {
      entry.env = { SYNTHETIC_KEY: 'MARKER' };
      await writeFile(config, damaged(JSON.stringify({ servers: { controlled: entry } })));
    } else {
      entry.envFile = join(scratch, 'credentials.env');
      await writeFile(entry.envFile, damaged('SYNTHETIC_KEY=MARKER\n'));
      await writeFile(config, JSON.stringify({ servers: { controlled: entry } }));
    }
    await run(`invalid-utf8/${source}`, ['config', config, '--format', 'json', '--fail-on', 'error'],
      source === 'config' ? 2 : 1, async () => ({ server_not_started: await access(log).then(() => false, () => true) }));
  }
  const receipt = { node: process.version,
    scope: 'Synthetic byte-damaged files and local stdio fixture. No remote servers or real credentials.',
    cases: results.length, disagreements: results.filter(row => !row.agrees).length, results };
  console.log(JSON.stringify(receipt, null, 2));
  if (process.argv.includes('--check') && receipt.disagreements) process.exitCode = 1;
} finally { await rm(scratch, { recursive: true, force: true }); }
