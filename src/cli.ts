#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { collectStdio } from './collectors/stdio.js';
import { shutdownStdioProcesses } from './collectors/stdio-transport.js';
import { collectHttp } from './collectors/http.js';
import { collectFile } from './collectors/file.js';
import { collectConfig } from './collectors/config.js';
import { connectionBudget } from './collectors/connect.js';
import { connectionFailureMessage } from './collectors/diagnostics.js';
import { lint, shouldFail } from './core/lint.js';
import { findConfigFile, loadConfigFile, resolveConfig } from './core/config.js';
import { validateOutputPaths, writeReport, writeSnapshot } from './report-file.js';
import { renderTerminal } from './report/terminal.js';
import { visibleControls } from './core/unicode.js';
import { renderJson } from './report/json.js';
import { renderSarif } from './report/sarif.js';
import { renderMarkdown } from './report/markdown.js';
import { renderHtml } from './report/html.js';
import { createMetadataSnapshot, parseMetadataSnapshot, compareMetadata, MAX_SNAPSHOT_BYTES } from './core/metadata.js';
import { decodeText } from './core/read-text.js';
import { renderMetadataHtml } from './report/metadata-html.js';
import { renderMetadataTerminal } from './report/metadata.js';
import type { LintTarget, LintResult, Severity } from './core/types.js';
import { VERSION } from './version.js';

let interrupted: number | undefined;
function interrupt(exitCode: number): void {
  if (interrupted !== undefined) return;
  interrupted = exitCode;
  // POSIX stdio servers have their own process group. Join their shutdown
  // before exiting; an interactive signal no longer reaches them implicitly.
  void shutdownStdioProcesses().then(() => process.exit(exitCode));
}
process.on('SIGINT', () => interrupt(130));
process.on('SIGTERM', () => interrupt(143));

const HELP = `mcplint ${VERSION} — lint MCP server tools the way the model sees them.

Usage:
  mcplint diff <before.json> <after.json> [--format terminal|json|html] [--output <path>]
  mcplint stdio  [options] -- <command> [args...]
  mcplint http   <url> [options]
  mcplint file   <path.json> [options]
  mcplint config <path.json> [options]   every server in an MCP client's config: Claude Desktop,
                                         Claude Code .mcp.json, Cursor ("mcpServers"); VS Code
                                         .vscode/mcp.json ("servers")

Options:
  --snapshot <path>     Save decoded metadata and coverage to a new snapshot file.
  --budget <n>          Per-tool token budget (default 400).
  --total-budget <n>     Total token budget across all collected tools.
  --format <fmt>         terminal | json | sarif | markdown | html (default terminal).
  --output <path>        Write the report to a file instead of stdout.
  --fail-on <level>      Exit 1 for incomplete audits or findings at/above this level.
  --config <path>        Path to a .mcplintrc.json (severities/ignore overrides).
  --ignore <rule[:name]> Suppress a rule, or a rule for one subject. Repeatable.
  -H, --header <k: v>    Extra HTTP header for the http target. Repeatable.
  --input <id=value>     Value for a \${input:id} placeholder in a VS Code config. Repeatable.
  --connect-timeout <ms> Connection and initialization deadline per server (default 30000).
  -h, --help             Show this help.
  -v, --version          Show the version.

Examples:
  mcplint stdio --format html --output report.html -- node server.js
  mcplint http https://example.com/mcp -H "Authorization: Bearer $TOKEN"
  mcplint file tools.json --budget 300 --fail-on error
  mcplint config .mcp.json --fail-on warning
`;

