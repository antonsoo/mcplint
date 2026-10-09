// Synthetic, read-only JSON-RPC fixture. Raw responses deliberately bypass SDK schema validation.
// node server.mjs <valid|invalid|unresolved|mixed> <stdio|http> [request-log]
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';

const [mode = 'mixed', transport = 'stdio', log] = process.argv.slice(2);
if (!['valid', 'invalid', 'unresolved', 'mixed'].includes(mode)) throw new Error('Unknown fixture mode');
const metadata = JSON.parse(readFileSync(new URL(`${mode}.json`, import.meta.url), 'utf8'));
function respond(request) {
  if (log) appendFileSync(log, JSON.stringify({ method: request.method }) + '\n');
  if (request.id === undefined) return undefined;
  const result = request.method === 'initialize'
    ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: `schema-${mode}`, version: '1' } }
    : request.method === 'tools/list' ? metadata : undefined;
  return { jsonrpc: '2.0', id: request.id, ...(result ? { result } : { error: { code: -32601, message: 'This fixture only lists metadata.' } }) };
}

if (transport === 'stdio') {
  for await (const line of createInterface({ input: process.stdin })) {
    const response = respond(JSON.parse(line));
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }
} else if (transport === 'http') {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const reply = respond(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!reply) { response.writeHead(202).end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
    } catch {
      response.writeHead(400).end();
    }
  });
  server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}/mcp\n`));
  process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
} else throw new Error('Unknown fixture transport');
