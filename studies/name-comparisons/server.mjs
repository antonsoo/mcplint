// Controlled stdio fixture. Lists metadata only; no tools are callable.
import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const tools = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const server = new Server({ name: 'name-comparison-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
await server.connect(new StdioServerTransport());
