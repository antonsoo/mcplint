// The configs MCP clients really keep: Claude's "mcpServers", VS Code's "servers" with comments
// and placeholders, entries switched off, entries that need a secret. Formats per the clients'
// own documentation (VS Code's "MCP configuration reference", Claude Code's .mcp.json).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { collectConfig, parseEnvFile, parseServerEntries, readServerConfig, stripJsonComments, type SkippedServer } from '../../src/collectors/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scratch = mkdtempSync(join(tmpdir(), 'mcplint-config-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('stripJsonComments', () => {
  it('reads what VS Code writes: comments and trailing commas', () => {
    const text = `{
      // which servers this workspace uses
      "servers": {
        "docs": { "command": "node", "args": ["server.js", ], }, /* local */
      },
    }`;
    expect(JSON.parse(stripJsonComments(text))).toEqual({ servers: { docs: { command: 'node', args: ['server.js'] } } });
  });

  it('leaves strings alone, whatever they hold', () => {
    const value = { url: 'https://example.com/mcp//v1', note: 'a /* not a comment */ and a "quote", ]', path: 'C:\\\\tools\\\\' };
    expect(JSON.parse(stripJsonComments(JSON.stringify(value, null, 2)))).toEqual(value);
  });

  it('keeps every character where it was, so a syntax error is reported in the right place', () => {
    const text = '{\n  // comment\n  "a": 1, /* x\n y */ "b": oops\n}';
    const stripped = stripJsonComments(text);
    expect(stripped).toHaveLength(text.length);
    expect(stripped.split('\n').map((line) => line.length)).toEqual(text.split('\n').map((line) => line.length));
    expect(stripped.indexOf('oops')).toBe(text.indexOf('oops'));
  });

  it('is the identity on plain JSON', () => {
    const text = JSON.stringify({ mcpServers: { a: { command: 'x', args: ['1', '2'], env: { K: 'v' } } } }, null, 2);
    expect(stripJsonComments(text)).toBe(text);
  });
});

