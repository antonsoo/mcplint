import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.platform !== 'linux') throw new Error('This evidence replay uses Linux /proc.');
const root = resolve(process.argv[2] ?? '.');
const output = resolve(process.argv[3] ?? 'studies/stdio-processes/results/library.json');
const signals = () => ({ SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM') });
const beforeImport = signals();
const { collectStdio } = await import(pathToFileURL(join(root, 'dist/index.js')).href);
assert.deepEqual(signals(), beforeImport, 'Library import must not install process signal handlers');
const requireTarget = createRequire(join(root, 'package.json'));
const modules = ['mcp', 'stdio'].map(name => pathToFileURL(requireTarget.resolve(`@modelcontextprotocol/sdk/server/${name}.js`)).href);
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'mcplint-library-replay-'));
let pid;
try {
  const options = { command: 'npm', args: ['run', '--silent', '--prefix', fixtures, 'server', '--',
    directory, 'stalled-resistant', ...modules], connectTimeoutMs: 10000 };
  const reason = new Error('controlled caller cancellation');
  const preaborted = new AbortController();
  preaborted.abort(reason);
  await assert.rejects(collectStdio({ ...options, signal: preaborted.signal }), error => error === reason);
  assert.equal(existsSync(join(directory, 'server.pid')), false, 'Cancelled input must not spawn a process');
  const controller = new AbortController();
  const pending = collectStdio({ ...options, signal: controller.signal }).catch(error => error);
  for (let i = 0; i < 200 && !existsSync(join(directory, 'server.pid')); i++) await delay(20);
  pid = Number(await readFile(join(directory, 'server.pid'), 'utf8'));
  controller.abort(reason);
  assert.equal(await pending, reason, 'Cancellation must retain the caller reason');
  let running = false;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    running = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const first = (await readFile(join(directory, 'heartbeat'))).length;
  await delay(200);
  const second = (await readFile(join(directory, 'heartbeat'))).length;
  assert.equal(running, false, 'Collection rejected before the resistant server stopped');
  assert.equal(first, second, 'Server kept working after cancellation');
  assert.deepEqual(signals(), beforeImport, 'Collection must not change process signal handlers');
  const result = {
    node: process.version, platform: process.platform,
    transportSha256: createHash('sha256').update(await readFile(join(root, 'dist/collectors/stdio-transport.js'))).digest('hex'),
    signalHandlersUnchanged: true, preabortedLaunchPrevented: true, callerReasonPreserved: true,
    resistantServerStoppedBeforeRejection: !running, heartbeatAdvancedAfterRejection: second > first
  };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  await rm(directory, { recursive: true, force: true });
}
