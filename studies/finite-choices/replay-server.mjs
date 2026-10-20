// Local SDK metadata replay. These recorded definitions have no generation implementation.
import { appendFileSync, readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const tools = JSON.parse(readFileSync(new URL('captures/tools.json', import.meta.url), 'utf8')).tools;
const trace = process.env.MCPLINT_ENUM_TRACE;
const record = method => { if (trace) appendFileSync(trace, JSON.stringify({ method }) + '\n'); };
const server = new Server({ name: 'recorded-svgverseai-enum-replay', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => { record('tools/list'); return { tools }; });
server.setRequestHandler(CallToolRequestSchema, async () => {
  record('tools/call');
  throw new Error('This is a metadata-only replay; no generation tool is implemented.');
});
await server.connect(new StdioServerTransport());
