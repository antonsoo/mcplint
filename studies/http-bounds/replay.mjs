// Loopback SDK controls and labelled oversized responses; no external servers or tools run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const [cliArg, workArg, expectation] = process.argv.slice(2);
assert(cliArg && workArg && ['before', 'after'].includes(expectation), 'Expected CLI NEW_WORK_DIR before|after');
const cli = resolve(cliArg), work = resolve(workArg);
await mkdir(work);
const first = { name: 'read_sequence', description: 'Read a recorded local sequence number without changing any records.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
const second = { ...first, name: 'read_record', description: 'Read a recorded local record without changing it or contacting another service.' };
const pad = Buffer.alloc(1024 * 1024, 120);
const mib = 96;
const sha = raw => createHash('sha256').update(raw).digest('hex');
const receipt = { node: process.version, expectation, heapMiB: 256, synthetic: true, cases: [], complete: false,
  driverSha256: sha(await readFile(fileURLToPath(import.meta.url))) };
const save = () => writeFile(resolve(work, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
const modes = ['json', 'streamable-sse', 'legacy-sse'];

async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString()); }
function drain(res) {
  return new Promise(done => {
    const finish = () => { res.off('drain', finish); res.off('close', finish); done(); };
    res.once('drain', finish); res.once('close', finish);
  });
}
async function send(res, pieces) {
  let attemptedBytes = 0;
  for (const piece of pieces) {
    if (res.destroyed) break;
    attemptedBytes += Buffer.byteLength(piece);
    if (!res.write(piece)) await drain(res);
  }
  return attemptedBytes;
}

async function serverFor(mode, attack) {
  let stream;
  const sessions = new Map(), clients = new Set(), methods = [], wire = [];
  const sdkServer = () => {
    const sdk = new Server({ name: 'http-byte-bound-control', version: '1' }, { capabilities: { tools: {} } });
    sdk.setRequestHandler(ListToolsRequestSchema, request => request.params?.cursor
      ? { tools: [second] } : { tools: [first], nextCursor: 'second' });
    clients.add(sdk); return sdk;
  };
  const server = createServer((req, res) => void (async () => {
    if (mode === 'legacy-sse' && req.method === 'GET') {
      if (!attack) {
        const transport = new SSEServerTransport('/messages', res);
        sessions.set(transport.sessionId, transport);
        await sdkServer().connect(transport);
      } else {
        stream = res;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': heartbeat\r\nretry: 1000\r\nevent: endpoint\r\ndata: /messages\r\n\r\n');
      }
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    // Legacy servers reject the automatic Streamable HTTP probe at /sse.
    if (mode === 'legacy-sse' && new URL(req.url, 'http://localhost').pathname !== '/messages') {
      res.writeHead(405).end(); return;
    }
    const message = await body(req); methods.push(message.method);
    if (!attack) {
      if (mode === 'legacy-sse') {
        const transport = sessions.get(new URL(req.url, 'http://localhost').searchParams.get('sessionId'));
        if (!transport) { res.writeHead(404).end(); return; }
        await transport.handlePostMessage(req, res, message);
      } else {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: mode === 'json' });
        await sdkServer().connect(transport);
        await transport.handleRequest(req, res, message);
      }
      return;
    }
    let result;
    if (message.method === 'initialize' && attack !== 'initialize') result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'http-byte-bound-control', version: '1' } };
    else if (message.method === 'initialize') { /* labelled oversized initialization below */ }
    else if (message.method === 'tools/list' && !message.params?.cursor) result = { tools: [first], nextCursor: 'second' };
    else if (message.method !== 'tools/list') { res.writeHead(202).end(); return; }
    const text = result && JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
    const target = mode === 'legacy-sse' ? stream : res;
    if (mode === 'legacy-sse') res.writeHead(202).end();
    else res.writeHead(200, { 'Content-Type': mode === 'json' ? 'application/json' : 'text/event-stream' });
    const eventPrefix = mode === 'json' ? '' : 'id: observed\r\nevent: message\r\ndata: ';
    if (text) {
      await send(target, [eventPrefix, text, mode === 'json' ? '' : '\r\n\r\n']);
    } else {
      const initialize = message.method === 'initialize';
      const prefix = eventPrefix + '{"jsonrpc":"2.0","id":' + JSON.stringify(message.id) + ',"result":' + (initialize
        ? '{"protocolVersion":' + JSON.stringify(message.params.protocolVersion) + ',"capabilities":{"tools":{}},"serverInfo":{"name":"http-byte-bound-control","version":"1"},"instructions":"'
        : '{"tools":[{"name":"oversized_metadata","description":"');
      const suffix = (initialize ? '"}}' : '","inputSchema":{"type":"object"}}]}}') + (mode === 'json' ? '' : '\r\n\r\n');
      const hash = createHash('sha256').update(prefix);
      for (let i = 0; i < mib; i++) hash.update(pad);
      hash.update(suffix);
      const attemptedBytes = await send(target, [prefix, ...Array.from({ length: mib }, () => pad), suffix]);
      wire.push({ id: message.id, constructedBytes: Buffer.byteLength(prefix) + mib * pad.length + Buffer.byteLength(suffix),
        constructedSha256: hash.digest('hex'), attemptedBytes, prefix, padding: `${mib} repetitions of 1 MiB ASCII x`, suffix });
    }
    if (mode !== 'legacy-sse' && !target.destroyed) target.end();
  })().catch(error => { if (!res.destroyed) res.destroy(error); }));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}/${mode === 'legacy-sse' ? 'sse' : 'mcp'}`, methods, wire,
    async close() { server.closeAllConnections(); server.close(); await Promise.all([...clients].map(client => client.close())); } };
}

async function execute(label, args) {
  const started = performance.now();
  const captured = await new Promise(done => execFile(process.execPath, ['--max-old-space-size=256', cli, ...args], {
    cwd: work, env: { ...process.env, NO_COLOR: '1' }, timeout: 35000, maxBuffer: 8 * 1024 * 1024,
  }, (error, stdout, stderr) => done({ exit: error ? error.code ?? null : 0, signal: error?.signal ?? null, stdout, stderr })));
  const record = { label, command: ['node', '--max-old-space-size=256', 'mcplint', ...args], seconds: (performance.now() - started) / 1000, ...captured };
  await writeFile(resolve(work, label + '.stdout'), captured.stdout);
  await writeFile(resolve(work, label + '.stderr'), captured.stderr);
  return record;
}

for (const mode of modes) {
  for (const attack of [false, true, 'initialize']) {
    const label = `${mode}-${attack === 'initialize' ? 'oversized-initialize' : attack ? 'oversized-second-page' : 'sdk-control'}`;
    const server = await serverFor(mode, attack);
    try {
      const captured = await execute(label, ['http', server.url, '--format', 'json', '--fail-on', 'error', '--snapshot', label + '.snapshot.json']);
      const report = captured.stdout ? JSON.parse(captured.stdout) : null;
      const row = { ...captured, mode, attack, methods: server.methods, wire: server.wire, report };
      receipt.cases.push(row); await save();
      if (!attack) {
        assert.equal(captured.exit, 0, captured.stderr); assert.equal(captured.signal, null);
        assert.equal(report.summary.complete, true); assert.equal(report.summary.toolCount, 2);
        assert.equal(report.summary.score, 100);
      } else if (expectation === 'before') {
        assert.equal(captured.signal, 'SIGABRT'); assert.match(captured.stderr, /heap out of memory/);
        assert.equal(captured.stdout, '');
      } else if (attack === 'initialize') {
        assert.equal(captured.exit, 2, captured.stderr); assert.equal(captured.signal, null);
        assert.equal(captured.stdout, ''); assert.match(captured.stderr, /10 MiB/);
        assert.deepEqual(server.methods, ['initialize']);
      } else {
        assert.equal(captured.exit, 1, captured.stderr); assert.equal(captured.signal, null);
        assert.equal(report.summary.complete, false); assert.equal(report.summary.score, null);
        assert.equal(report.summary.toolCount, 1);
        assert.equal(report.collection[0].pages, 1); assert.equal(report.collection[0].retained, 1);
        assert.match(report.collection[0].detail, /10 MiB/);
      }
      assert(server.methods.every(method => ['initialize', 'notifications/initialized', 'tools/list'].includes(method)));
      console.log(`${label}: exit ${captured.exit}, signal ${captured.signal}, retained ${report?.summary.toolCount ?? 'no report'}`);
    } finally { await server.close(); }
  }
}
if (expectation === 'after') {
  const server = await serverFor('json', true);
  try {
    const html = await execute('incomplete-html', ['http', server.url, '--format', 'html', '--fail-on', 'error', '--output', 'incomplete.html']);
    assert.equal(html.exit, 1); assert.equal(html.signal, null);
    receipt.html = { ...html, bytes: (await readFile(resolve(work, 'incomplete.html'))).length, sha256: sha(await readFile(resolve(work, 'incomplete.html'))) };
  } finally { await server.close(); }
}
receipt.complete = true;
await save();
console.log(`Completed ${receipt.cases.length} live CLI workflows.`);
