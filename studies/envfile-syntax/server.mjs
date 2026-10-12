import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';

// Only synthetic fixture variables are recorded, never the ambient environment.
const expected = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const observed = { token: process.env.MCPLINT_ENVFILE_TOKEN ?? null, note: process.env.MCPLINT_ENVFILE_NOTE ?? null };
writeFileSync(process.argv[3], JSON.stringify(observed));
const authenticated = observed.token === expected.token && observed.note === expected.note;
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  if (request.method === 'initialize' && !authenticated) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'Synthetic fixture authentication failed.' } }) + '\n');
    continue;
  }
  const result = request.method === 'initialize'
    ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'envfile-fixture', version: '1.0.0' } }
    : request.method === 'tools/list'
      ? { tools: [{ name: 'read_records', description: 'Read records from the synthetic fixture account.', inputSchema: { type: 'object', properties: {} } }] }
      : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
