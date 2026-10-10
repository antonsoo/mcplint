import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { collectHttp } from '../../src/collectors/http.js';
import { collectStdio } from '../../src/collectors/stdio.js';
import { collectConfig } from '../../src/collectors/config.js';
import { ConnectionTimeoutError } from '../../src/collectors/connect.js';
import { lint, shouldFail } from '../../src/core/lint.js';
import { resolveConfig } from '../../src/core/config.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

interface Message { id?: number; method?: string; params?: { protocolVersion?: string } }
const initialize = (message: Message) => ({
  protocolVersion: message.params?.protocolVersion,
  capabilities: { tools: {} }, serverInfo: { name: 'loopback-fixture', version: '1' }
});
const tools = { tools: [{ name: 'read_status', description: 'Read the status of the controlled local fixture.',
  inputSchema: { type: 'object', properties: {} } }] };
function json(res: ServerResponse, message: Message, result: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse, message: Message) => void | Promise<void>) {
  const active = new Set<ServerResponse>();
  const requests: { method: string; rpc: string | undefined; authorization: string | undefined }[] = [];
  const server = createServer((req, res) => {
    active.add(res);
    res.on('close', () => active.delete(res));
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => {
      const message: Message = body ? JSON.parse(body) as Message : {};
      requests.push({ method: req.method!, rpc: message.method, authorization: req.headers.authorization });
      Promise.resolve(handler(req, res, message)).catch(error => { res.destroy(error as Error); });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listening port');
  return { url: `http://127.0.0.1:${address.port}/mcp`, active, requests };
}

async function scratch(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'mcplint-connect-'));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

function good(req: IncomingMessage, res: ServerResponse, message: Message): void {
  if (req.method === 'GET') { res.writeHead(405).end(); return; }
  if (message.method === 'initialize') json(res, message, initialize(message));
  else if (message.method === 'notifications/initialized') res.writeHead(202).end();
  else if (message.method === 'tools/list') json(res, message, tools);
  else res.writeHead(202).end();
}

describe('actual transport connection deadlines', () => {
  for (const headers of [false, true]) {
    it(`closes legacy SSE that never sends an endpoint (headers sent: ${headers})`, async () => {
      const server = await listen((_req, res) => {
        if (headers) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': open\n\n'); }
      });
      await expect(collectHttp({ url: server.url, transport: 'sse', connectTimeoutMs: 300 }))
        .rejects.toBeInstanceOf(ConnectionTimeoutError);
      await expect.poll(() => server.active.size).toBe(0);
      expect(server.requests).toHaveLength(1);
    });
  }

  it('closes a silent HTTP initialize without a second transport attempt', async () => {
    const server = await listen(() => {});
    await expect(collectHttp({ url: server.url, connectTimeoutMs: 300 }))
      .rejects.toBeInstanceOf(ConnectionTimeoutError);
    await expect.poll(() => server.active.size).toBe(0);
    expect(server.requests.map(r => r.method)).toEqual(['POST']);
  });

  it('also bounds the initialized notification after a successful initialize response', async () => {
    const server = await listen((req, res, message) => {
      if (message.method !== 'notifications/initialized') good(req, res, message);
    });
    await expect(collectHttp({ url: server.url, connectTimeoutMs: 300 }))
      .rejects.toBeInstanceOf(ConnectionTimeoutError);
    await expect.poll(() => server.active.size).toBe(0);
    expect(server.requests.filter(r => r.method === 'POST').map(r => r.rpc))
      .toEqual(['initialize', 'notifications/initialized']);
  });

  it('shares the original deadline with legacy fallback', async () => {
    const server = await listen(async (req, res) => {
      if (req.method === 'POST') { await delay(300); res.writeHead(405).end(); }
      else { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': open\n\n'); }
    });
    const started = performance.now();
    await expect(collectHttp({ url: server.url, connectTimeoutMs: 700 }))
      .rejects.toBeInstanceOf(ConnectionTimeoutError);
    expect(performance.now() - started).toBeLessThan(950);
    await expect.poll(() => server.active.size).toBe(0);
    expect(server.requests.map(r => r.method)).toEqual(['POST', 'GET']);
  });

  it('keeps legacy fallback functional, including auth headers and list collection', async () => {
    let stream: ServerResponse | undefined;
    const server = await listen((req, res, message) => {
      if (req.method === 'GET') {
        stream = res;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: endpoint\ndata: /messages\n\n');
      } else if (req.url === '/mcp') res.writeHead(405).end();
      else {
        res.writeHead(202).end();
        if (message.id !== undefined) stream!.write(`data: ${JSON.stringify({ jsonrpc: '2.0',
          id: message.id, result: message.method === 'initialize' ? initialize(message) : tools })}\n\n`);
      }
    });
    const result = await collectHttp({ url: server.url, connectTimeoutMs: 2000,
      headers: { Authorization: 'Bearer controlled-fixture' } });
    expect(result.tools.map(t => t.name)).toEqual(['read_status']);
    expect(server.requests.every(r => r.authorization === 'Bearer controlled-fixture')).toBe(true);
    await expect.poll(() => server.active.size).toBe(0);
  });

  for (const failure of ['500', 'invalid-initialize']) {
    it(`does not hide ${failure} behind a legacy connection`, async () => {
      const server = await listen((_req, res, message) => {
        if (failure === '500') res.writeHead(500).end('controlled failure');
        else json(res, message, { ...initialize(message), protocolVersion: 'unsupported-fixture' });
      });
      await expect(collectHttp({ url: server.url, connectTimeoutMs: 1000 })).rejects.toThrow();
      expect(server.requests.map(r => r.method)).toEqual(['POST']);
      await expect.poll(() => server.active.size).toBe(0);
    });
  }

  it('clears the connection timer before slower, otherwise valid list collection', async () => {
    const server = await listen(async (req, res, message) => {
      if (message.method === 'tools/list') await delay(500);
      good(req, res, message);
    });
    const result = await collectHttp({ url: server.url, connectTimeoutMs: 300 });
    expect(result.tools.map(t => t.name)).toEqual(['read_status']);
    expect(result.collection?.find(c => c.scope === 'tools/list')?.status).toBe('complete');
  });

  it('does not fall back after initialize succeeded but the notification received HTTP 405', async () => {
    const server = await listen((req, res, message) => {
      if (message.method === 'notifications/initialized') res.writeHead(405).end();
      else good(req, res, message);
    });
    await expect(collectHttp({ url: server.url, connectTimeoutMs: 1000 })).rejects.toThrow();
    expect(server.requests.filter(r => r.method === 'POST').map(r => r.rpc))
      .toEqual(['initialize', 'notifications/initialized']);
    expect(server.requests.filter(r => r.method === 'GET')).toHaveLength(0);
  });

  it('closes the directly spawned stdio child that never initializes', async () => {
    const dir = await scratch();
    const pidFile = join(dir, 'pid');
    const script = `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)`;
    await expect(collectStdio({ command: process.execPath, args: ['-e', script, pidFile], connectTimeoutMs: 500 }))
      .rejects.toBeInstanceOf(ConnectionTimeoutError);
    const pid = Number(await readFile(pidFile, 'utf8'));
    await expect.poll(() => { try { process.kill(pid, 0); return true; } catch { return false; } }).toBe(false);
  });

  it('retains a timed-out config server as incomplete and audits the next server', async () => {
    const stalled = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': open\n\n');
    });
    const healthy = await listen(good);
    const config = join(await scratch(), '.mcp.json');
    await writeFile(config, JSON.stringify({ mcpServers: {
      stalled: { type: 'sse', url: stalled.url }, healthy: { url: healthy.url }
    } }));
    const target = await collectConfig(config, { connectTimeoutMs: 300 });
    expect(target.tools.map(t => t.serverId)).toEqual(['healthy']);
    expect(target.collection?.find(c => c.serverId === 'stalled')).toMatchObject({
      scope: 'connection', status: 'incomplete', retained: 0
    });
    expect(target.collection?.find(c => c.serverId === 'stalled')?.detail).toContain('300 ms');
    const result = lint(target, resolveConfig({ failOnFlag: 'error' }));
    expect(result.summary.score).toBeNull();
    expect(shouldFail(result)).toBe(true);
    await expect.poll(() => stalled.active.size).toBe(0);
  });

  for (const value of [0, -1, 1.5, Infinity, NaN, 2_147_483_648]) {
    it(`rejects invalid deadlines (${value}) before connecting`, async () => {
      const server = await listen(good);
      await expect(collectHttp({ url: server.url, connectTimeoutMs: value })).rejects.toThrow('connectTimeoutMs');
      expect(server.requests).toHaveLength(0);
    });
  }
});
