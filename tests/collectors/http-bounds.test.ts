import { describe, expect, it, vi } from 'vitest';
import { createParser } from 'eventsource-parser';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { SseMessageBounds } from '../../src/collectors/sse-bounds.js';
import { guardHttpResponse, LiveJsonIntegrityError, MAX_HTTP_MESSAGE_BYTES } from '../../src/collectors/live-json.js';

const fail = (): never => { throw new Error('bound exceeded'); };

describe('SSE framing preserves independent event-parser boundaries', () => {
  it.each(['\n', '\r', '\r\n', '\n\n\n\n\r'])('bounds total separator search work for %j comments', ending => {
    const bytes = new TextEncoder().encode((':' + ending).repeat(4096));
    const nativeIndexOf = bytes.indexOf.bind(bytes);
    let searchedBytes = 0;
    const search = vi.spyOn(bytes, 'indexOf').mockImplementation((value, start = 0) => {
      const found = nativeIndexOf(value, start);
      searchedBytes += (found < 0 ? bytes.length : found + 1) - start;
      return found;
    });
    try {
      new SseMessageBounds(16, fail).feed(bytes);
      // A byte may be visited once per separator, not once per remaining line.
      // This measures actual search work instead of a host-dependent timeout.
      expect(searchedBytes).toBeLessThanOrEqual(bytes.length * 2);
    } finally { search.mockRestore(); }
  });

  it.each(['\n', '\r\n', '\r'])('keeps split %j framing, Unicode bytes, BOM and repeated event/header lines', ending => {
    const raw = Buffer.from('\ufeff: initial comment' + ending +
      ['event: message', 'id: one', 'data: λλ', 'retry: 1000', 'data', '',
        'data:🙂', 'data:  x', '', ': comment', 'data: final', '', ''].join(ending));
    const events: string[] = [];
    const parser = createParser({ onEvent: event => events.push(event.data) });
    const decoder = new TextDecoder();
    const bound = new SseMessageBounds(24, fail);
    for (const byte of raw) {
      const chunk = Uint8Array.of(byte);
      bound.feed(chunk);
      parser.feed(decoder.decode(chunk, { stream: true }));
    }
    parser.feed(decoder.decode());
    // Final CR is held by the reference parser until it can see the next byte.
    parser.feed(ending);
    expect(events).toEqual(['λλ\n', '🙂\n x', 'final']);
  });

  it('counts UTF-8 bytes and joined data newlines, while allowing independent events', () => {
    const bound = new SseMessageBounds(16, fail);
    bound.feed(Buffer.from('data: λλλλ\ndata: xx\n\n')); // 8 + 1 + 2 bytes
    bound.feed(Buffer.from('data: 🙂🙂\n\n')); // a separate 8-byte event
    expect(() => bound.feed(Buffer.from('data: λλλλ\ndata: λλλλ\n'))).toThrow('bound'); // 8 + 1 + 8
  });

  it('does not mistake a partial unknown field named dataXYZ for a bare data line', () => {
    const bound = new SseMessageBounds(12, fail);
    bound.feed(Buffer.from('data: 123456\ndata: 12345\n')); // exactly 12 joined data bytes
    bound.feed(Buffer.from('data'));
    expect(() => bound.feed(Buffer.from('XYZ: x\n\n'))).not.toThrow();
  });

  it('caps buffered headers and comments even without a data event or delimiter', () => {
    for (const field of [':', 'id:', 'event:', 'unknown:']) {
      const bound = new SseMessageBounds(16, fail);
      expect(() => bound.feed(Buffer.from(field + 'x'.repeat(17)))).toThrow('bound');
    }
  });

  it('does not accumulate completed comments, retries or overwritten IDs into a lifetime byte cap', () => {
    const bound = new SseMessageBounds(16, fail);
    for (let i = 0; i < 100; i++) bound.feed(Buffer.from(': heartbeat\nid: next\nretry: 12\n'));
    expect(() => bound.feed(Buffer.from('data: known\n\n'))).not.toThrow();
  });
});

async function consume(parts: Uint8Array[], mime: string) {
  const failures: LiveJsonIntegrityError[] = [];
  let index = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (index < parts.length) controller.enqueue(parts[index++]!); else controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const response = guardHttpResponse(new Response(body, { headers: { 'Content-Type': mime } }), error => failures.push(error));
  let caught: unknown;
  let bytes: ArrayBuffer | undefined;
  try { bytes = await response.arrayBuffer(); } catch (error) { caught = error; }
  // pipeThrough propagates upstream cancellation after the reader's rejection.
  await new Promise<void>(resolve => setImmediate(resolve));
  return { failures, caught, cancelled, readParts: index, bytes };
}

it('permits an exact JSON byte bound and rejects one extra byte before pulling the following chunk', async () => {
  const raw = Buffer.from('{"x":"' + 'x'.repeat(MAX_HTTP_MESSAGE_BYTES - 8) + '"}');
  expect(raw.byteLength).toBe(MAX_HTTP_MESSAGE_BYTES);
  const accepted = await consume([raw], 'application/json');
  expect(accepted.caught).toBeUndefined();
  expect(createHash('sha256').update(Buffer.from(accepted.bytes!)).digest('hex'))
    .toBe(createHash('sha256').update(raw).digest('hex'));
  const refused = await consume([raw, Buffer.from(' '), Buffer.alloc(1024 * 1024)], 'application/json');
  expect(refused.caught).toBeInstanceOf(LiveJsonIntegrityError);
  expect(refused.failures).toHaveLength(1);
  expect(refused.readParts).toBe(2);
  expect(refused.cancelled).toBe(true);
});

it.each(['data: ', 'id: ', ': '])('refuses an oversized SSE %s line before parsing or pulling more bytes', async prefix => {
  const refused = await consume([Buffer.from(prefix), Buffer.alloc(MAX_HTTP_MESSAGE_BYTES + 1, 120), Buffer.from('\n\n')], 'text/event-stream');
  expect(refused.caught).toBeInstanceOf(LiveJsonIntegrityError);
  expect(refused.failures).toHaveLength(1);
  expect(refused.readParts).toBe(2);
  expect(refused.cancelled).toBe(true);
});

it('refuses joined SSE data above the bound when each line and the received chunk is smaller', async () => {
  const line = Buffer.from('data: ' + 'x'.repeat(1024 * 1024) + '\n');
  const refused = await consume([...Array.from({ length: 11 }, () => line), Buffer.from('\n')], 'text/event-stream');
  expect(refused.caught).toBeInstanceOf(LiveJsonIntegrityError);
  expect(refused.failures).toHaveLength(1);
  expect(refused.readParts).toBe(10);
  expect(refused.cancelled).toBe(true);
});

it('applies the JSON bound after fetch decompression despite a small compressed Content-Length', async () => {
  const compressed = gzipSync(Buffer.alloc(MAX_HTTP_MESSAGE_BYTES + 1, 32));
  expect(compressed.byteLength).toBeLessThan(20_000);
  const server = createServer((_request, response) => response.writeHead(200, {
    'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': compressed.byteLength,
  }).end(compressed));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing local server address.');
    const failures: LiveJsonIntegrityError[] = [];
    const response = guardHttpResponse(await fetch(`http://127.0.0.1:${address.port}/`), error => failures.push(error));
    await expect(response.arrayBuffer()).rejects.toThrow('10 MiB read limit');
    expect(failures).toHaveLength(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
