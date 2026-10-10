// Real loopback HTTP, SDK clients and child processes. No mocks or remote endpoints.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const { values } = parseArgs({ options: {
  dist: { type: 'string', default: 'dist' }, out: { type: 'string' },
  node: { type: 'string', default: process.execPath },
  'observe-only': { type: 'boolean' }, case: { type: 'string' },
  watchdog: { type: 'string', default: '5000' }, html: { type: 'string' }
} });
assert(values.out, '--out is required');
const dist = resolve(values.dist);
const cache = resolve('studies/connection-deadlines/cache');
await mkdir(cache, { recursive: true });
const work = await mkdtemp(join(cache, 'replay-'));
const watchdogMs = Number(values.watchdog);
assert(Number.isInteger(watchdogMs) && watchdogMs > 0);
const deadlineMs = 500;
const cases = ['sse-no-endpoint', 'sse-no-headers', 'http-no-initialize', 'http-no-notification',
  'fallback-deadline', 'http-500', 'legacy-success', 'slow-list', 'stdio-silent', 'config-continues', 'cli-config'];
const selected = values.case ? cases.filter(name => name === values.case) : cases;
assert(selected.length, 'Unknown case');
const child = `
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const [directory, url, scenario, configPath, deadline, html] = process.argv.slice(1);
const api = await import(pathToFileURL(directory + '/index.js'));
try {
 const options = { connectTimeoutMs: Number(deadline) };
 const target = scenario === 'stdio-silent'
   ? await api.collectStdio({ ...options, command: process.execPath, args: ['-e',
       "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", configPath + '.pid'] })
   : scenario === 'config-continues'
   ? await api.collectConfig(configPath, options)
   : await api.collectHttp({ url, ...options,
       ...(scenario.startsWith('sse-') ? { transport: 'sse' } : {}),
       headers: { Authorization: 'Bearer controlled-fixture' } });
 const report = api.lint(target, api.resolveConfig({ failOnFlag: 'error' }));
 if (html && scenario === 'config-continues') await writeFile(html, api.renderHtml(report));
 console.log(JSON.stringify({ outcome: 'report', tools: target.tools.map(t => t.name),
   summary: report.summary, collection: target.collection }));
 if (api.shouldFail(report)) process.exitCode = 1;
} catch (error) {
 console.log(JSON.stringify({ outcome: 'error', name: error.name, message: error.message }));
 process.exitCode = 2;
}
`;
const results = [];
for (const scenario of selected) {
  const requests = [];
  const active = new Set();
  let stream;
  const server = createServer((req, res) => {
    active.add(res);
    res.on('close', () => active.delete(res));
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const message = body ? JSON.parse(body) : {};
      requests.push({ method: req.method, path: req.url, rpc: message.method ?? null });
      const initialize = { protocolVersion: message.params?.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: 'controlled-loopback', version: '1' } };
      const tools = { tools: [{ name: 'read_status', description: 'Read the status of the controlled local fixture.',
        inputSchema: { type: 'object', properties: {} } }] };
      const json = result => { res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })); };
      const sse = () => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': open\n\n'); };
      if (scenario === 'sse-no-headers' || scenario === 'http-no-initialize') return;
      if (scenario === 'sse-no-endpoint') { sse(); return; }
      if (['config-continues', 'cli-config'].includes(scenario) && req.url === '/stalled') { sse(); return; }
      if (scenario === 'http-500') {
        if (req.method === 'POST') res.writeHead(500).end('controlled fixture outage');
        else sse();
        return;
      }
      if (scenario === 'fallback-deadline') {
        if (req.method === 'POST') { await delay(250); res.writeHead(405).end(); }
        else sse();
        return;
      }
      if (scenario === 'legacy-success') {
        if (req.method === 'GET') { stream = res; sse(); res.write('event: endpoint\ndata: /messages\n\n'); }
        else if (req.url === '/mcp') res.writeHead(405).end();
        else {
          res.writeHead(202).end();
          if (message.id !== undefined) stream.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id,
            result: message.method === 'initialize' ? initialize : tools })}\n\n`);
        }
        return;
      }
      if (req.method === 'GET') { res.writeHead(405).end(); return; }
      if (message.method === 'initialize') json(initialize);
      else if (message.method === 'notifications/initialized') {
        if (scenario !== 'http-no-notification') res.writeHead(202).end();
      } else if (message.method === 'tools/list') {
        if (scenario === 'slow-list') await delay(750);
        json(tools);
      } else res.writeHead(202).end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(work, `${scenario}.json`);
  await writeFile(configPath, JSON.stringify({ mcpServers: {
    stalled: { type: 'sse', url: origin + '/stalled' }, healthy: { url: origin + '/healthy' }
  } }));
  const cli = scenario === 'cli-config';
  const args = cli ? [join(dist, 'cli.js'), 'config', configPath, '--format', 'json', '--fail-on', 'error',
    ...(values['observe-only'] ? [] : ['--connect-timeout', String(deadlineMs)])]
    : ['--input-type=module', '-e', child, dist, origin + '/mcp', scenario, configPath, String(deadlineMs), values.html ? resolve(values.html) : ''];
  const started = performance.now();
  const processChild = spawn(values.node, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', killed = false, activeAtWatchdog = null;
  processChild.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  processChild.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(async () => {
    killed = true;
    activeAtWatchdog = active.size;
    // The fixture can inherit the client's stderr pipe. Stop it before waiting
    // for client 'close', otherwise that pipe can keep the watchdog itself open.
    if (scenario === 'stdio-silent') {
      try { process.kill(Number(await readFile(configPath + '.pid', 'utf8')), 'SIGKILL'); }
      catch { /* The fixture may already have exited. */ }
    }
    processChild.kill('SIGKILL');
  }, watchdogMs);
  const exitCode = await new Promise((resolve, reject) => {
    processChild.on('error', reject);
    processChild.on('close', resolve);
  });
  clearTimeout(timer);
  const elapsedMs = performance.now() - started;
  // Observe cleanup before the fixture server itself is closed.
  await delay(30);
  const activeAfterExit = active.size;
  let stdioChildAlive = null;
  if (scenario === 'stdio-silent') {
    const pid = Number(await readFile(configPath + '.pid', 'utf8'));
    try { process.kill(pid, 0); stdioChildAlive = true; } catch { stdioChildAlive = false; }
    // A watchdog-killed baseline client may leave its directly spawned fixture alive.
    if (stdioChildAlive) process.kill(pid, 'SIGKILL');
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const output = stdout.trim() ? JSON.parse(stdout) : null;
  let passed = !killed && activeAfterExit === 0 && stdioChildAlive !== true;
  if (['legacy-success', 'slow-list'].includes(scenario)) {
    passed &&= exitCode === 0 && output?.outcome === 'report' && output.tools[0] === 'read_status';
  } else if (['config-continues', 'cli-config'].includes(scenario)) {
    const coverage = output?.collection;
    passed &&= exitCode === 1 && output?.summary.score === null &&
      coverage.some(c => c.serverId === 'stalled' && c.status === 'incomplete' && c.detail.includes('500 ms')) &&
      requests.some(r => r.path === '/healthy' && r.rpc === 'tools/list');
  } else if (scenario === 'http-500') {
    passed &&= exitCode === 2 && requests.every(r => r.method === 'POST');
  } else {
    passed &&= exitCode === 2 && output?.name === 'ConnectionTimeoutError';
    if (scenario === 'fallback-deadline') passed &&= elapsedMs < 1000;
  }
  passed &&= requests.every(r => r.rpc !== 'tools/call');
  results.push({ scenario, deadlineMs, watchdogMs, elapsedMs, exitCode, watchdogKilled: killed,
    activeAtWatchdog, stdioChildAlive, activeResponsesAfterChildExit: activeAfterExit, requests, output,
    stderr: stderr.replaceAll(work, '<fixture-directory>'), matchesExpected: Boolean(passed) });
}
const report = { node: execFileSync(values.node, ['--version'], { encoding: 'utf8' }).trim(),
  scenarios: results.length, disagreements: results.filter(r => !r.matchesExpected).length, results };
await mkdir(resolve(values.out, '..'), { recursive: true });
await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
await rm(work, { recursive: true, force: true });
console.log(`${report.scenarios} real-transport scenarios; ${report.disagreements} disagreements`);
if (report.disagreements && !values['observe-only']) process.exitCode = 1;
