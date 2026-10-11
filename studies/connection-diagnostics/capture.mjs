// Controlled loopback and stdio failures. All credentials below are fictitious.
// node capture.mjs [path/to/built/cli.js] [--check]
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = resolve(process.argv[2] && process.argv[2] !== '--check' ? process.argv[2] : join(root, 'dist/cli.js'));
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-diagnostics-'));
const privateValue = 'SYNTHETIC_AUTH_PRIVATE_VALUE';
const privateInitialize = 'SYNTHETIC_INITIALIZE_PRIVATE_VALUE';
// Short enough that Node's JSON.parse excerpt includes the entire marker.
const privateSyntax = 'PRIVCFG';
const markers = [privateValue, privateInitialize, privateSyntax];
const requests = [];
const results = [];
const server = createServer((req, res) => {
  req.resume();
  requests.push({ path: req.url, authorization: req.headers.authorization });
  res.writeHead(503, { 'Content-Type': 'text/plain' });
  res.end(`Debug authorization=${req.headers.authorization}`);
});

async function run(name, args, check) {
  const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, NO_COLOR: '1' } });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 15_000);
  const [code, signal] = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve([code, signal]));
  }).finally(() => clearTimeout(watchdog));
  const checks = { finished: signal === null, private_values_omitted: !markers.some(value =>
    stdout.includes(value) || stderr.includes(value)), ...check({ code, stdout, stderr }) };
  results.push({ case: name, code, signal,
    stderr: stderr.replaceAll(scratch, '<scratch>'),
    checks, agrees: Object.values(checks).every(Boolean) });
}

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const config = join(scratch, 'servers.json');
  await writeFile(config, JSON.stringify({ servers: {
    broken_http: { url, headers: { Authorization: `Bearer ${privateValue}` } },
    broken_stdio: { command: process.execPath, args: [join(root, 'tests/fixtures/servers/initialize-error.mjs')] },
    healthy: { command: process.execPath, args: [join(root, 'tests/fixtures/servers/collection-evidence.mjs'), 'good'] }
  } }));
  await run('direct-http-body', ['http', url, '-H', `Authorization: Bearer ${privateValue}`],
    ({ code, stderr }) => ({ failure_exit: code === 2, retains_http_status: stderr.includes('HTTP 503') }));
  await run('direct-stdio-initialize', ['stdio', '--', process.execPath, join(root, 'tests/fixtures/servers/initialize-error.mjs')],
    ({ code, stderr }) => ({ failure_exit: code === 2, retains_mcp_code: stderr.includes('-32000') }));
  for (const format of ['json', 'sarif', 'html', 'markdown', 'terminal']) {
    await run(`mixed-config/${format}`, ['config', config, '--format', format, '--fail-on', 'error'],
      ({ code, stdout, stderr }) => {
        const report = format === 'json' ? JSON.parse(stdout) : undefined;
        return { failure_exit: code === 1,
          retains_http_status: stderr.includes('HTTP 503'),
          retains_mcp_code: stderr.includes('-32000'),
          ...(report ? { healthy_tools_retained: report.summary.toolCount === 1,
            incomplete: report.summary.complete === false && report.summary.score === null,
            two_failed_connections: report.collection.filter(row => row.scope === 'connection' && row.status === 'incomplete').length === 2 } : {}) };
      });
  }
  const malformed = join(scratch, 'malformed.json');
  await writeFile(malformed, privateSyntax);
  await run('malformed-config', ['config', malformed],
    ({ code, stderr }) => ({ failure_exit: code === 2, useful_syntax_error: stderr.includes('not valid JSON') }));
  await run('malformed-header', ['http', url, '-H', privateValue],
    ({ code, stderr }) => ({ failure_exit: code === 2, useful_header_error: stderr.includes('invalid --header') }));
  await run('malformed-input', ['config', config, '--input', privateValue],
    ({ code, stderr }) => ({ failure_exit: code === 2, useful_input_error: stderr.includes('invalid --input') }));
  const requestCheck = requests.length === 6 && requests.every(r => r.authorization === `Bearer ${privateValue}`);
  const receipt = { node: process.version,
    scope: 'Built CLI, real SDK transports, loopback HTTP and synthetic stdio responses. No remote servers or real credentials.',
    cases: results.length, disagreements: results.filter(row => !row.agrees).length,
    http_requests: requests.length, authorized_requests_unchanged: requestCheck, results };
  console.log(JSON.stringify(receipt, null, 2));
  if (process.argv.includes('--check') && (receipt.disagreements || !requestCheck)) process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
