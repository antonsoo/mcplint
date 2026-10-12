// Real MCP client transports and built CLI against controlled loopback peers.
// Every credential and tool in this study is synthetic. No external endpoints.
// node capture.mjs [package-root] [--check]
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] && process.argv[2] !== '--check'
  ? process.argv[2] : join(dirname(fileURLToPath(import.meta.url)), '../..'));
const { collectHttp } = await import(pathToFileURL(join(root, 'dist/collectors/http.js')));
const { connectionFailureMessage } = await import(pathToFileURL(join(root, 'dist/collectors/diagnostics.js')));
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-redirects-'));
const headers = { 'X-API-Key': 'SYNTHETIC_API_KEY', Authorization: 'Bearer SYNTHETIC_BEARER' };
const session = 'SYNTHETIC_SERVER_SESSION';
const privateLocation = 'SYNTHETIC_LOCATION_TOKEN';
const results = [];
const tool = { name: 'read_status', description: 'Read the synthetic local service status by its identifier.',
  inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Service identifier.' } }, required: ['id'] } };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () =>
  resolve(`http://127.0.0.1:${server.address().port}`)));

function record(req, raw) {
  return { method: req.method, path: req.url, body: raw,
    api_key: req.headers['x-api-key'] ?? null, authorization: req.headers.authorization ?? null,
    session: req.headers['mcp-session-id'] ?? null };
}
async function read(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
async function fixture(transport, kind, status) {
  const requests = [], leaked = [], failures = [];
  let stream;
  const receiver = createServer((req, res) => {
    void read(req).then(raw => {
      leaked.push(record(req, raw));
      res.writeHead(500).end('synthetic receiver');
    }).catch(error => failures.push(String(error)));
  });
  const foreign = await listen(receiver);
  const modern = transport === 'auto';
  const source = createServer((req, res) => {
    void (async () => {
      const raw = await read(req);
      requests.push(record(req, raw));
      const message = raw ? JSON.parse(raw) : {};
      const path = new URL(req.url, 'http://fixture').pathname;
      const isEntry = modern ? message.method === 'initialize' : req.method === 'GET';
      if (!modern && req.method === 'POST' && path === '/sse') { res.writeHead(405).end(); return; }
      let destination;
      if (kind === 'allowed' && !path.startsWith('/v2/')) destination = `./v2${path}`;
      else if (kind === 'initial' && isEntry) destination = `${foreign}/receive?token=${privateLocation}`;
      else if (kind === 'message' && message.method === 'initialize') destination = `${foreign}/receive?token=${privateLocation}`;
      else if (kind === 'initialized' && message.method === 'notifications/initialized') destination = `${foreign}/receive?token=${privateLocation}`;
      else if (kind === 'list' && message.method === 'tools/list') destination = `${foreign}/receive?token=${privateLocation}`;
      else if (kind === 'chain' && isEntry) destination = path === '/hop'
        ? `${foreign}/receive?token=${privateLocation}` : '/hop';
      else if (kind === 'loop' && isEntry) destination = path;
      if (destination) { res.writeHead(status, { Location: destination }).end('unused redirect body'); return; }
      if (!modern && req.method === 'GET') {
        stream = res;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: endpoint\ndata: /messages\n\n');
        return;
      }
      if (req.method === 'GET') { res.writeHead(405).end(); return; }
      const result = message.method === 'initialize'
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
          serverInfo: { name: 'redirect-fixture', version: '1.0.0' } }
        : { tools: [tool] };
      if (!modern) {
        res.writeHead(202).end();
        if (message.id !== undefined) stream.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`);
      } else if (message.id === undefined) res.writeHead(202).end();
      else {
        res.writeHead(200, { 'Content-Type': 'application/json',
          ...(message.method === 'initialize' ? { 'Mcp-Session-Id': session } : {}) });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      }
    })().catch(error => { failures.push(String(error)); if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  const base = await listen(source);
  return { url: `${base}/${modern ? 'mcp' : 'sse'}`, requests, leaked, failures,
    close: async () => {
      source.closeAllConnections(); receiver.closeAllConnections();
      await Promise.all([source, receiver].map(server => new Promise(resolve => server.close(resolve))));
    } };
}

async function cli(args) {
  const child = spawn(process.execPath, [join(root, 'dist/cli.js'), ...args],
    { cwd: scratch, env: { ...process.env, NO_COLOR: '1' } });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 10_000);
  const [code, signal] = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve([code, signal]));
  }).finally(() => clearTimeout(watchdog));
  return { code, signal, stdout, stderr };
}

async function run(entrypoint, transport, kind, status) {
  const server = await fixture(transport, kind, status);
  let outcome;
  try {
    if (entrypoint === 'library') {
      try {
        const target = await collectHttp({ url: server.url, headers,
          ...(transport === 'sse' ? { transport: 'sse' } : {}), connectTimeoutMs: 2000 });
        outcome = { complete: target.collection.every(row => row.status !== 'incomplete'),
          tool_count: target.tools.length, tools: target.tools.map(t => t.name), collection: target.collection };
      } catch (error) { outcome = { rejected: true, diagnostic: connectionFailureMessage(error) }; }
    } else {
      let args;
      if (transport === 'sse') {
        const config = join(scratch, 'mcp.json');
        await writeFile(config, JSON.stringify({ servers: { synthetic: { type: 'sse', url: server.url, headers } } }));
        args = ['config', config];
      } else args = ['http', server.url, ...Object.entries(headers).flatMap(([key, value]) => ['-H', `${key}: ${value}`])];
      const output = await cli([...args, '--format', 'json', '--fail-on', 'error', '--connect-timeout', '2000']);
      const report = output.stdout.trim() ? JSON.parse(output.stdout) : undefined;
      outcome = { code: output.code, signal: output.signal,
        diagnostic: output.stderr.trim().replaceAll(scratch, '<scratch>'),
        ...(report ? { complete: report.summary.complete, tool_count: report.summary.toolCount, collection: report.collection } : {}) };
    }
    const allowed = kind === 'allowed';
    const refused = outcome.rejected || outcome.complete === false || outcome.code === 2;
    const sessionRequests = server.requests.filter(row => row.body.includes('tools/list'));
    const checks = {
      fixture_valid: server.failures.length === 0,
      no_cross_origin_request: server.leaked.length === 0,
      expected_result: allowed ? outcome.complete === true && outcome.tool_count === 1 : Boolean(refused),
      same_origin_credentials_retained: server.requests.every(row => row.api_key === headers['X-API-Key'] && row.authorization === headers.Authorization),
      session_retained: transport !== 'auto' || sessionRequests.every(row => row.session === session),
      no_credentials_in_diagnostic: ![...Object.values(headers), privateLocation, session].some(value =>
        (outcome.diagnostic ?? '').includes(value)),
      bounded_loop: kind !== 'loop' || server.requests.length <= (transport === 'fallback' ? 22 : 21),
      finished: outcome.signal == null,
      ...(kind === 'initial' || kind === 'message' || kind === 'initialized' || kind === 'chain'
        ? { actionable_redirect_diagnostic: (outcome.diagnostic ?? '').includes('different origin') } : {}),
      ...(kind === 'loop' ? { actionable_redirect_diagnostic: (outcome.diagnostic ?? '').includes('20 redirects') } : {})
    };
    results.push({ entrypoint, transport, kind, status, outcome, checks,
      agrees: Object.values(checks).every(Boolean), source_requests: server.requests,
      receiver_requests: server.leaked, fixture_failures: server.failures });
  } finally { await server.close(); }
}

async function mixedConfig() {
  const blocked = await fixture('auto', 'initial', 307);
  const healthy = await fixture('sse', 'allowed', 308);
  try {
    const config = join(scratch, 'mixed.json');
    await writeFile(config, JSON.stringify({ servers: {
      redirected: { url: blocked.url, headers },
      healthy: { type: 'sse', url: healthy.url, headers }
    } }));
    const output = await cli(['config', config, '--format', 'json', '--fail-on', 'error', '--connect-timeout', '2000']);
    const report = JSON.parse(output.stdout);
    const checks = {
      fixture_valid: blocked.failures.length === 0 && healthy.failures.length === 0,
      no_cross_origin_request: blocked.leaked.length === 0,
      healthy_server_retained: report.summary.toolCount === 1,
      incomplete_unscored: report.summary.complete === false && report.summary.score === null,
      failure_exit: output.code === 1 && output.signal === null,
      connection_failure_retained: report.collection.some(row => row.serverId === 'redirected' && row.scope === 'connection' && row.status === 'incomplete'),
      actionable_redirect_diagnostic: output.stderr.includes('different origin'),
      no_credentials_in_diagnostic: ![...Object.values(headers), privateLocation].some(value => output.stderr.includes(value))
    };
    results.push({ entrypoint: 'cli', transport: 'mixed-config', kind: 'mixed', status: 307,
      outcome: { code: output.code, signal: output.signal, complete: report.summary.complete,
        tool_count: report.summary.toolCount, diagnostic: output.stderr.trim().replaceAll(scratch, '<scratch>'), collection: report.collection },
      checks, agrees: Object.values(checks).every(Boolean), source_requests: [...blocked.requests, ...healthy.requests],
      receiver_requests: blocked.leaked, fixture_failures: [...blocked.failures, ...healthy.failures] });
  } finally { await blocked.close(); await healthy.close(); }
}

try {
  for (const entrypoint of ['library', 'cli']) {
    for (const transport of ['auto', 'sse', 'fallback']) {
      for (const status of [301, 302, 303, 307, 308]) await run(entrypoint, transport, 'initial', status);
      for (const kind of ['initialized', 'list', 'chain', 'loop']) await run(entrypoint, transport, kind, 307);
      for (const status of [307, 308]) await run(entrypoint, transport, 'allowed', status);
      if (transport !== 'auto') await run(entrypoint, transport, 'message', 308);
    }
  }
  await mixedConfig();
  const receipt = { node: process.version, scope: 'Synthetic local peers; actual SDK clients and built CLI; no tool calls or external services.',
    cases: results.length, disagreements: results.filter(r => !r.agrees).length,
    cases_contacting_other_origin: results.filter(r => r.receiver_requests.length > 0).length,
    receiver_requests: results.reduce((sum, r) => sum + r.receiver_requests.length, 0), results };
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (process.argv.includes('--check') && receipt.disagreements) process.exitCode = 1;
} finally { await rm(scratch, { recursive: true, force: true }); }
