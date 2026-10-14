import { Transform, type TransformCallback } from 'node:stream';
import { TextDecoder } from 'node:util';
import { createParser } from 'eventsource-parser';
import { JsonIntegrityError, readJson } from '../core/read-json.js';
import type { LintTarget } from '../core/types.js';
import { SseMessageBounds } from './sse-bounds.js';

/** Only our own diagnostics may cross into a report or terminal message. */
export class LiveJsonIntegrityError extends Error {
  constructor(detail: string) {
    super(`Live server metadata could not be read faithfully. ${detail}`);
    this.name = 'LiveJsonIntegrityError';
  }
}

export function retainIntegrityFailure(target: LintTarget, error?: LiveJsonIntegrityError): LintTarget {
  if (!error) return target;
  const incomplete = target.collection?.find(record => record.status === 'incomplete');
  if (incomplete) incomplete.detail = error.message;
  else {
    // An invalid notification can close the connection after a valid final page.
    // Keep those definitions, but never call the interrupted collection complete.
    (target.collection ??= []).push({
      serverId: target.servers[0]!.id, scope: 'connection', status: 'incomplete',
      pages: 0, received: 0, retained: 0, detail: error.message,
    });
  }
  return target;
}

function checkJson(text: string): void {
  try { readJson(text); }
  catch (error) {
    throw new LiveJsonIntegrityError(error instanceof JsonIntegrityError
      ? error.message : 'The server sent invalid JSON. Check the server response format.');
  }
}

function decode(decoder: TextDecoder, bytes?: Uint8Array, stream = false): string {
  try { return decoder.decode(bytes, { stream }); }
  catch { throw new LiveJsonIntegrityError('The server sent invalid UTF-8 text.'); }
}

// Matches the SDK's existing stdio read-buffer ceiling, including line endings.
export const MAX_STDIO_MESSAGE_BYTES = 10 * 1024 * 1024;
/** Fetch supplies decompressed response bytes. The bound precedes JSON/SDK decoding. */
export const MAX_HTTP_MESSAGE_BYTES = 10 * 1024 * 1024;

/** Release only validated, complete lines. Earlier good messages remain usable
 * even when the same read contains a later damaged message. */
export class JsonLineGuard extends Transform {
  private pieces: Buffer[] = [];
  private bytes = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      for (let start = 0; start < chunk.length;) {
        const newline = chunk.indexOf(10, start);
        const end = newline < 0 ? chunk.length : newline + 1;
        const piece = chunk.subarray(start, end);
        this.bytes += piece.length;
        if (this.bytes > MAX_STDIO_MESSAGE_BYTES) {
          throw new LiveJsonIntegrityError('A stdio message exceeded the 10 MiB read limit.');
        }
        this.pieces.push(piece);
        if (newline >= 0) {
          const line = Buffer.concat(this.pieces, this.bytes);
          // Unlike HTTP JSON decoding, the SDK's stdio parser retains a BOM.
          checkJson(decode(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }), line));
          this.pieces = [];
          this.bytes = 0;
          this.push(line);
        }
        start = end;
      }
      callback();
    } catch (error) {
      this.pieces = [];
      this.bytes = 0;
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    callback(this.bytes ? new LiveJsonIntegrityError('The stdio stream ended inside a message.') : null);
    this.pieces = [];
    this.bytes = 0;
  }
}

/** Keep wire bytes, event IDs, retries and endpoint events intact. The same SSE
 * parser used by the SDK checks each message before its terminating bytes can
 * reach the SDK. Partial chunks cannot become a decoded metadata response. */
export function guardHttpResponse(
  response: Response, onFailure: (error: LiveJsonIntegrityError) => void,
): Response {
  if (!response.ok || !response.body) return response;
  const contentType = response.headers.get('content-type') ?? '';
  // Match the SDK's permissive dispatch, including SSE taking precedence.
  // Exact MIME matching here would leave accepted variants unguarded.
  const sse = contentType.includes('text/event-stream');
  if (!sse && !contentType.includes('application/json')) return response;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const bounds = sse ? new SseMessageBounds(MAX_HTTP_MESSAGE_BYTES, () => {
    throw new LiveJsonIntegrityError('An SSE line or event data exceeded the 10 MiB read limit.');
  }) : undefined;
  const parser = sse ? createParser({ onEvent(event) {
    if (Buffer.byteLength(event.data, 'utf8') > MAX_HTTP_MESSAGE_BYTES) {
      throw new LiveJsonIntegrityError('SSE event data exceeded the 10 MiB read limit.');
    }
    if (event.data && (!event.event || event.event === 'message')) checkJson(event.data);
  } }) : undefined;
  const pieces: Uint8Array[] = [];
  const text: string[] = [];
  let bytes = 0;
  const guarded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      try {
        if (bounds) bounds.feed(chunk);
        else {
          bytes += chunk.byteLength;
          if (bytes > MAX_HTTP_MESSAGE_BYTES) {
            throw new LiveJsonIntegrityError('An HTTP JSON response exceeded the 10 MiB read limit.');
          }
        }
        const decoded = decode(decoder, chunk, true);
        if (parser) {
          parser.feed(decoded);
          controller.enqueue(chunk);
        } else {
          pieces.push(chunk);
          text.push(decoded);
        }
      } catch (error) {
        pieces.length = 0;
        text.length = 0;
        const failure = error as LiveJsonIntegrityError;
        onFailure(failure);
        throw failure;
      }
    },
    flush(controller) {
      try {
        const end = decode(decoder);
        if (parser) parser.feed(end);
        else {
          text.push(end);
          checkJson(text.join(''));
          for (const piece of pieces) controller.enqueue(piece);
          pieces.length = 0;
          text.length = 0;
        }
      } catch (error) {
        pieces.length = 0;
        text.length = 0;
        const failure = error as LiveJsonIntegrityError;
        onFailure(failure);
        throw failure;
      }
    }
  }));
  const result = new Response(guarded, {
    status: response.status, statusText: response.statusText, headers: response.headers,
  });
  // Response's constructor cannot set fetch provenance. The SDK and EventSource
  // still need the original URL, particularly when resolving an SSE endpoint.
  for (const key of ['url', 'redirected', 'type'] as const) {
    Object.defineProperty(result, key, { value: response[key] });
  }
  return result;
}
