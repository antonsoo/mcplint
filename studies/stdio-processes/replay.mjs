import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

if (process.platform !== 'linux') throw new Error('This evidence replay uses Linux /proc to distinguish live processes from zombies.');
const root = resolve(process.argv[2] ?? '.');
const output = resolve(process.argv[3] ?? 'studies/stdio-processes/results/after.json');
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const requireTarget = createRequire(join(root, 'package.json'));
const modules = ['mcp', 'stdio'].map(name => pathToFileURL(requireTarget.resolve(`@modelcontextprotocol/sdk/server/${name}.js`)).href);

async function state(pid) {
  if (!pid) return 'not-started';
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] === 'Z' ? 'zombie' : 'running';
  } catch { return 'gone'; }
}
async function size(file) { try { return (await readFile(file)).length; } catch { return 0; } }
async function pidAt(directory) {
  const path = join(directory, 'server.pid');
  for (let i = 0; i < 150; i++) {
    if (existsSync(path)) return Number(await readFile(path, 'utf8'));
    await delay(20);
  }
  throw new Error('Controlled server never recorded its PID');
}
const results = [];
const cases = process.argv.includes('--interrupt-controls') ? [
  ['group-SIGINT', 'stalled-resistant'], ['config-SIGINT', 'stalled-resistant']
] : [
  ['direct', 'graceful'], ['npm', 'graceful'], ['npm', 'lingering'],
  ['npm', 'resistant'], ['npm', 'stalled'], ['exited-wrapper', 'resistant'],
  ['direct', 'background'], ['npm', 'damaged'],
  ['SIGINT', 'stalled-resistant'], ['SIGTERM', 'stalled-resistant']
];
for (const [launcher, mode] of cases) {
  const directory = await mkdtemp(join(tmpdir(), 'mcplint-process-replay-'));
  const control = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let cli;
  let pid;
  let timedOut = false;
  let timer;
  let deadline;
  let cliExit = null;
  let helper;
  try {
    const args = [directory, mode, ...modules];
    const interruptedCase = launcher.includes('SIG');
    const npm = launcher === 'npm' || interruptedCase;
    const command = npm ? 'npm' : process.execPath;
    const serverArgs = npm ? ['run', '--silent', '--prefix', fixtures, 'server', '--', ...args]
      : [join(fixtures, launcher === 'direct' ? 'server.mjs' : 'wrapper.mjs'), ...args];
    const connectionMs = interruptedCase ? 60000
      : mode === 'stalled' || launcher === 'exited-wrapper' ? 1200 : 5000;
    let cliArgs = ['stdio', '--format', 'json', '--connect-timeout', String(connectionMs), '--', command, ...serverArgs];
    if (launcher === 'config-SIGINT') {
      const later = join(directory, 'later');
      await mkdir(later);
      const config = join(directory, '.mcp.json');
      await writeFile(config, JSON.stringify({ mcpServers: {
        current: { command, args: serverArgs },
        later: { command: process.execPath, args: [join(fixtures, 'server.mjs'), later, 'graceful', ...modules] }
      } }));
      cliArgs = ['config', config, '--format', 'json', '--connect-timeout', String(connectionMs)];
    }
    const started = performance.now();
    cli = spawn(process.execPath, [join(root, 'dist/cli.js'), ...cliArgs], {
      stdio: ['ignore', 'pipe', 'pipe'], detached: launcher === 'group-SIGINT'
    });
    cli.once('exit', (code, signal) => { cliExit = { code, signal }; });
    let stdout = '';
    let stderr = '';
    cli.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    cli.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const finished = new Promise(resolve => cli.once('close', (code, signal) => resolve({ code, signal })));
    pid = await pidAt(directory);
    if (launcher === 'group-SIGINT') process.kill(-cli.pid, 'SIGINT');
    else if (interruptedCase) cli.kill(launcher.endsWith('SIGINT') ? 'SIGINT' : 'SIGTERM');
    timer = setTimeout(() => { timedOut = true; cli.kill('SIGKILL'); }, 8500);
    // An escaped server keeps inherited output pipes open after the CLI is killed.
    const outcome = await Promise.race([finished, new Promise(resolve => {
      deadline = setTimeout(() => resolve({ code: null, signal: 'deadline' }), 9000);
    })]);
    clearTimeout(timer);
    clearTimeout(deadline);
    const elapsedMs = Math.round(performance.now() - started);
    const first = await size(join(directory, 'heartbeat'));
    await delay(200);
    const second = await size(join(directory, 'heartbeat'));
    const helperPath = join(directory, 'helper.pid');
    if (existsSync(helperPath)) helper = Number(await readFile(helperPath, 'utf8'));
    const helperFirst = await size(join(directory, 'helper-heartbeat'));
    await delay(120);
    const helperSecond = await size(join(directory, 'helper-heartbeat'));
    let events = [];
    try { events = (await readFile(join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch {}
    let report;
    try { report = JSON.parse(stdout); } catch {}
    const result = {
      launcher, mode, connectionMs, ...outcome, timedOut, elapsedMs,
      cliExit,
      collectedTools: report?.summary?.toolCount ?? null,
      complete: report?.summary?.complete ?? null,
      serverStateAfterReturn: await state(pid), heartbeatAdvancedAfterReturn: second > first,
      ...(helper ? { helperStateAfterReturn: await state(helper), helperHeartbeatAdvancedAfterReturn: helperSecond > helperFirst } : {}),
      ...(launcher === 'config-SIGINT' ? { laterServerStarted: existsSync(join(directory, 'later/server.pid')) } : {}),
      unrelatedProcessSurvived: await state(control.pid) === 'running',
      events: events.map(({ event }) => event), stderr: stderr.trim().replaceAll(directory, '<scratch>')
    };
    results.push(result);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    clearTimeout(timer);
    clearTimeout(deadline);
    if (cli) cli.kill('SIGKILL');
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    if (helper) { try { process.kill(helper, 'SIGKILL'); } catch {} }
    control.kill('SIGKILL');
    // Closing readers is replay cleanup, never product cleanup or a success criterion.
    cli?.stdout.destroy();
    cli?.stderr.destroy();
    await delay(80);
    await rm(directory, { recursive: true, force: true });
  }
}
await writeFile(output, JSON.stringify({
  node: process.version, platform: process.platform,
  transportSha256: createHash('sha256').update(await readFile(join(root, 'dist/collectors/stdio-transport.js'))).digest('hex'),
  fixture: 'synthetic local native MCP SDK server with a 40 ms heartbeat', results
}, null, 2) + '\n');
if (process.argv.includes('--expect-clean')) {
  for (const row of results) {
    const label = `${row.launcher}/${row.mode}`;
    assert.equal(row.timedOut, false, `${label}: CLI/captured output did not finish`);
    assert.notEqual(row.serverStateAfterReturn, 'running', `${label}: server survived`);
    assert.equal(row.heartbeatAdvancedAfterReturn, false, `${label}: server kept working`);
    assert.notEqual(row.helperStateAfterReturn, 'running', `${label}: background helper survived`);
    assert.notEqual(row.helperHeartbeatAdvancedAfterReturn, true, `${label}: background helper kept working`);
    assert.equal(row.unrelatedProcessSurvived, true, `${label}: unrelated process was stopped`);
    const failed = row.mode === 'stalled' || row.launcher === 'exited-wrapper';
    const interrupted = row.launcher.includes('SIG');
    const code = interrupted ? row.launcher.endsWith('SIGINT') ? 130 : 143 : failed ? 2 : 0;
    assert.equal(row.code, code, `${label}: wrong exit status`);
    assert.equal(row.collectedTools, failed || interrupted ? null : row.mode === 'damaged' ? 0 : 1, `${label}: wrong inventory`);
    assert.equal(row.complete, failed || interrupted ? null : row.mode !== 'damaged', `${label}: wrong coverage`);
    if (row.mode === 'graceful') assert.deepEqual(row.events, ['stdin:end', 'exit:0']);
    assert.notEqual(row.laterServerStarted, true, `${label}: config continued after interruption`);
    assert.equal(row.stderr.includes('starting later'), false, `${label}: config advanced after interruption`);
  }
}
