// Controlled local SDK collection; every overwrite uses a disposable input copy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [directory, executable, mode = 'after'] = process.argv.slice(2);
assert(directory && executable && ['before', 'after'].includes(mode), 'Usage: node replay.mjs NEW_DIRECTORY CLI_JS [before|after]');
const root = resolve(directory), cli = resolve(executable);
mkdirSync(root);
const fixture = readFileSync(new URL('../../tests/fixtures/reference-servers/server-filesystem.json', import.meta.url));
const server = fileURLToPath(new URL('../../tests/fixtures/servers/echo-environment.mjs', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
const rows = [], terminal = [];
const kinds = { definitions: 'tools.json', 'explicitConfig': 'rules.json', automaticConfig: '.mcplintrc.json', clientConfig: 'mcp.json', envFile: 'server.env' };
function prepare(name) {
  const dir = join(root, name); mkdirSync(dir);
  writeFileSync(join(dir, 'tools.json'), fixture);
  writeFileSync(join(dir, 'rules.json'), '{"budget":400}\n');
  writeFileSync(join(dir, 'server.env'), 'FIXTURE_FROM_FILE=controlled-value\n');
  writeFileSync(join(dir, 'server.mjs'), `import { appendFileSync } from 'node:fs';\nappendFileSync('started.txt','started\\n');\nawait import(${JSON.stringify(pathToFileURL(server).href)});\n`);
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ servers: { local: {
    command: process.execPath, args: ['server.mjs'], cwd: '${workspaceFolder}', envFile: '${workspaceFolder}/server.env'
  } } }));
  return dir;
}
function invoke(dir, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  return result;
}
for (const [kind, source] of Object.entries(kinds)) {
  for (const alias of ['direct', 'symlink', 'hardlink', 'parent-symlink']) {
    const dir = prepare(`${kind}-${alias}`);
    if (kind === 'automaticConfig') writeFileSync(join(dir, source), '{"budget":400}\n');
    let output = source;
    if (alias === 'symlink') { output = 'alias'; symlinkSync(source, join(dir, output)); }
    if (alias === 'hardlink') { output = 'alias'; linkSync(join(dir, source), join(dir, output)); }
    if (alias === 'parent-symlink') { symlinkSync('.', join(dir, 'parent')); output = `parent/${source}`; }
    const args = [...(kind === 'clientConfig' || kind === 'envFile' ? ['config', 'mcp.json'] : ['file', 'tools.json']),
      ...(kind === 'explicitConfig' ? ['--config', 'rules.json'] : []), '--format', 'json', '--output', output];
    const original = readFileSync(join(dir, source));
    const result = invoke(dir, args), after = readFileSync(join(dir, source));
    assert.equal(result.status, mode === 'before' ? 0 : 2, result.stderr);
    assert.equal(original.equals(after), mode === 'after');
    const started = existsSync(join(dir, 'started.txt'));
    assert.equal(started, mode === 'before' && ['clientConfig', 'envFile'].includes(kind));
    assert(!readdirSync(dir).some(name => name.endsWith('.tmp')));
    rows.push({ kind, alias, exit: result.status, inputBytes: original.length, afterBytes: after.length,
      inputSha256: sha(original), afterSha256: sha(after), inputPreserved: original.equals(after), serverStarted: started });
    if (mode === 'after' && alias === 'direct' && ['definitions', 'envFile'].includes(kind)) {
      terminal.push(`$ mcplint ${args.join(' ')}\n${result.stderr}exit: ${result.status}; input unchanged; server started: ${started}\n`);
    }
  }
}
const safe = [];
for (const format of ['terminal', 'json', 'sarif', 'markdown', 'html']) {
  const dir = prepare(`safe-${format}`);
  writeFileSync(join(dir, 'report'), 'previous report');
  const result = invoke(dir, ['file', 'tools.json', '--format', format, '--output', 'report']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(join(dir, 'tools.json')), fixture);
  const text = readFileSync(join(dir, 'report'), 'utf8');
  const timestamps = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g) ?? [];
  assert.equal(timestamps.length, format === 'sarif' ? 0 : 1);
  const normalized = timestamps.length ? text.replace(timestamps[0], '<generatedAt>') : text;
  safe.push({ format, exit: result.status, bytes: Buffer.byteLength(text), sha256: sha(text),
    normalizedSha256: sha(normalized), removedGenerationTimestamps: timestamps.length, inputPreserved: true });
  if (format === 'json') assert.equal(JSON.parse(text).summary.complete, true);
}
const receipt = { mode, node: process.version, fixture: 'tests/fixtures/reference-servers/server-filesystem.json',
  fixtureSha256: sha(fixture), cases: rows, safe };
writeFileSync(join(root, 'replay.json'), JSON.stringify(receipt, null, 2) + '\n');
if (mode === 'after') {
  terminal.push('Five ordinary report formats replaced successfully; original definitions unchanged.\n');
  writeFileSync(join(root, 'terminal.txt'), terminal.join('\n'));
}
console.log(JSON.stringify({ mode, cases: rows.length, safe: safe.map(row => ({ format: row.format, exit: row.exit })) }));