function fail(message: string): never {
  if (interrupted !== undefined) throw new Error('Audit interrupted.');
  process.stderr.write(chalk.red(`mcplint: ${visibleControls(message)}\n`));
  process.exit(2);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      budget: { type: 'string' },
      'total-budget': { type: 'string' },
      format: { type: 'string', default: 'terminal' },
      output: { type: 'string' },
      snapshot: { type: 'string' },
      'fail-on': { type: 'string' },
      config: { type: 'string' },
      ignore: { type: 'string', multiple: true },
      header: { type: 'string', short: 'H', multiple: true },
      input: { type: 'string', multiple: true },
      'connect-timeout': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    }
  });

  // Before the no-arguments check: `mcplint --version` has no positionals either.
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const [target, ...rest] = positionals;
  const format = values.format ?? 'terminal';
  if (!['terminal', 'json', 'sarif', 'markdown', 'html'].includes(format)) {
    fail(`unknown --format "${format}" (expected terminal, json, sarif, markdown, or html)`);
  }

  if (target === 'diff') {
    if (rest.length !== 2) fail('diff requires a before snapshot and an after snapshot.');
    if (Object.entries(values).some(([key, value]) => value !== undefined && !['format', 'output'].includes(key))) fail('diff accepts only --format and --output. Its exit codes are 0 unchanged, 1 changed, 2 incomplete or invalid.');
    if (!['terminal', 'json', 'html'].includes(format)) fail('diff supports terminal, json and html reports.');
    await validateOutputPaths(rest, { report: values.output });
    const comparison = compareMetadata(await readSnapshot(rest[0]!), await readSnapshot(rest[1]!));
    const rendered = format === 'json' ? JSON.stringify(comparison, null, 2) + '\n' : format === 'html' ? renderMetadataHtml(comparison) : renderMetadataTerminal(comparison);
    if (values.output) {
      await writeReport(values.output, rendered, rest);
    }
    else process.stdout.write(rendered);
    process.exitCode = comparison.complete ? (comparison.changes.length ? 1 : 0) : 2;
    return;
  }
  if (values.snapshot && values.output && resolve(values.snapshot) === resolve(values.output)) fail('--snapshot and --output must use different paths.');
  if (values.snapshot && (target === 'file' || target === 'config') && rest[0] && resolve(values.snapshot) === resolve(rest[0])) fail('--snapshot cannot replace its input file.');
  const failOn = parseFailOn(values['fail-on']);
  const configPath = findConfigFile(process.cwd(), values.config);
  const inputPaths = [
    ...((target === 'file' || target === 'config') && rest[0] ? [rest[0]] : []),
    ...(configPath ? [configPath] : [])
  ];
  const outputPaths = { report: values.output, snapshot: values.snapshot };
  await validateOutputPaths(inputPaths, outputPaths);
  const configFile = await loadConfigFile(process.cwd(), configPath);
  const config = resolveConfig({
    file: configFile,
    ...(values.budget !== undefined ? { budgetFlag: parsePositiveInt('--budget', values.budget) } : {}),
    failOnFlag: failOn,
    ...(values.ignore ? { ignoreFlags: values.ignore } : {})
  });
  if (values['total-budget'] !== undefined) config.totalBudget = parsePositiveInt('--total-budget', values['total-budget']);

  let collected: LintTarget;
  const connectionOptions = values['connect-timeout'] === undefined ? {}
    : { connectTimeoutMs: parsePositiveInt('--connect-timeout', values['connect-timeout']) };
  connectionBudget(connectionOptions.connectTimeoutMs);

  try {
    switch (target) {
      case 'stdio': {
        if (rest.length === 0) fail('stdio target requires a command after "--", e.g. `mcplint stdio -- node server.js`');
        const [command, ...args] = rest as [string, ...string[]];
        collected = await collectStdio({ command, args, ...connectionOptions })
          .catch(error => fail(connectionFailureMessage(error)));
        break;
      }
      case 'http': {
        const url = rest[0];
        if (!url) fail('http target requires a URL, e.g. `mcplint http https://example.com/mcp`');
        const headers = parseHeaders(values.header);
        collected = await collectHttp({ url, ...(headers ? { headers } : {}), ...connectionOptions })
          .catch(error => fail(connectionFailureMessage(error)));
        break;
      }
      case 'file': {
        const path = rest[0];
        if (!path) fail('file target requires a path, e.g. `mcplint file tools.json`');
        collected = await collectFile(path);
        break;
      }
      case 'config': {
        const path = rest[0];
        if (!path) fail('config target requires a path, e.g. `mcplint config .mcp.json`');
        process.stderr.write(
          chalk.yellow(`mcplint: "config" launches every server listed in ${visibleControls(path)}. Only run this against configs you trust.\n`)
        );
        const inputs = parseInputs(values.input);
        collected = await collectConfig(path, {
          ...connectionOptions,
          onSourceFiles: async paths => {
            inputPaths.push(...paths);
            await validateOutputPaths(inputPaths, outputPaths);
          },
          onServerStart: (entry) => {
            if (interrupted !== undefined) throw new Error('Audit interrupted.');
            process.stderr.write(chalk.dim(`  starting ${visibleControls(entry.key)} (${entry.kind})...\n`));
          },
          onServerError: (entry, err) => {
            if (interrupted === undefined) process.stderr.write(chalk.red(`  ${visibleControls(entry.key)}: ${connectionFailureMessage(err)}\n`));
          },
          onServerSkipped: (server) =>
            process.stderr.write(chalk.yellow(`  ${visibleControls(server.key)}: not started — ${visibleControls(server.reason)}\n`)),
          ...(inputs ? { inputs } : {})
        });
        break;
      }
      default:
        fail(`unknown target "${target}" (expected stdio, http, file, or config)`);
    }
  } catch (err) {
    fail((err as Error).message);
  }

  if (interrupted !== undefined) return;
  const result = lint(collected, config);
  await validateOutputPaths(inputPaths, outputPaths);
  if (values.snapshot) {
    const snapshot = JSON.stringify(createMetadataSnapshot(collected), null, 2) + '\n';
    if (Buffer.byteLength(snapshot) > MAX_SNAPSHOT_BYTES) fail('Metadata exceeds the 50 MB snapshot limit.');
    await writeSnapshot(values.snapshot, snapshot, [...inputPaths, ...(values.output ? [values.output] : [])]);
    process.stderr.write(`Snapshot written to ${visibleControls(values.snapshot)}\n`);
  }
  const rendered = render(result, format);
  if (values.output) {
    await writeReport(values.output, rendered, [...inputPaths, ...(values.snapshot ? [values.snapshot] : [])]);
    process.stderr.write(chalk.dim(`Report written to ${visibleControls(values.output)}\n`));
  } else {
    process.stdout.write(rendered.endsWith('\n') ? rendered : `${rendered}\n`);
  }

  // Not process.exit(): a report written to a pipe (a CI step's output, `| tee`) is still on its
  // way out here, and exiting at once cut it at the pipe's 64 KB buffer -- only when the lint
  // failed, which is when the report is wanted.
  if (shouldFail(result)) process.exitCode = 1;
}

