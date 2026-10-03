#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { collectStdio } from './collectors/stdio.js';
import { collectHttp } from './collectors/http.js';
import { collectFile } from './collectors/file.js';
import { collectConfig } from './collectors/config.js';
import { lint, shouldFail } from './core/lint.js';
import { loadConfigFile, resolveConfig } from './core/config.js';
import { renderTerminal } from './report/terminal.js';
import { visibleControls } from './core/unicode.js';
import { renderJson } from './report/json.js';
import { renderSarif } from './report/sarif.js';
import { renderMarkdown } from './report/markdown.js';
import { renderHtml } from './report/html.js';
import type { LintResult, Severity } from './core/types.js';
import { VERSION } from './version.js';


const HELP = `mcplint ${VERSION} — lint MCP server tools the way the model sees them.

Usage:
  mcplint stdio  [options] -- <command> [args...]
  mcplint http   <url> [options]
  mcplint file   <path.json> [options]
  mcplint config <path.json> [options]   every server in an MCP client's config: Claude Desktop,
                                         Claude Code .mcp.json, Cursor ("mcpServers"); VS Code
                                         .vscode/mcp.json ("servers")

Options:
  --budget <n>          Per-tool token budget (default 400).
  --total-budget <n>     Total token budget across all collected tools.
  --format <fmt>         terminal | json | sarif | markdown | html (default terminal).
  --output <path>        Write the report to a file instead of stdout.
  --fail-on <level>      Exit 1 if findings at/above "warning" or "error" exist.
  --config <path>        Path to a .mcplintrc.json (severities/ignore overrides).
  --ignore <rule[:name]> Suppress a rule, or a rule for one subject. Repeatable.
  -H, --header <k: v>    Extra HTTP header for the http target. Repeatable.
  --input <id=value>     Value for a \${input:id} placeholder in a VS Code config. Repeatable.
  -h, --help             Show this help.
  -v, --version          Show the version.

Examples:
  mcplint stdio --format html --output report.html -- node server.js
  mcplint http https://example.com/mcp -H "Authorization: Bearer $TOKEN"
  mcplint file tools.json --budget 300 --fail-on error
  mcplint config .mcp.json --fail-on warning
`;

function fail(message: string): never {
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
      'fail-on': { type: 'string' },
      config: { type: 'string' },
      ignore: { type: 'string', multiple: true },
      header: { type: 'string', short: 'H', multiple: true },
      input: { type: 'string', multiple: true },
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
  const failOn = parseFailOn(values['fail-on']);
  const format = values.format ?? 'terminal';
  if (!['terminal', 'json', 'sarif', 'markdown', 'html'].includes(format)) {
    fail(`unknown --format "${format}" (expected terminal, json, sarif, markdown, or html)`);
  }

  const configFile = await loadConfigFile(process.cwd(), values.config);
  const config = resolveConfig({
    file: configFile,
    ...(values.budget !== undefined ? { budgetFlag: parsePositiveInt('--budget', values.budget) } : {}),
    failOnFlag: failOn,
    ...(values.ignore ? { ignoreFlags: values.ignore } : {})
  });
  if (values['total-budget'] !== undefined) config.totalBudget = parsePositiveInt('--total-budget', values['total-budget']);

  let result: LintResult;

  try {
    switch (target) {
      case 'stdio': {
        if (rest.length === 0) fail('stdio target requires a command after "--", e.g. `mcplint stdio -- node server.js`');
        const [command, ...args] = rest as [string, ...string[]];
        const collected = await collectStdio({ command, args });
        result = lint(collected, config);
        break;
      }
      case 'http': {
        const url = rest[0];
        if (!url) fail('http target requires a URL, e.g. `mcplint http https://example.com/mcp`');
        const headers = parseHeaders(values.header);
        const collected = await collectHttp({ url, ...(headers ? { headers } : {}) });
        result = lint(collected, config);
        break;
      }
      case 'file': {
        const path = rest[0];
        if (!path) fail('file target requires a path, e.g. `mcplint file tools.json`');
        const collected = await collectFile(path);
        result = lint(collected, config);
        break;
      }
      case 'config': {
        const path = rest[0];
        if (!path) fail('config target requires a path, e.g. `mcplint config .mcp.json`');
        process.stderr.write(
          chalk.yellow(`mcplint: "config" launches every server listed in ${path}. Only run this against configs you trust.\n`)
        );
        const inputs = parseInputs(values.input);
        const collected = await collectConfig(path, {
          onServerStart: (entry) => process.stderr.write(chalk.dim(`  starting ${entry.key} (${entry.kind})...\n`)),
          onServerError: (entry, err) =>
            process.stderr.write(chalk.red(`  ${visibleControls(entry.key)}: failed to connect — ${visibleControls((err as Error).message)}\n`)),
          onServerSkipped: (server) =>
            process.stderr.write(chalk.yellow(`  ${visibleControls(server.key)}: not started — ${visibleControls(server.reason)}\n`)),
          ...(inputs ? { inputs } : {})
        });
        result = lint(collected, config);
        break;
      }
      default:
        fail(`unknown target "${target}" (expected stdio, http, file, or config)`);
    }
  } catch (err) {
    fail((err as Error).message);
  }

  const rendered = render(result, format);
  if (values.output) {
    await writeFile(values.output, rendered, 'utf8');
    process.stderr.write(chalk.dim(`Report written to ${values.output}\n`));
  } else {
    process.stdout.write(rendered.endsWith('\n') ? rendered : `${rendered}\n`);
  }

  // Not process.exit(): a report written to a pipe (a CI step's output, `| tee`) is still on its
  // way out here, and exiting at once cut it at the pipe's 64 KB buffer -- only when the lint
  // failed, which is when the report is wanted.
  if (shouldFail(result)) process.exitCode = 1;
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
  if (!Number.isFinite(n) || n <= 0) fail(`${flag} must be a positive number, got "${raw}"`);
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
    if (idx === -1) fail(`invalid --header "${entry}" (expected "Name: value")`);
    out[entry.slice(0, idx).trim()] = entry.slice(idx + 1).trim();
  }
  return out;
}

function parseInputs(list: string[] | undefined): Record<string, string> | undefined {
  if (!list || list.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const entry of list) {
    const idx = entry.indexOf('=');
    if (idx <= 0) fail(`invalid --input "${entry}" (expected "id=value")`);
    out[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return out;
}

main().catch((err: unknown) => {
  process.stderr.write(chalk.red(`mcplint: unexpected error: ${(err as Error).stack ?? String(err)}\n`));
  process.exit(2);
});
