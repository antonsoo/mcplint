import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { LintTarget } from '../core/types.js';
import { collectFromClient } from './collect.js';

export interface HttpTargetOptions {
  url: string;
  headers?: Record<string, string>;
  serverId?: string;
  label?: string;
}

export async function collectHttp(opts: HttpTargetOptions): Promise<LintTarget> {
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    requestInit: opts.headers ? { headers: opts.headers } : undefined
  });

  const client = new Client({ name: 'mcplint', version: '0.1.0' });
  const serverId = opts.serverId ?? 'http';
  const label = opts.label ?? opts.url;

  try {
    await client.connect(transport);
    return await collectFromClient(client, serverId, label);
  } finally {
    await client.close().catch(() => undefined);
  }
}
