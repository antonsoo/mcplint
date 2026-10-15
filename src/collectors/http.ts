import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { LintTarget } from '../core/types.js';
import { collectFromClient } from './collect.js';
import { VERSION } from '../version.js';
import { connectionBudget, connectWithinBudget, type ConnectionOptions } from './connect.js';
import { originBoundFetch, type HttpRedirectError } from './http-redirects.js';
import { guardHttpResponse, retainIntegrityFailure, type LiveJsonIntegrityError } from './live-json.js';

export interface HttpTargetOptions extends ConnectionOptions {
  url: string;
  headers?: Record<string, string>;
  /**
   * `sse` connects with the older HTTP+SSE transport straight away. Otherwise Streamable HTTP is
   * tried first and HTTP+SSE second, which is what the MCP specification asks of a client that
   * wants to reach servers of either generation.
   */
  transport?: 'auto' | 'sse';
  serverId?: string;
  label?: string;
}

async function collectOver(
  transport: Transport, opts: HttpTargetOptions, budget: ReturnType<typeof connectionBudget>,
  client = new Client({ name: 'mcplint', version: VERSION })
): Promise<LintTarget> {
  opts.signal?.throwIfAborted();
  const onAbort = (): void => { void transport.close().catch(() => undefined); };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await connectWithinBudget(client, transport, budget, opts.signal);
    // See collectors/stdio.ts: prefer the server's own declared name over a
    // generic "http" placeholder when the caller didn't pin a serverId.
    const discoveredName = client.getServerVersion()?.name;
    const serverId = opts.serverId ?? discoveredName ?? 'http';
    const label = opts.label ?? opts.url;
    const target = await collectFromClient(client, serverId, label);
    opts.signal?.throwIfAborted();
    return target;
  } finally {
    try {
      await client.close().catch(() => undefined);
      await transport.close();
      opts.signal?.throwIfAborted();
    } finally { opts.signal?.removeEventListener('abort', onAbort); }
  }
}

export async function collectHttp(opts: HttpTargetOptions): Promise<LintTarget> {
  opts.signal?.throwIfAborted();
  const budget = connectionBudget(opts.connectTimeoutMs);
  const url = new URL(opts.url);
  const requestInit = opts.headers ? { headers: opts.headers } : undefined;
  let redirectFailure: HttpRedirectError | undefined;
  let integrityFailure: LiveJsonIntegrityError | undefined;
  const boundFetch = originBoundFetch(url, error => { redirectFailure = error; });
  const fetchFor = (client: Client): typeof boundFetch => async (input, init) => guardHttpResponse(
    await boundFetch(input, init), error => {
      integrityFailure ??= error;
      // Closing this exact client rejects pending requests, including legacy SSE
      // requests whose response arrives on the separate GET stream.
      void client.close().catch(() => undefined);
    },
  );
  const over = async (transport: Transport, client: Client): Promise<LintTarget> =>
    retainIntegrityFailure(await collectOver(transport, opts, budget, client), integrityFailure);
  const sse = (): Promise<LintTarget> => {
    const client = new Client({ name: 'mcplint', version: VERSION });
    return over(new SSEClientTransport(url, { requestInit, fetch: fetchFor(client) }), client);
  };
  try {
    if (opts.transport === 'sse') return await sse();
    const client = new Client({ name: 'mcplint', version: VERSION });
    try {
      return await over(new StreamableHTTPClientTransport(url, {
        requestInit, fetch: fetchFor(client),
      }), client);
    } catch (streamable) {
      opts.signal?.throwIfAborted();
      // Only a protocol rejection justifies trying legacy SSE. A timeout, server
      // outage or invalid initialize response is not evidence of an older server.
      if (redirectFailure || integrityFailure || client.getServerVersion() !== undefined ||
        !(streamable instanceof StreamableHTTPError) || streamable.code === undefined ||
        streamable.code < 400 || streamable.code >= 500) {
        throw streamable;
      }
      return await sse();
    }
  } catch (error) {
    opts.signal?.throwIfAborted();
    // EventSource wraps fetch rejections. Keep our bounded diagnostic without
    // trusting a server-supplied message or echoing a Location URL's credentials.
    throw redirectFailure ?? integrityFailure ?? error;
  }
}
