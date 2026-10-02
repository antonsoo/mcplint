import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { LintTarget } from '../core/types.js';
import { isPlainObject, stripBom } from '../core/schema-utils.js';
import { collectStdio } from './stdio.js';
import { collectHttp } from './http.js';
import { mergeTargets } from './collect.js';

interface StdioServerEntry {
  kind: 'stdio';
  key: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** A file of `KEY=value` lines to add to the server's environment; `env` wins over it. */
  envFile?: string;
}

interface HttpServerEntry {
  kind: 'http';
  key: string;
  url: string;
  headers?: Record<string, string>;
  /** Set for an entry that names the older HTTP+SSE transport (`"type": "sse"`). */
  sse?: true;
}

type ServerEntry = StdioServerEntry | HttpServerEntry;

/** A server the config lists but mcplint did not start, and why. */
export interface SkippedServer {
  key: string;
  reason: string;
}

export interface ServerConfig {
  entries: ServerEntry[];
  skipped: SkippedServer[];
}

export interface ConfigContext {
  /** Where the config was read from: `${workspaceFolder}` and relative paths resolve against it. */
  path?: string;
  /** The environment `${VAR}` and `${env:VAR}` are read from. */
  env?: Record<string, string | undefined>;
  /** Values for `${input:id}` placeholders, by id (`--input id=value`). */
  inputs?: Record<string, string>;
}

/**
 * JSON with comments and trailing commas, which is what VS Code's `mcp.json`
 * and `settings.json` are. Comments are blanked out, not removed, so that a
 * syntax error is still reported at the right line and column.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      out += text.slice(start, ++i);
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (ch === ',') {
      // A comma before a closing bracket (only whitespace and comments between) is a trailing one.
      const rest = text.slice(i + 1);
      const next = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*([\]}])/.exec(rest);
      out += next ? ' ' : ',';
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** The map of servers, wherever this client's format keeps it, and whether it is VS Code's. */
function serverMap(config: unknown): { servers: Record<string, unknown>; vscode: boolean } | undefined {
  if (!isPlainObject(config)) return undefined;
  // Claude Desktop, Claude Code's .mcp.json, Cursor, Windsurf, Cline, Copilot's portable format.
  if (isPlainObject(config.mcpServers)) return { servers: config.mcpServers, vscode: false };
  // VS Code's .vscode/mcp.json, and the "mcp" section of its settings.json.
  if (isPlainObject(config.servers)) return { servers: config.servers, vscode: true };
  if (isPlainObject(config.mcp) && isPlainObject(config.mcp.servers)) return { servers: config.mcp.servers, vscode: true };
  return undefined;
}

class Unresolved extends Error {}

/**
 * Fills in the placeholders the clients themselves fill in: `${workspaceFolder}`,
 * `${userHome}`, `${env:NAME}` and `${input:id}` (VS Code), `${NAME}` and
 * `${NAME:-default}` (Claude Code). A placeholder with nothing to fill it in
 * throws `Unresolved`: started with a literal `${API_KEY}` for a key, a server
 * would fail to authenticate, or list its tools for nobody in particular.
 */
function substitute(value: string, workspace: string, ctx: ConfigContext, inputDefaults: Record<string, string>): string {
  const env = ctx.env ?? process.env;
  return value.replace(/\$\{([^}]*)\}/g, (whole, body: string) => {
    if (body === 'workspaceFolder') return workspace;
    if (body === 'userHome') return homedir();
    if (body === 'workspaceFolderBasename') return basename(workspace);
    if (body.startsWith('env:')) return env[body.slice(4)] ?? '';
    if (body.startsWith('input:')) {
      const id = body.slice(6);
      const given = ctx.inputs?.[id] ?? inputDefaults[id];
      if (given === undefined) throw new Unresolved(`needs the input "${id}" (pass --input ${id}=<value>)`);
      return given;
    }
    const withDefault = /^([A-Za-z_][A-Za-z0-9_]*)(?::-(.*))?$/s.exec(body);
    if (withDefault) {
      const found = env[withDefault[1]!];
      if (found !== undefined) return found;
      if (withDefault[2] !== undefined) return withDefault[2];
      throw new Unresolved(`needs the environment variable ${withDefault[1]}`);
    }
    return whole;
  });
}

/** `KEY=value` lines, as a server's `envFile` holds them. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of stripBom(text).split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    if (line === '' || line.startsWith('#') || eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = /^(["'])(.*)\1$/s.exec(value);
    if (quoted) value = quoted[2]!;
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * Reads the servers out of an MCP client's configuration, in any of the shapes
 * the clients use: `{"mcpServers": {...}}` (Claude Desktop, Claude Code's
 * `.mcp.json`, Cursor, Windsurf, Cline, Copilot's portable format),
 * `{"servers": {...}}` (VS Code's `.vscode/mcp.json`) and `{"mcp": {"servers":
 * {...}}}` (VS Code's `settings.json`). An entry is `{"command", "args", "env",
 * "cwd"}` for a local server or `{"url", "headers"}` for a remote one. Entries
 * marked `"disabled": true`, and entries whose placeholders cannot be filled
 * in, are returned as skipped, with the reason.
 */
