import spawn from 'cross-spawn';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JsonLineGuard, LiveJsonIntegrityError, MAX_STDIO_MESSAGE_BYTES } from './live-json.js';

const SHUTDOWN_GRACE_MS = 2000;
const activeTransports = new Set<GuardedStdioTransport>();
let shuttingDown = false;

/** CLI signal handling only: library imports install no process signal handlers.
 * Refuse subsequent config entries while the CLI joins cleanup and exits. */
export async function shutdownStdioProcesses(): Promise<void> {
  shuttingDown = true;
  await Promise.allSettled([...activeTransports].map(transport => transport.close()));
}

/** Polling also observes descendants after the launcher has exited. A child's
 * `close` event alone says nothing about helpers that did not inherit its pipes. */
async function waitForStop(stopped: () => boolean): Promise<void> {
  const deadline = performance.now() + SHUTDOWN_GRACE_MS;
  while (!stopped()) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return;
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(25, remaining)));
  }
}

interface ProcessOptions {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
}

/** MCP framing is bidirectional. The SDK's public stream transport accepts our
 * guarded readable; process creation and cleanup remain explicit here. */
export class GuardedStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  integrityError?: LiveJsonIntegrityError;
  private process?: ChildProcessByStdio<Writable, Readable, null>;
  private framing?: StdioServerTransport;
  private guard?: JsonLineGuard;
  private started = false;
  private closing?: Promise<void>;
  private closed = false;
  private processGroup?: number;

  constructor(private readonly options: ProcessOptions) {}

  async start(): Promise<void> {
    if (shuttingDown) throw new Error('Stdio collection was interrupted.');
    if (this.started) throw new Error('Stdio transport already started.');
    this.started = true;
    const child = spawn(this.options.command, this.options.args, {
      env: this.options.env, cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'inherit'], shell: false, windowsHide: process.platform === 'win32',
      // POSIX: isolate this launch from mcplint's own process group. Keep the
      // child referenced and connected; detached here supplies a group to stop,
      // rather than turning the MCP server into a background daemon.
      detached: process.platform !== 'win32',
    });
    // stdin/stdout are pipes; stderr is intentionally inherited as before.
    this.process = child as ChildProcessByStdio<Writable, Readable, null>;
    activeTransports.add(this);
    if (process.platform !== 'win32') this.processGroup = child.pid;
    const guard = this.guard = new JsonLineGuard();
    const framing = this.framing = new StdioServerTransport(guard, child.stdin!, {
      maxBufferSize: MAX_STDIO_MESSAGE_BYTES,
    });
    framing.onmessage = message => this.onmessage?.(message);
    framing.onerror = error => this.onerror?.(error);
    framing.onclose = () => this.notifyClosed();
    guard.on('error', (error: Error) => {
      if (error instanceof LiveJsonIntegrityError) this.integrityError = error;
      this.onerror?.(error);
      void this.close().catch(error => this.onerror?.(error as Error));
    });
    child.stdout!.on('error', error => this.onerror?.(error));
    child.stdin!.on('error', error => this.onerror?.(error));
    child.once('close', () => { void this.close().catch(error => this.onerror?.(error as Error)); });
    // Register listeners before the child can emit data or fail to spawn.
    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', error => { this.onerror?.(error); reject(error); });
    });
    await framing.start();
    child.stdout!.pipe(guard);
    await spawned;
  }

  private notifyClosed(): void {
    if (!this.closed) { this.closed = true; this.onclose?.(); }
  }

  close(): Promise<void> {
    this.closing ??= this.stop();
    return this.closing;
  }

  private async stop(): Promise<void> {
    await this.framing?.close();
    this.notifyClosed();
    const child = this.process;
    if (!child) return;
    child.stdout.unpipe(this.guard);
    this.guard?.destroy();
    // Drain while allowing graceful shutdown. A full output pipe must not
    // prevent a server from observing EOF or finishing its signal handler.
    child.stdout.resume();
    const exited = (): boolean => child.pid === undefined || child.exitCode !== null || child.signalCode !== null;
    const group = this.processGroup;
    let groupGone = false;
    const signalGroup = (signal: NodeJS.Signals | 0): boolean => {
      if (group === undefined || groupGone) return false;
      try { process.kill(-group, signal); return true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') { groupGone = true; return false; }
        throw error;
      }
    };
    const stopped = (): boolean => group === undefined ? exited() : !signalGroup(0);
    const signal = (name: NodeJS.Signals): void => {
      if (group !== undefined) signalGroup(name);
      else if (!exited()) child.kill(name);
    };
    try {
      child.stdin.end();
      await waitForStop(stopped);
      if (!stopped()) {
        signal('SIGTERM');
        await waitForStop(stopped);
      }
      if (!stopped()) {
        // The group can still contain a live server after npm/the shell has
        // exited. Do not gate escalation on the launcher's exitCode.
        signal('SIGKILL');
        // Orphaned zombies may keep a group id until their new parent reaps
        // them. Wait for our own child, without an unbounded group/pipe wait.
        await waitForStop(exited);
      }
    } finally {
      // A daemon can deliberately leave the group and retain inherited pipes.
      // Closing our endpoints bounds cleanup even in that unsupported case.
      child.stdin.destroy();
      child.stdout.destroy();
      child.unref();
      this.process = undefined;
      this.processGroup = undefined;
      activeTransports.delete(this);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.framing || this.closed) throw new Error('Stdio transport is not connected.');
    await this.framing.send(message);
  }
}
