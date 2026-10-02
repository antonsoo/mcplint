// Remote MCP servers come in two generations: Streamable HTTP, and the HTTP+SSE transport it
// replaced, which many deployed servers still speak. These tests run a real server of each kind
// in this process, built from the SDK's own server transports, and connect the way the CLI does.
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectHttp } from '../../src/collectors/http.js';
import { collectConfig } from '../../src/collectors/config.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function mcpServer(name: string): Server {
  const server = new Server({ name, version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{ name: `${name.replace(/-/g, '_')}_lookup`, description: `Looks a record up on the ${name} server by its id.`, inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Record id.' } }, required: ['id'] } }]
  }));
  return server;
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

const listen = (server: HttpServer): Promise<string> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

/** The older transport: GET /sse opens the event stream, POST /messages?sessionId=... sends. */
function legacySseServer(seen: { authorization: (string | undefined)[]; posts: string[] }): HttpServer {
  const sessions = new Map<string, SSEServerTransport>();
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      seen.authorization.push(req.headers.authorization);
      if (req.method === 'GET' && url.pathname === '/sse') {
        const transport = new SSEServerTransport('/messages', res);
        sessions.set(transport.sessionId, transport);
        res.on('close', () => sessions.delete(transport.sessionId));
        await mcpServer('legacy-sse').connect(transport);
      } else if (req.method === 'POST' && url.pathname === '/messages') {
        const transport = sessions.get(url.searchParams.get('sessionId') ?? '');
        if (!transport) return void res.writeHead(404).end('unknown session');
        await transport.handlePostMessage(req, res, await body(req));
      } else {
        // What such a server says to a Streamable HTTP client's first POST.
        seen.posts.push(`${req.method} ${url.pathname}`);
        res.writeHead(req.method === 'POST' ? 405 : 404).end();
      }
    })();
  });
}

function streamableServer(): HttpServer {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/mcp') return void res.writeHead(404).end();
      const sessionId = req.headers['mcp-session-id'];
      let transport = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      const parsed = req.method === 'POST' ? await body(req) : undefined;
      if (!transport) {
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => void sessions.set(id, transport!) });
        await mcpServer('streamable').connect(transport);
      }
      await transport.handleRequest(req, res, parsed);
    })();
  });
}

describe('collectHttp', () => {
  const seen = { authorization: [] as (string | undefined)[], posts: [] as string[] };
  const legacy = legacySseServer(seen);
  const modern = streamableServer();
  let legacyUrl = '';
  let modernUrl = '';
  const scratch = mkdtempSync(join(tmpdir(), 'mcplint-http-'));
  beforeAll(async () => {
    legacyUrl = await listen(legacy);
    modernUrl = await listen(modern);
  });
  afterAll(() => {
    legacy.closeAllConnections();
    modern.closeAllConnections();
    legacy.close();
    modern.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('reaches a Streamable HTTP server', async () => {
    const target = await collectHttp({ url: `${modernUrl}/mcp` });
    expect(target.servers[0]).toMatchObject({ id: 'streamable' });
    expect(target.tools.map((t) => t.name)).toEqual(['streamable_lookup']);
  }, 30_000);

  it('falls back to HTTP+SSE for a server that only speaks that, sending the headers again', async () => {
    seen.authorization.length = 0;
    seen.posts.length = 0;
    const target = await collectHttp({ url: `${legacyUrl}/sse`, headers: { Authorization: 'Bearer legacy-token' } });
    expect(target.servers[0]).toMatchObject({ id: 'legacy-sse' });
    expect(target.tools.map((t) => t.name)).toEqual(['legacy_sse_lookup']);
    // Streamable HTTP was tried first, and refused.
    expect(seen.posts).toContain('POST /sse');
    expect(seen.authorization.length).toBeGreaterThan(2);
    expect(new Set(seen.authorization)).toEqual(new Set(['Bearer legacy-token']));
  }, 30_000);

  it('goes straight to HTTP+SSE when told the server is one', async () => {
    seen.posts.length = 0;
    const target = await collectHttp({ url: `${legacyUrl}/sse`, transport: 'sse' });
    expect(target.tools.map((t) => t.name)).toEqual(['legacy_sse_lookup']);
    expect(seen.posts).toEqual([]);
  }, 30_000);

  it('reports the Streamable HTTP error when neither transport gets an answer', async () => {
    await expect(collectHttp({ url: `${legacyUrl}/nothing-here` })).rejects.toThrow(/405|404|HTTP/);
    await expect(collectHttp({ url: 'http://127.0.0.1:9/mcp' })).rejects.toThrow();
  }, 30_000);

  it('a config with one server of each generation collects both', async () => {
    const path = join(scratch, 'mcp.json');
    writeFileSync(path, JSON.stringify({ servers: { old: { type: 'sse', url: `${legacyUrl}/sse` }, older: { url: `${legacyUrl}/sse` }, current: { type: 'http', url: `${modernUrl}/mcp` } } }));
    const errors: string[] = [];
    const target = await collectConfig(path, { onServerError: (entry, err) => errors.push(`${entry.key}: ${String(err)}`) });
    expect(errors).toEqual([]);
    expect(target.servers.map((s) => s.id)).toEqual(['old', 'older', 'current']);
    expect(target.tools.map((t) => `${t.serverId}/${t.name}`)).toEqual(['old/legacy_sse_lookup', 'older/legacy_sse_lookup', 'current/streamable_lookup']);
  }, 30_000);
});