export function readServerConfig(config: unknown, ctx: ConfigContext = {}): ServerConfig {
  const found = serverMap(config);
  if (!found) {
    throw new Error(
      'Config must be a JSON object with an "mcpServers" map (Claude Desktop, Claude Code .mcp.json, Cursor) or a "servers" map (VS Code mcp.json).'
    );
  }
  const configDir = ctx.path ? dirname(resolve(ctx.path)) : process.cwd();
  // .vscode/mcp.json describes the workspace that holds the .vscode folder.
  const workspace = basename(configDir) === '.vscode' ? dirname(configDir) : configDir;
  const inputDefaults: Record<string, string> = {};
  if (isPlainObject(config) && Array.isArray(config.inputs)) {
    for (const input of config.inputs) {
      if (isPlainObject(input) && typeof input.id === 'string' && typeof input.default === 'string') inputDefaults[input.id] = input.default;
    }
  }
  const fill = (value: string): string => substitute(value, workspace, ctx, inputDefaults);
  const fillMap = (map: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(map)) {
      // VS Code allows numbers, and null for "leave this one unset".
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = fill(String(value));
    }
    return out;
  };

  const entries: ServerEntry[] = [];
  const skipped: SkippedServer[] = [];
  for (const [key, value] of Object.entries(found.servers)) {
    if (!isPlainObject(value)) continue;
    if (value.disabled === true) {
      skipped.push({ key, reason: 'disabled in the config' });
      continue;
    }
    try {
      if (typeof value.url === 'string') {
        entries.push({
          kind: 'http',
          key,
          url: fill(value.url),
          ...(isPlainObject(value.headers) ? { headers: fillMap(value.headers) } : {}),
          ...(value.type === 'sse' ? { sse: true as const } : {})
        });
      } else if (typeof value.command === 'string') {
        const cwd = typeof value.cwd === 'string' ? fill(value.cwd) : found.vscode ? workspace : undefined;
        entries.push({
          kind: 'stdio',
          key,
          command: fill(value.command),
          args: Array.isArray(value.args) ? value.args.map((arg) => fill(String(arg))) : [],
          ...(isPlainObject(value.env) ? { env: fillMap(value.env) } : {}),
          ...(cwd !== undefined ? { cwd: isAbsolute(cwd) ? cwd : resolve(workspace, cwd) } : {}),
          ...(typeof value.envFile === 'string' ? { envFile: resolve(workspace, fill(value.envFile)) } : {})
        });
      }
    } catch (err) {
      if (!(err instanceof Unresolved)) throw err;
      skipped.push({ key, reason: err.message });
    }
  }
  return { entries, skipped };
}

/** The servers of a config that can be started as they stand. See `readServerConfig`. */
export function parseServerEntries(config: unknown, ctx: ConfigContext = {}): ServerEntry[] {
  return readServerConfig(config, ctx).entries;
}

export interface CollectConfigOptions {
  onServerStart?: (entry: ServerEntry) => void;
  onServerError?: (entry: ServerEntry, error: unknown) => void;
  onServerSkipped?: (skipped: SkippedServer) => void;
  /** Values for `${input:id}` placeholders. */
  inputs?: Record<string, string>;
}

export async function collectConfig(path: string, opts: CollectConfigOptions = {}): Promise<LintTarget> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(stripBom(raw)));
  } catch (err) {
    throw new Error(`${path} is not valid JSON (comments and trailing commas are allowed): ${(err as Error).message}`);
  }
  const { entries, skipped } = readServerConfig(parsed, { path, ...(opts.inputs ? { inputs: opts.inputs } : {}) });
  for (const server of skipped) opts.onServerSkipped?.(server);
  if (entries.length === 0) {
    throw new Error(
      skipped.length > 0
        ? `${path} lists ${skipped.length} server${skipped.length === 1 ? '' : 's'}, and none can be started: ${skipped.map((s) => `${s.key} ${s.reason}`).join('; ')}.`
        : `${path}'s server map has no entries with a "command" or "url".`
    );
  }

  const targets: LintTarget[] = [];
  for (const entry of entries) {
    opts.onServerStart?.(entry);
    try {
      let target: LintTarget;
      if (entry.kind === 'stdio') {
        const fromFile = entry.envFile ? parseEnvFile(await readFile(entry.envFile, 'utf8')) : undefined;
        const env = fromFile || entry.env ? { ...fromFile, ...entry.env } : undefined;
        target = await collectStdio({
          command: entry.command,
          args: entry.args,
          ...(env ? { env } : {}),
          ...(entry.cwd ? { cwd: entry.cwd } : {}),
          serverId: entry.key,
          label: entry.key
        });
      } else {
        target = await collectHttp({
          url: entry.url,
          ...(entry.headers ? { headers: entry.headers } : {}),
          ...(entry.sse ? { transport: 'sse' as const } : {}),
          serverId: entry.key,
          label: entry.key
        });
      }
      targets.push(target);
    } catch (err) {
      opts.onServerError?.(entry, err);
    }
  }

  return mergeTargets(targets);
}

export type { ServerEntry };
