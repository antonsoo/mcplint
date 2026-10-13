import spawn from 'cross-spawn';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JsonLineGuard, LiveJsonIntegrityError, MAX_STDIO_MESSAGE_BYTES } from './live-json.js';

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

  constructor(private readonly options: ProcessOptions) {}

  async start(): Promise<void> {
    if (this.started) throw new Error('Stdio transport already started.');
    this.started = true;
    const child = spawn(this.options.command, this.options.args, {
      env: this.options.env, cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'inherit'], shell: false, windowsHide: process.platform === 'win32',
    });
    // stdin/stdout are pipes; stderr is intentionally inherited as before.
    this.process = child as ChildProcessByStdio<Writable, Readable, null>;
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
      void this.close();
    });
    child.stdout!.on('error', error => this.onerror?.(error));
    child.stdin!.on('error', error => this.onerror?.(error));
    child.once('close', () => { void this.close(); });
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
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (!exited) {
      const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
      const wait = async (): Promise<void> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([closed, new Promise<void>(resolve => {
            timer = setTimeout(resolve, 2000);
          })]);
        } finally { clearTimeout(timer); }
      };
      child.stdin.end();
      await wait();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await wait();
      }
      if (child.exitCode === null && child.signalCode === null && child.kill('SIGKILL')) {
        await closed;
      }
    }
    this.process = undefined;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.framing || this.closed) throw new Error('Stdio transport is not connected.');
    await this.framing.send(message);
  }
}
