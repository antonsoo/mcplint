// Synthetic local servers only. Supply a built or installed dist/cli.js.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [cliArg, workArg, expectation] = process.argv.slice(2);
assert(cliArg && workArg && ['before', 'after'].includes(expectation),
  'Usage: node replay.mjs path/to/dist/cli.js NEW_WORK_DIR before|after');
const cli = await realpath(cliArg);
const dist = dirname(cli);
const work = resolve(workArg);
await mkdir(dirname(work), { recursive: true });
await mkdir(work);
await copyFile(fileURLToPath(new URL('../../tests/fixtures/live-json.mjs', import.meta.url)),
  join(work, 'server.mjs'));
const { collectStdio } = await import(pathToFileURL(join(dist, 'collectors/stdio.js')));
const { collectHttp } = await import(pathToFileURL(join(dist, 'collectors/http.js')));
const { createMetadataSnapshot, compareMetadata } = await import(pathToFileURL(join(dist, 'core/metadata.js')));
const stamp = '2026-10-13T00:00:00.000Z'; // Fixed capture time for metadata byte comparisons.
const digest = data => createHash('sha256').update(data).digest('hex');
const tool = fields => '{"tools":[{"name":"read_sequence","description":' +
  '"Inspect a recorded sequence number without changing records or contacting another service.",' +
  '"inputSchema":{"type":"object","properties":{"sequence":{"type":"integer",' +
  '"description":"The minimum sequence number accepted by this synthetic local control.",' +
  fields + '}},"required":["sequence"],"additionalProperties":false}}]}';
const valid = tool('"minimum":9007199254740992');
const rounded = tool('"minimum":9007199254740993');
const duplicate = tool('"minimum":1,"mini\\u006dum":2');
const result = { node: process.version, expectation, synthetic: true, api: [], cli: [], complete: false };
const save = () => writeFile(join(work, 'receipt.json'), JSON.stringify(result, null, 2) + '\n');
await save();

async function collect(mode, payload, page = 'first') {
  if (mode === 'stdio') return collectStdio({
    command: process.execPath, args: ['server.mjs', payload, page], cwd: work,
  });
  let stream;
  const methods = [];
  const server = createServer((req, res) => void (async () => {
    if (mode === 'legacy-sse' && req.method === 'GET' && req.url === '/sse') {
      stream = res;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': control comment\r\nretry: 1000\r\nevent: endpoint\r\ndata: /messages\r\n\r\n');
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    methods.push(message.method);
    let data;
    if (message.method === 'initialize') data = JSON.stringify({
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} }, serverInfo: { name: 'raw-json-control', version: '1' },
    });
    else if (message.method === 'tools/list') data = page === 'second' && !message.params?.cursor
      ? '{"tools":[{"name":"first_page","inputSchema":{"type":"object"}}],"nextCursor":"next"}'
      : payload;
    else { res.writeHead(202).end(); return; }
    const text = '{"jsonrpc":"2.0","id":' + JSON.stringify(message.id) + ',"result":' + data + '}';
    const event = 'id: observed\nevent: message\ndata: ' +
      text.replace(',"result":', ',\ndata: "result":') + '\n\n';
    if (mode === 'legacy-sse') { res.writeHead(202).end(); stream.write(event); }
    else if (mode === 'streamable-sse') res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(event);
    else res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(text);
  })().catch(error => { res.writeHead(500).end(String(error)); }));
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const target = await collectHttp({
      url: `http://127.0.0.1:${server.address().port}/${mode === 'legacy-sse' ? 'sse' : 'mcp'}`,
      ...(mode === 'legacy-sse' ? { transport: 'sse' } : {}),
    });
    assert(methods.every(method => ['initialize', 'notifications/initialized', 'tools/list'].includes(method)));
    return target;
  } finally {
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
  }
}

for (const mode of ['stdio', 'json', 'streamable-sse', 'legacy-sse']) {
  const captures = [];
  for (const [name, payload, page] of [
    ['valid', valid, 'first'], ['rounded', rounded, 'first'], ['duplicate-second-page', duplicate, 'second'],
  ]) {
    const target = await collect(mode, payload, page);
    const snapshot = createMetadataSnapshot(target, stamp);
    const bytes = JSON.stringify(snapshot, null, 2) + '\n';
    const filename = `${mode}-${name}.snapshot.json`;
    await writeFile(join(work, filename), bytes);
    captures.push({ name, raw_result: payload, filename, sha256: digest(bytes), snapshot });
  }
  const comparison = compareMetadata(captures[0].snapshot, captures[1].snapshot);
  assert.equal(comparison.complete, expectation === 'before');
  assert.equal(comparison.summary.removed, 0);
  const first = captures[0].snapshot.definitions[0].value;
  assert.equal(first.inputSchema.properties.sequence.minimum, 9007199254740992);
  if (expectation === 'before') {
    assert.deepEqual(captures[0].snapshot, captures[1].snapshot);
    assert.equal(captures[2].snapshot.definitions.length, 2);
  } else {
    assert.equal(captures[1].snapshot.definitions.length, 0);
    assert.equal(captures[2].snapshot.definitions.length, 1);
    assert.equal(captures[2].snapshot.definitions[0].value.name, 'first_page');
    assert(captures[2].snapshot.collection.some(row => row.status === 'incomplete'));
  }
  result.api.push({ mode, captures, comparison });
  await save();
  console.log(mode, comparison.complete ? 'falsely unchanged' : 'explicitly incomplete');
}

async function execute(name, args) {
  const captured = await new Promise(resolveExit => execFile(process.execPath, [cli, ...args], {
    cwd: work, env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, NO_COLOR: '1' },
    timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
  }, (error, stdout, stderr) => resolveExit({
    exit: error ? error.code : 0, signal: error?.signal ?? null, stdout, stderr,
  })));
  assert.equal(captured.signal, null, `${name} exceeded the study deadline or was signalled`);
  assert.equal(typeof captured.exit, 'number');
  await writeFile(join(work, name + '.stdout'), captured.stdout);
  await writeFile(join(work, name + '.stderr'), captured.stderr);
  result.cli.push({ name, arguments: args, ...captured });
  await save();
  return captured;
}

for (const [name, payload] of [['valid', valid], ['rounded', rounded]]) {
  await execute(name, ['stdio', '--format', 'json', '--fail-on', 'error', '--snapshot', name + '.json',
    '--', 'node', 'server.mjs', payload, 'first']);
}
const diff = await execute('diff', ['diff', 'valid.json', 'rounded.json', '--format', 'json']);
assert.equal(diff.exit, expectation === 'before' ? 0 : 2);
const html = await execute('html', ['diff', 'valid.json', 'rounded.json', '--format', 'html', '--output', 'diff.html']);
assert.equal(html.exit, diff.exit);
const report = JSON.parse(result.cli.find(row => row.name === 'rounded').stdout);
if (expectation === 'after') {
  assert.equal(report.summary.complete, false);
  assert.equal(report.summary.score, null);
  assert.equal(result.cli.find(row => row.name === 'rounded').exit, 1);
}
result.html_sha256 = digest(await readFile(join(work, 'diff.html')));
result.complete = true;
await save();
console.log('CLI diff exit', diff.exit);
