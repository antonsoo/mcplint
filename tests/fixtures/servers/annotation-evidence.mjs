// Serve saved metadata without the SDK's server-side validation hiding invalid fields.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
const tools = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const result = request.method === 'initialize'
    ? { protocolVersion: '2025-11-25', capabilities: { tools: {} },
      serverInfo: { name: 'annotation-fixture', version: '1' } }
    : { tools };
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
}
