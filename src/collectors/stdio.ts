import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { LintTarget } from '../core/types.js';
import { collectFromClient } from './collect.js';

export interface StdioTargetOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  serverId?: string;
  label?: string;
}

export async function collectStdio(opts: StdioTargetOptions): Promise<LintTarget> {
  const transport = new StdioClientTransport({
    command: opts.command,
    args: opts.args,
    env: { ...processEnvAsStrings(), ...(opts.env ?? {}) }
  });

  const client = new Client({ name: 'mcplint', version: '0.1.0' });

  try {
    await client.connect(transport);
    // Prefer the name the server itself declared in the `initialize` handshake
    // (serverInfo.name) over a generic "stdio" placeholder — much more useful
    // in reports and screenshots when linting a single server.
    const discoveredName = client.getServerVersion()?.name;
    const serverId = opts.serverId ?? discoveredName ?? 'stdio';
    // Keep the label as the literal command by default — it's what makes a report
    // reproducible (see the "target" field in the HTML/terminal header).
    const label = opts.label ?? `${opts.command} ${opts.args.join(' ')}`.trim();
    return await collectFromClient(client, serverId, label);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function processEnvAsStrings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
