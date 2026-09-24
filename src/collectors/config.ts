import { readFile } from 'node:fs/promises';
import type { LintTarget } from '../core/types.js';
import { isPlainObject } from '../core/schema-utils.js';
import { collectStdio } from './stdio.js';
import { collectHttp } from './http.js';
import { mergeTargets } from './collect.js';

interface StdioServerEntry {
  kind: 'stdio';
  key: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface HttpServerEntry {
  kind: 'http';
  key: string;
  url: string;
  headers?: Record<string, string>;
}

type ServerEntry = StdioServerEntry | HttpServerEntry;

/**
 * Parses the `mcpServers` map shared by Claude Desktop's config and Claude
 * Code's `.mcp.json`: `{"mcpServers": {"<name>": {"command", "args", "env"}
 * | {"url", "headers"}}}`.
 */
export function parseServerEntries(config: unknown): ServerEntry[] {
  if (!isPlainObject(config) || !isPlainObject(config.mcpServers)) {
    throw new Error('Config must be a JSON object with an "mcpServers" map (Claude Desktop / Claude Code .mcp.json format).');
  }
  const entries: ServerEntry[] = [];
  for (const [key, value] of Object.entries(config.mcpServers)) {
    if (!isPlainObject(value)) continue;
    if (typeof value.url === 'string') {
      entries.push({
        kind: 'http',
        key,
        url: value.url,
        ...(isPlainObject(value.headers) ? { headers: value.headers as Record<string, string> } : {})
      });
    } else if (typeof value.command === 'string') {
      entries.push({
        kind: 'stdio',
        key,
        command: value.command,
        args: Array.isArray(value.args) ? value.args.map(String) : [],
        ...(isPlainObject(value.env) ? { env: value.env as Record<string, string> } : {})
      });
    }
  }
  return entries;
}

export interface CollectConfigOptions {
  onServerStart?: (entry: ServerEntry) => void;
  onServerError?: (entry: ServerEntry, error: unknown) => void;
}

export async function collectConfig(path: string, opts: CollectConfigOptions = {}): Promise<LintTarget> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const entries = parseServerEntries(parsed);
  if (entries.length === 0) {
    throw new Error(`${path}'s "mcpServers" map has no entries with a "command" or "url".`);
  }

  const targets: LintTarget[] = [];
  for (const entry of entries) {
    opts.onServerStart?.(entry);
    try {
      const target =
        entry.kind === 'stdio'
          ? await collectStdio({ command: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}), serverId: entry.key, label: entry.key })
          : await collectHttp({ url: entry.url, ...(entry.headers ? { headers: entry.headers } : {}), serverId: entry.key, label: entry.key });
      targets.push(target);
    } catch (err) {
      opts.onServerError?.(entry, err);
    }
  }

  return mergeTargets(targets);
}

export type { ServerEntry };