describe('readServerConfig', () => {
  it("reads VS Code's .vscode/mcp.json: a servers map, typed entries, the workspace as working directory", () => {
    const path = join(scratch, 'project', '.vscode', 'mcp.json');
    const { entries, skipped } = readServerConfig(
      {
        servers: {
          memory: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
          local: { command: '${workspaceFolder}/bin/server', args: ['--root', '${workspaceFolder}'], cwd: 'packages/api', env: { PORT: 3000, DEBUG: null, HOME_DIR: '${userHome}' } },
          context7: { type: 'http', url: 'https://mcp.context7.com/mcp' },
          legacy: { type: 'sse', url: 'http://localhost:3001/sse', headers: { Authorization: 'Bearer ${env:LEGACY_TOKEN}' } }
        }
      },
      { path, env: { LEGACY_TOKEN: 't0k' } }
    );
    const workspace = join(scratch, 'project');
    expect(skipped).toEqual([]);
    expect(entries).toEqual([
      { kind: 'stdio', key: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], cwd: workspace },
      { kind: 'stdio', key: 'local', command: `${workspace}/bin/server`, args: ['--root', workspace], env: { PORT: '3000', HOME_DIR: homedir() }, cwd: join(workspace, 'packages', 'api') },
      { kind: 'http', key: 'context7', url: 'https://mcp.context7.com/mcp' },
      { kind: 'http', key: 'legacy', url: 'http://localhost:3001/sse', headers: { Authorization: 'Bearer t0k' }, sse: true }
    ]);
  });

  it('reads the "mcp" section of a VS Code settings.json', () => {
    const entries = parseServerEntries({ 'editor.fontSize': 13, mcp: { servers: { a: { command: 'node', args: ['a.js'] } } } }, { path: join(scratch, 'settings.json') });
    expect(entries.map((e) => e.key)).toEqual(['a']);
  });

  it('prefers "mcpServers" when a file has both, and does not give its entries a working directory', () => {
    const { entries } = readServerConfig({ mcpServers: { claude: { command: 'node' } }, servers: { vscode: { command: 'node' } } }, { path: join(scratch, '.mcp.json') });
    expect(entries).toEqual([{ kind: 'stdio', key: 'claude', command: 'node', args: [] }]);
  });

  it('skips a disabled server, as the clients that write "disabled" do', () => {
    const { entries, skipped } = readServerConfig({ mcpServers: { on: { command: 'node' }, off: { command: 'node', disabled: true }, alsoOn: { command: 'node', disabled: false } } });
    expect(entries.map((e) => e.key)).toEqual(['on', 'alsoOn']);
    expect(skipped).toEqual([{ key: 'off', reason: 'disabled in the config' }]);
  });

  it("fills in Claude Code's ${VAR} and ${VAR:-default}, and skips a server whose variable is not set", () => {
    const config = {
      mcpServers: {
        api: { url: '${API_BASE:-https://api.example.com}/mcp', headers: { Authorization: 'Bearer ${API_KEY}' } },
        db: { command: 'db-server', args: ['--dsn', '${DATABASE_URL}'], env: { REGION: '${REGION:-eu-west-1}' } }
      }
    };
    const set = readServerConfig(config, { env: { API_KEY: 'k', DATABASE_URL: 'postgres://x', API_BASE: 'https://staging.example.com' } });
    expect(set.skipped).toEqual([]);
    expect(set.entries).toEqual([
      { kind: 'http', key: 'api', url: 'https://staging.example.com/mcp', headers: { Authorization: 'Bearer k' } },
      { kind: 'stdio', key: 'db', command: 'db-server', args: ['--dsn', 'postgres://x'], env: { REGION: 'eu-west-1' } }
    ]);
    const unset = readServerConfig(config, { env: {} });
    expect(unset.entries).toEqual([]);
    expect(unset.skipped).toEqual([
      { key: 'api', reason: 'needs the environment variable API_KEY' },
      { key: 'db', reason: 'needs the environment variable DATABASE_URL' }
    ]);
  });

  it("fills in VS Code's ${input:id} from --input or the input's default, and skips the server otherwise", () => {
    const config = {
      inputs: [
        { type: 'promptString', id: 'perplexity-key', description: 'Perplexity API Key', password: true },
        { type: 'pickString', id: 'environment', description: 'Environment', options: ['dev', 'prod'], default: 'dev' }
      ],
      servers: {
        perplexity: { type: 'stdio', command: 'npx', args: ['-y', 'server-perplexity-ask'], env: { PERPLEXITY_API_KEY: '${input:perplexity-key}' } },
        deploy: { type: 'stdio', command: 'deploy-mcp', args: ['--env', '${input:environment}'] }
      }
    };
    const without = readServerConfig(config, { path: join(scratch, 'w', '.vscode', 'mcp.json') });
    expect(without.entries.map((e) => [e.key, e.kind === 'stdio' ? e.args : []])).toEqual([['deploy', ['--env', 'dev']]]);
    expect(without.skipped).toEqual([{ key: 'perplexity', reason: 'needs the input "perplexity-key" (pass --input perplexity-key=<value>)' }]);
    const given = readServerConfig(config, { path: join(scratch, 'w', '.vscode', 'mcp.json'), inputs: { 'perplexity-key': 'pplx-1', environment: 'prod' } });
    expect(given.skipped).toEqual([]);
    expect(given.entries.map((e) => (e.kind === 'stdio' ? [e.key, e.args.at(-1), e.env] : []))).toEqual([
      ['perplexity', 'server-perplexity-ask', { PERPLEXITY_API_KEY: 'pplx-1' }],
      ['deploy', 'prod', undefined]
    ]);
  });

  it('leaves text that is not a placeholder as it is', () => {
    const { entries } = readServerConfig({ mcpServers: { a: { command: 'sh', args: ['-c', 'echo ${1} $HOME ${not a var} ${}'] } } }, { env: {} });
    expect(entries[0]).toMatchObject({ args: ['-c', 'echo ${1} $HOME ${not a var} ${}'] });
  });

  it('says which shapes it reads when the file is none of them', () => {
    for (const config of [{}, null, [], { servers: [] }, { mcpServers: 'x' }, { context_servers: {} }]) {
      expect(() => readServerConfig(config)).toThrow(/"mcpServers" map .* or a "servers" map/);
    }
  });
});

describe('parseEnvFile', () => {
  it('reads KEY=value lines', () => {
    expect(parseEnvFile('# comment\nA=1\nexport B="two words"\n\nC=\'x=y\'\n  D = spaced \nnot a line\n=nokey\n')).toEqual({ A: '1', B: 'two words', C: 'x=y', D: 'spaced' });
  });
});

