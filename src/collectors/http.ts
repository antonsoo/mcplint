import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { LintTarget } from '../core/types.js';
import { collectFromClient } from './collect.js';
import { VERSION } from '../version.js';
import { connectionBudget, connectWithinBudget, type ConnectionOptions } from './connect.js';

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
  try {
    await connectWithinBudget(client, transport, budget);
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
  const budget = connectionBudget(opts.connectTimeoutMs);
  const url = new URL(opts.url);
  const requestInit = opts.headers ? { headers: opts.headers } : undefined;
  const sse = (): Transport => new SSEClientTransport(url, { requestInit });
  if (opts.transport === 'sse') return collectOver(sse(), opts, budget);

  const client = new Client({ name: 'mcplint', version: VERSION });
  try {
    return await collectOver(new StreamableHTTPClientTransport(url, { requestInit }), opts, budget, client);
  } catch (streamable) {
    // Only a protocol rejection justifies trying legacy SSE. A timeout, server
    // outage or invalid initialize response is not evidence of an older server.
    if (client.getServerVersion() !== undefined ||
      !(streamable instanceof StreamableHTTPError) || streamable.code === undefined ||
      streamable.code < 400 || streamable.code >= 500) {
      throw streamable;
    }
    return collectOver(sse(), opts, budget);
  }
}
