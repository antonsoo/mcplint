import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
// Synthetic values only. Never dump an actual process environment in a report.
const environment = Object.fromEntries(['MCPLINT_FIXTURE_TOKEN', 'TERM', 'MCPLINT_FIXTURE_MODE', 'MCPLINT_FIXTURE_KEEP']
  .map(key => [key, process.env[key] ?? null]));
const tools = [{ name: 'read_records', description: 'Read records from the configured synthetic fixture account.', inputSchema: { type: 'object', properties: {} } }];
if (process.env.MCPLINT_FIXTURE_TOKEN) tools.push({ name: 'write_records', description: 'Write records to the configured synthetic fixture account.', inputSchema: { type: 'object', properties: {} } });
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ environment, tools: tools.map(tool => tool.name) }));
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  if (request.method === 'initialize') {
    result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'environment-fixture', version: '1.0.0' } };
  } else if (request.method === 'tools/list') {
    result = { tools };
  } else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
