import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { LintTarget } from '../core/types.js';
import { collectFromClient } from './collect.js';
import { VERSION } from '../version.js';
import { connectionBudget, connectWithinBudget, type ConnectionOptions } from './connect.js';
import { GuardedStdioTransport } from './stdio-transport.js';
import { retainIntegrityFailure } from './live-json.js';

export interface StdioTargetOptions extends ConnectionOptions {
  command: string;
  args: string[];
  /** Overrides for the child process; null removes an inherited variable. */
  env?: Record<string, string | null>;
  /** Working directory for the server process; the current one if not given. */
  cwd?: string;
  serverId?: string;
  label?: string;
}

export async function collectStdio(opts: StdioTargetOptions): Promise<LintTarget> {
  const budget = connectionBudget(opts.connectTimeoutMs);
  const env: Record<string, string | undefined> = { ...getDefaultEnvironment(), ...processEnvAsStrings() };
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    // Windows environment names are case-insensitive. Override every spelling
    // before Node chooses one, including spellings the SDK inherits by default.
    if (process.platform === 'win32') {
      for (const inherited of Object.keys(env)) {
        if (inherited.toUpperCase() === key.toUpperCase()) env[inherited] = value ?? undefined;
      }
    }
    env[key] = value ?? undefined;
  }
  const transport = new GuardedStdioTransport({
    command: opts.command,
    args: opts.args,
    // Node omits undefined values, preserving explicit environment removals.
    env,
    ...(opts.cwd ? { cwd: opts.cwd } : {})
  });

  const client = new Client({ name: 'mcplint', version: VERSION });

  try {
    await connectWithinBudget(client, transport, budget);
    // Prefer the name the server itself declared in the `initialize` handshake
    // (serverInfo.name) over a generic "stdio" placeholder — much more useful
    // in reports and screenshots when linting a single server.
    const discoveredName = client.getServerVersion()?.name;
    const serverId = opts.serverId ?? discoveredName ?? 'stdio';
    // Keep the label as the literal command by default — it's what makes a report
    // reproducible (see the "target" field in the HTML/terminal header).
    const label = opts.label ?? `${opts.command} ${opts.args.join(' ')}`.trim();
    return retainIntegrityFailure(await collectFromClient(client, serverId, label), transport.integrityError);
  } catch (error) {
    throw transport.integrityError ?? error;
  } finally {
    await client.close().catch(() => undefined);
    // A guard-triggered close already detaches the transport from the client.
    // Still join process cleanup before returning a partial report or failure.
    await transport.close().catch(() => undefined);
  }
}

function processEnvAsStrings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