describe('collectConfig on a VS Code workspace (e2e over stdio)', () => {
  const workspace = join(scratch, 'workspace');
  mkdirSync(join(workspace, '.vscode'), { recursive: true });
  writeFileSync(join(workspace, 'server.env'), 'FIXTURE_NOTE=from the env file\n');
  const configPath = join(workspace, '.vscode', 'mcp.json');
  writeFileSync(
    configPath,
    `{
  // Servers for this workspace.
  "inputs": [{ "type": "promptString", "id": "billing-key", "description": "Billing API key", "password": true }],
  "servers": {
    "invoices": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", ${JSON.stringify(join(root, 'examples', 'good-server', 'server.ts'))}],
      "envFile": "\${workspaceFolder}/server.env",
    },
    "billing": { "type": "stdio", "command": "npx", "args": ["billing-mcp"], "env": { "KEY": "\${input:billing-key}" } },
    "archived": { "type": "stdio", "command": "node", "args": ["old.js"], "disabled": true },
  },
}
`
  );

  it('starts the servers it can, from the workspace folder, and names the ones it cannot', async () => {
    const started: string[] = [];
    const skipped: SkippedServer[] = [];
    const errors: string[] = [];
    const target = await collectConfig(configPath, {
      onServerStart: (entry) => started.push(`${entry.key}@${entry.kind === 'stdio' ? entry.cwd : ''}`),
      onServerSkipped: (server) => skipped.push(server),
      onServerError: (entry, err) => errors.push(`${entry.key}: ${String(err)}`)
    });
    expect(errors).toEqual([]);
    expect(started).toEqual([`invoices@${workspace}`]);
    expect(skipped).toEqual([
      { key: 'billing', reason: 'needs the input "billing-key" (pass --input billing-key=<value>)' },
      { key: 'archived', reason: 'disabled in the config' }
    ]);
    expect(target.servers.map((s) => s.id)).toEqual(['invoices']);
    expect(target.tools.map((t) => t.name).sort()).toEqual(['get_invoice_detail', 'list_invoices', 'void_invoice']);
  }, 60_000);

  it('gives a server its working directory, its env file and its env, the env winning', async () => {
    const path = join(workspace, '.vscode', 'environment.json');
    mkdirSync(join(workspace, 'packages', 'api'), { recursive: true });
    writeFileSync(join(workspace, 'packages', 'api', '.env'), 'FIXTURE_FROM_FILE=file value\nFIXTURE_BOTH=from the file\n');
    writeFileSync(
      path,
      JSON.stringify({
        servers: {
          echo: {
            command: 'node',
            args: [join(root, 'tests', 'fixtures', 'servers', 'echo-environment.mjs'), '--root', '${workspaceFolder}'],
            cwd: '${workspaceFolder}/packages/api',
            envFile: '${workspaceFolder}/packages/api/.env',
            env: { FIXTURE_FROM_ENV: 'env value', FIXTURE_BOTH: 'from env' }
          },
          plain: { command: 'node', args: [join(root, 'tests', 'fixtures', 'servers', 'echo-environment.mjs')] }
        }
      })
    );
    const target = await collectConfig(path);
    const [echo, plain] = target.tools.map((t) => JSON.parse(t.description ?? '{}') as Record<string, unknown>);
    expect(echo).toEqual({ cwd: join(workspace, 'packages', 'api'), args: ['--root', workspace], fromFile: 'file value', fromEnv: 'env value', both: 'from env' });
    // With no "cwd", a VS Code server runs in the workspace folder.
    expect(plain).toMatchObject({ cwd: workspace, fromFile: null, fromEnv: null });
  }, 60_000);

  it('says so when no server in the file can be started', async () => {
    const path = join(workspace, '.vscode', 'only-inputs.json');
    writeFileSync(path, '{ "servers": { "billing": { "command": "x", "env": { "KEY": "${input:billing-key}" } }, "old": { "command": "y", "disabled": true } } }');
    await expect(collectConfig(path)).rejects.toThrow(/lists 2 servers, and none can be started: billing needs the input "billing-key" .*; old disabled in the config\./);
  });

  it('reports a file that is not JSON even with comments allowed', async () => {
    const path = join(workspace, 'broken.json');
    writeFileSync(path, '{ "servers": { // unterminated\n');
    await expect(collectConfig(path)).rejects.toThrow(/broken\.json is not valid JSON \(comments and trailing commas are allowed\): /);
  });
});
