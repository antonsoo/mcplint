import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [directory, output, mode = 'observe'] = process.argv.slice(2);
const root = resolve(directory);
const { guardHttpResponse } = await import(pathToFileURL(resolve(root, 'collectors/live-json.js')));
const { collectHttp } = await import(pathToFileURL(resolve(root, 'collectors/http.js')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const comments = count => Buffer.from(':\n'.repeat(count / 2));
const responseBytes = count => Buffer.concat([comments(count), Buffer.from('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n')]);
const guarded = [];
for (const count of [0, 262144, 1048576]) {
  const bytes = responseBytes(count);
  const failures = [];
  const started = performance.now();
  const timer = new Promise(resolve => setTimeout(() => resolve(performance.now() - started), 0));
  const response = guardHttpResponse(new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { headers: { 'content-type': 'text/event-stream' } }), error => failures.push(error.message));
  const received = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(received, bytes);
  assert.deepEqual(failures, []);
  const durationMs = performance.now() - started;
  const timerDelayMs = await timer;
  guarded.push({ commentBytes: count, bytes: bytes.length, sha256: sha(bytes),
    outputMatchesInput: true, failures, durationMs, zeroDelayTimerDeliveredAfterMs: timerDelayMs });
}
let commentBytes = 0;
const requests = [];
const server = createServer((req, res) => {
  void (async () => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const pieces = [];
    for await (const piece of req) pieces.push(piece);
    const message = JSON.parse(Buffer.concat(pieces).toString());
    requests.push(message.method);
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    const result = message.method === 'initialize' ? {
      protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'sse-comment-capture', version: '1.0.0' },
    } : { tools: [{ name: 'lookup_record', description: 'Look up a record by its stable ID.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }] };
    const body = Buffer.concat([comments(commentBytes), Buffer.from('event: message\ndata: ' +
      JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n\n')]);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Content-Length': body.length }).end(body);
  })().catch(error => { res.destroy(error); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const network = [];
try {
  for (const count of [0, 1048576, 12582912]) {
    commentBytes = count;
    requests.length = 0;
    const started = performance.now();
    let target, failure;
    try {
      target = await collectHttp({ url: `http://127.0.0.1:${server.address().port}/mcp`,
        label: 'controlled-loopback-sse', connectTimeoutMs: 5000 });
      assert.equal(target.tools[0].name, 'lookup_record');
      assert.ok(target.collection.every(scope => scope.status === 'complete' || scope.status === 'unsupported'));
    } catch (error) {
      failure = { name: error.name, message: error.message };
    }
    network.push({ commentBytesPerResponse: count, connectTimeoutMs: 5000,
      seconds: (performance.now() - started) / 1000, requests: [...requests],
      ...(failure ? { failure } : { target }) });
    console.log(JSON.stringify({commentBytes: count, seconds: network.at(-1).seconds, failure}));
    if (mode === 'verify') assert.equal(failure, undefined);
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
const moduleFiles = ['collectors/sse-bounds.js', 'collectors/live-json.js', 'collectors/http.js'];
const sourceHashes = Object.fromEntries(await Promise.all(moduleFiles.map(async path =>
  [path, sha(await readFile(resolve(root, path)))])));
await writeFile(output, JSON.stringify({ node: process.version, platform: process.platform,
  synthetic: true, hostLoad: 'Concurrent workloads; timings are observations, not isolated benchmarks',
  sourceHashes, guarded, network }, null, 2) + '\n');
console.log(JSON.stringify({ guarded: guarded.map(r => [r.commentBytes, r.durationMs]),
  network: network.map(r => [r.commentBytesPerResponse, r.seconds]) }));
