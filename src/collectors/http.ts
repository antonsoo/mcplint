import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { LintTarget } from '../core/types.js';
import { collectFromClient } from './collect.js';
import { VERSION } from '../version.js';

export interface HttpTargetOptions {
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

async function collectOver(transport: Transport, opts: HttpTargetOptions): Promise<LintTarget> {
  const client = new Client({ name: 'mcplint', version: VERSION });
  try {
    await client.connect(transport);
    // See collectors/stdio.ts: prefer the server's own declared name over a
    // generic "http" placeholder when the caller didn't pin a serverId.
    const discoveredName = client.getServerVersion()?.name;
    const serverId = opts.serverId ?? discoveredName ?? 'http';
    const label = opts.label ?? opts.url;
    return await collectFromClient(client, serverId, label);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function collectHttp(opts: HttpTargetOptions): Promise<LintTarget> {
  const url = new URL(opts.url);
  const requestInit = opts.headers ? { headers: opts.headers } : undefined;
  const sse = (): Transport => new SSEClientTransport(url, { requestInit });
  if (opts.transport === 'sse') return collectOver(sse(), opts);

  try {
    return await collectOver(new StreamableHTTPClientTransport(url, { requestInit }), opts);
  } catch (streamable) {
    // A server that only speaks HTTP+SSE answers the first POST with a 4xx (typically 404 or
    // 405). Anything else it says to the older transport decides the matter; if that fails too,
    // the first error is the one about the transport the server most likely meant to offer.
    try {
      return await collectOver(sse(), opts);
    } catch {
      throw streamable;
    }
  }
}