async function readSnapshot(path: string) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of createReadStream(path)) {
    const chunk = value as Buffer;
    size += chunk.length;
    if (size > MAX_SNAPSHOT_BYTES) throw new Error('Metadata exceeds the 50 MB snapshot limit.');
    chunks.push(chunk);
  }
  return parseMetadataSnapshot(decodeText(Buffer.concat(chunks)));
}

function render(result: LintResult, format: string): string {
  switch (format) {
    case 'json':
      return renderJson(result);
    case 'sarif':
      return renderSarif(result);
    case 'markdown':
      return renderMarkdown(result);
    case 'html':
      return renderHtml(result);
    default:
      return renderTerminal(result);
  }
}

function parsePositiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) fail(`${flag} must be a positive safe integer, got "${raw}"`);
  return n;
}

function parseFailOn(v: string | undefined): Severity | null {
  if (!v) return null;
  if (v === 'warning' || v === 'error') return v;
  fail(`unknown --fail-on "${v}" (expected warning or error)`);
}

function parseHeaders(list: string[] | undefined): Record<string, string> | undefined {
  if (!list || list.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const entry of list) {
    const idx = entry.indexOf(':');
    if (idx <= 0) fail('invalid --header (expected "Name: value"; supplied value omitted)');
    out[entry.slice(0, idx).trim()] = entry.slice(idx + 1).trim();
  }
  return out;
}

function parseInputs(list: string[] | undefined): Record<string, string> | undefined {
  if (!list || list.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const entry of list) {
    const idx = entry.indexOf('=');
    if (idx <= 0) fail('invalid --input (expected "id=value"; supplied value omitted)');
    out[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return out;
}

main().catch((err: unknown) => {
  if (interrupted !== undefined) return;
  fail(err instanceof Error ? err.message : String(err));
});
