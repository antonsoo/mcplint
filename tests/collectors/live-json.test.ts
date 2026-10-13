import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { collectHttp } from '../../src/collectors/http.js';
import { collectStdio } from '../../src/collectors/stdio.js';
import { connectionFailureMessage } from '../../src/collectors/diagnostics.js';
import { guardHttpResponse, JsonLineGuard, LiveJsonIntegrityError, MAX_STDIO_MESSAGE_BYTES } from '../../src/collectors/live-json.js';
import { compareMetadata, createMetadataSnapshot } from '../../src/core/metadata.js';

type Mode = 'stdio' | 'json' | 'streamable-sse' | 'legacy-sse';
type Page = 'first' | 'second' | 'initialize' | 'notification' | 'stubborn';
const modes: Mode[] = ['stdio', 'json', 'streamable-sse', 'legacy-sse'];
const fixture = fileURLToPath(new URL('../fixtures/live-json.mjs', import.meta.url));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
const tools = (constraint: string): string => `{"tools":[{"name":"read_sequence","inputSchema":{"type":"object","properties":{"sequence":{${constraint}}}}}]}`;
const valid = tools('"type":"integer","minimum":9007199254740992');

async function collect(mode: Mode, payload: string, page: Page = 'first', pidFile?: string) {
  if (mode === 'stdio') return collectStdio({
    command: process.execPath, args: [fixture, payload, page, ...(pidFile ? [pidFile] : [])],
  });
  let stream: ServerResponse | undefined;
  const server = createServer((req, res) => { void (async () => {
    if (mode === 'legacy-sse' && req.method === 'GET' && req.url === '/sse') {
      stream = res;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Endpoint data is a URL, not JSON. Neither comments nor retry fields are metadata.
      res.write(': {not JSON}\nretry: 1000\nevent: endpoint\ndata: /messages\n\n');
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const request = JSON.parse(Buffer.concat(chunks).toString()) as {
      method: string; id: number; params?: { protocolVersion?: string; cursor?: string };
    };
    let result: string;
    if (request.method === 'initialize') result = page === 'initialize' ? payload : JSON.stringify({
      protocolVersion: request.params?.protocolVersion,
      serverInfo: { name: 'raw-json-control', version: '1' }, capabilities: { tools: {} },
    });
    else if (request.method === 'tools/list') result = page === 'second' && !request.params?.cursor
      ? '{"tools":[{"name":"first_page","inputSchema":{"type":"object"}}],"nextCursor":"next"}'
      : payload;
    else { res.writeHead(202).end(); return; }
    const text = `{"jsonrpc":"2.0","id":${request.id},"result":${result}}`;
    // Multi-line data and CRLF must retain exactly the same JSON string value.
    const event = `id: received\r\nevent: message\r\ndata: ${text.replace(',"result":', ',\r\ndata: "result":')}\r\n\r\n`;
    if (mode === 'legacy-sse') { res.writeHead(202).end(); stream!.write(event); }
    else if (mode === 'streamable-sse') res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(event);
    else res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(text);
  })().catch(() => { res.writeHead(500).end(); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No test server port.');
  return collectHttp({
    url: `http://127.0.0.1:${address.port}/${mode === 'legacy-sse' ? 'sse' : 'mcp'}`,
    ...(mode === 'legacy-sse' ? { transport: 'sse' as const } : {}),
  });
}

describe.each(modes)('raw JSON through %s', mode => {
  it('keeps a representable integer but cannot claim its rounded neighbor is unchanged', async () => {
    const before = await collect(mode, valid);
    const after = await collect(mode, tools('"type":"integer","minimum":9007199254740993'));
    expect(before.tools).toHaveLength(1);
    expect(before.collection?.[0]?.status).toBe('complete');
    expect(after.tools).toHaveLength(0);
    expect(after.collection?.[0]).toMatchObject({ status: 'incomplete', pages: 0 });
    expect(after.collection?.[0]?.detail).toContain('rounded');
    const diff = compareMetadata(createMetadataSnapshot(before), createMetadataSnapshot(after));
    expect(diff.complete).toBe(false);
    expect(diff.summary.removed).toBe(0);
  }, 30_000);

  it.each([
    ['duplicate', '"minimum":1,"mini\\u006dum":2', 'Duplicate'],
    ['overflow', '"minimum":1e400', 'finite'],
    ['underflow', '"minimum":1e-400', 'underflows'],
    ['decimal', '"minimum":1.0000000000000001', 'rounded'],
  ])('retains the previous page before a %s response', async (_name, field, diagnostic) => {
    const result = await collect(mode, tools(field), 'second');
    expect(result.tools.map(t => t.name)).toEqual(['first_page']);
    expect(result.collection?.[0]).toMatchObject({ status: 'incomplete', pages: 1, retained: 1 });
    expect(result.collection?.[0]?.detail).toContain(diagnostic);
  }, 30_000);

  it('refuses an ambiguous initialize response without echoing its content', async () => {
    let caught: unknown;
    try { await collect(mode, '{"secret-canary":1,"secret-canary":2}', 'initialize'); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(LiveJsonIntegrityError);
    expect(connectionFailureMessage(caught)).toContain('Duplicate');
    expect(connectionFailureMessage(caught)).not.toContain('secret-canary');
  }, 30_000);
});

it.each(['first', 'stubborn'] as const)('joins cleanup of a %s stdio child after an integrity failure', async page => {
  const dir = await mkdtemp(join(tmpdir(), 'mcplint-live-json-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const pidFile = join(dir, 'pid');
  await collect('stdio', tools('"minimum":1e400'), page, pidFile);
  const pid = Number(await readFile(pidFile, 'utf8'));
  expect(() => process.kill(pid, 0)).toThrow();
}, 15_000);

it('keeps a good final page but marks a following invalid notification incomplete', async () => {
  const target = await collect('stdio', valid, 'notification');
  expect(target.tools.map(tool => tool.name)).toEqual(['read_sequence']);
  expect(target.collection?.find(record => record.scope === 'connection')).toMatchObject({
    status: 'incomplete', retained: 0,
  });
});

it('checks split UTF-8 and escaped JSON across single-byte stdio reads', async () => {
  const raw = Buffer.from('{"text":"Néon λ \\"minimum\\":9007199254740993","n":1e0}\r\n');
  const guard = new JsonLineGuard();
  const parts: Buffer[] = [];
  for await (const part of Readable.from([...raw].map(byte => Buffer.from([byte]))).pipe(guard)) {
    parts.push(part as Buffer);
  }
  expect(Buffer.concat(parts)).toEqual(raw);
});

it.each([
  ['UTF-8', Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125, 10])],
  ['inside a message', Buffer.from('{"x":1}')],
  ['invalid JSON', Buffer.from('{secret-canary}\n')],
  ['10 MiB', Buffer.alloc(MAX_STDIO_MESSAGE_BYTES + 1, 120)],
])('refuses damaged stdio framing: %s', async (diagnostic, raw) => {
  const consume = async (): Promise<void> => {
    for await (const part of Readable.from([raw]).pipe(new JsonLineGuard())) { void part; }
  };
  await expect(consume()).rejects.toThrow(diagnostic);
});

it.each(['application/json', 'text/event-stream'])('rejects malformed UTF-8 in %s', async mime => {
  const bytes = Buffer.concat([
    Buffer.from(mime === 'application/json' ? '{"text":"' : 'data: {"text":"'),
    Buffer.from([0xff]), Buffer.from(mime === 'application/json' ? '"}' : '"}\n\n'),
  ]);
  const failures: Error[] = [];
  const response = guardHttpResponse(new Response(bytes, { headers: { 'Content-Type': mime } }),
    error => failures.push(error));
  await expect(response.text()).rejects.toBeInstanceOf(LiveJsonIntegrityError);
  expect(failures[0]?.message).toContain('UTF-8');
});

it('preserves SSE bytes, split Unicode, retry fields and endpoint events', async () => {
  const raw = Buffer.from(': comment\r\nretry: 1234\revent: endpoint\rdata: /messages\r\r' +
    'id: one\nevent: message\ndata: {"text":"Néon λ",\ndata: "n":1.0}\n\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of raw) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const response = guardHttpResponse(new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  }), error => { throw error; });
  expect(Buffer.from(await response.arrayBuffer())).toEqual(raw);
});

it.each(['application/json', 'application/json; charset=utf-8', 'application/json-extra'])(
  'guards every content-type spelling the SDK dispatches as JSON: %s', async mime => {
    const failures: Error[] = [];
    const response = guardHttpResponse(new Response('{"n":9007199254740993}', {
      headers: { 'Content-Type': mime },
    }), error => failures.push(error));
    await expect(response.json()).rejects.toBeInstanceOf(LiveJsonIntegrityError);
    expect(failures[0]?.message).toContain('rounded');
  },
);
