// Controlled, paginated SDK server. Metadata only; calling a tool is an error.
import { appendFileSync, readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const [input, log] = process.argv.slice(2);
const { tools } = JSON.parse(readFileSync(input, 'utf8'));
const server = new Server({ name: 'duplicate-name-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, request => {
  const page = request.params?.cursor === undefined ? 0 : Number(request.params.cursor);
  if (!Number.isInteger(page) || page < 0 || page >= tools.length) throw new Error('Invalid fixture cursor');
  appendFileSync(log, JSON.stringify({ method: 'tools/list', page }) + '\n');
  return { tools: [tools[page]], ...(page + 1 < tools.length ? { nextCursor: String(page + 1) } : {}) };
});
server.setRequestHandler(CallToolRequestSchema, () => {
  appendFileSync(log, JSON.stringify({ method: 'tools/call' }) + '\n');
  throw new Error('This fixture never executes tools');
});
await server.connect(new StdioServerTransport());
