import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { HttpRedirectError, originBoundFetch } from '../../src/collectors/http-redirects.js';

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); server.close(); }
});
async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// Native fetch is the independent oracle for same-origin method/body/header semantics.
it.each([301, 302, 303, 307, 308])('matches native fetch on same-origin %i redirects', async status => {
  const seen: unknown[] = [];
  const base = await listen(createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      if (req.url === '/from') { res.writeHead(status, { Location: './to' }).end('ignored'); return; }
      seen.push({ method: req.method, body: Buffer.concat(chunks).toString(),
        headers: Object.fromEntries(Object.entries(req.headers).filter(([key]) =>
          key.startsWith('content-') || ['authorization', 'x-api-key', 'mcp-session-id'].includes(key))) });
      res.writeHead(200).end('done');
    })();
  }));
  const guarded = originBoundFetch(new URL(base), error => { throw error; });
  for (const method of ['GET', 'HEAD', 'POST', 'DELETE']) {
    const body = method === 'GET' || method === 'HEAD' ? undefined : '{"value":"synthetic"}';
    const headers = { 'Content-Type': 'application/json', 'Content-Language': 'en',
      'Content-Encoding': 'identity', 'Content-Location': '/synthetic',
      Authorization: 'Bearer synthetic', 'X-API-Key': 'synthetic', 'Mcp-Session-Id': 'synthetic',
      ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}) };
    const init = { method, body, headers };
    await (await fetch(`${base}/from`, init)).text();
    await (await guarded(`${base}/from`, init)).text();
    expect(seen.at(-1)).toEqual(seen.at(-2));
    expect(init.headers['Content-Type']).toBe('application/json');
  }
});

it('checks scheme, host, port, credentials, and malformed URLs before another request', async () => {
  let location = '';
  let requests = 0;
  const base = await listen(createServer((_req, res) => {
    requests++;
    res.writeHead(307, { Location: location }).end();
  }));
  const configured = new URL(base);
  for (const destination of [base.replace('http:', 'https:'), base.replace('127.0.0.1', 'localhost'),
    'http://127.0.0.1:9/', 'http://[', `http://user:SYNTHETIC_PRIVATE@${configured.host}/`, 'file:///synthetic']) {
    location = destination;
    const before = requests;
    let captured: HttpRedirectError | undefined;
    await expect(originBoundFetch(configured, error => { captured = error; })(base))
      .rejects.toBeInstanceOf(HttpRedirectError);
    expect(requests - before).toBe(1);
    expect(captured?.message).not.toContain('SYNTHETIC_PRIVATE');
    expect(captured?.message).not.toContain(configured.host);
  }
});

it('allows twenty hops, bounds a loop, and preserves nonredirect responses', async () => {
  let requests = 0;
  const base = await listen(createServer((req, res) => {
    requests++;
    const remaining = Number(req.url?.slice(1));
    if (req.url === '/loop') res.writeHead(308, { Location: '/loop' }).end();
    else if (req.url === '/missing') res.writeHead(302).end('no location');
    else if (remaining > 0) res.writeHead(307, { Location: `/${remaining - 1}` }).end();
    else res.writeHead(200).end('done');
  }));
  const guarded = originBoundFetch(new URL(base), () => {});
  expect(await (await guarded(`${base}/20`)).text()).toBe('done');
  expect(requests).toBe(21);
  requests = 0;
  await expect(guarded(`${base}/loop`)).rejects.toThrow('20 redirects');
  expect(requests).toBe(21);
  const missing = await guarded(`${base}/missing`);
  expect(missing.status).toBe(302);
  expect(await missing.text()).toBe('no location');
});

it('retains abort signals across redirects', async () => {
  let arrived!: () => void;
  const atDestination = new Promise<void>(resolve => { arrived = resolve; });
  const base = await listen(createServer((req, res) => {
    if (req.url === '/from') res.writeHead(307, { Location: '/wait' }).end();
    else arrived();
  }));
  const controller = new AbortController();
  const pending = originBoundFetch(new URL(base), () => {})(`${base}/from`, { signal: controller.signal });
  const rejected = expect(pending).rejects.toThrow();
  await atDestination;
  controller.abort();
  await rejected;
});
