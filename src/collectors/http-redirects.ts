import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const bodyHeaders = ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length'];

export class HttpRedirectError extends Error {
  constructor(reason: 'origin' | 'limit' | 'invalid') {
    super(reason === 'origin'
      ? 'HTTP redirect blocked: the destination has a different origin. Configure the intended final server URL explicitly before sending credentials.'
      : reason === 'limit'
        ? 'HTTP redirect limit exceeded (20 redirects). Check the server URL and redirect configuration.'
        : 'HTTP redirect blocked: the destination is not a valid HTTP(S) URL without embedded credentials. Check the server redirect configuration.');
    this.name = 'HttpRedirectError';
  }
}

/** Native fetch strips Authorization on an origin change, but can forward custom
 * API keys and MCP session headers. Check every hop before sending any request.
 * This internal fetch serves the SDK's JSON-string POSTs and bodyless GET/DELETEs.
 */
export function originBoundFetch(serverUrl: URL, onRejection: (error: HttpRedirectError) => void): FetchLike {
  const origin = serverUrl.origin;
  const reject = (reason: 'origin' | 'limit' | 'invalid'): never => {
    const error = new HttpRedirectError(reason);
    onRejection(error);
    throw error;
  };
  return async (input, init = {}) => {
    let url = new URL(input);
    let request = { ...init, headers: new Headers(init.headers), redirect: 'manual' as const };
    // Do not accidentally retry a consumed stream if a future SDK changes bodies.
    if (request.body != null && typeof request.body !== 'string') {
      throw new TypeError('HTTP transport requires a replayable JSON string body.');
    }
    for (let followed = 0; ; followed++) {
      if (url.origin !== origin) reject('origin');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) reject('invalid');
      const response = await fetch(url, request);
      const location = response.headers.get('location');
      if (!redirectStatuses.has(response.status) || location === null) return response;
      // Redirect bodies are not used; release the connection before the next hop.
      await response.body?.cancel();
      if (followed === 20) reject('limit');
      let next: URL;
      try { next = new URL(location, url); } catch { return reject('invalid'); }
      // Follow Fetch's method rewrite rules, retaining POST bodies on 307/308.
      const method = (request.method ?? 'GET').toUpperCase();
      if (((response.status === 301 || response.status === 302) && method === 'POST') ||
          (response.status === 303 && method !== 'GET' && method !== 'HEAD')) {
        request = { ...request, method: 'GET', body: undefined };
        for (const header of bodyHeaders) request.headers.delete(header);
      }
      url = next;
    }
  };
}
