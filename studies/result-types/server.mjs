import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { responseFor, scopes } from './cases.mjs';

// Resolve the SDK from the actual tested source or installed package graph.
const require = createRequire(join(process.env.MCPLINT_ENGINE_ROOT, 'package.json'));
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const types = require('@modelcontextprotocol/sdk/types.js');
const item = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const transcript = process.argv[3];
const server = new Server({ name: 'synthetic-result-type', version: '1' },
  { capabilities: { tools: {}, prompts: {}, resources: {} } });
const schemas = [types.ListToolsRequestSchema, types.ListPromptsRequestSchema,
  types.ListResourcesRequestSchema, types.ListResourceTemplatesRequestSchema];
for (const [i, scope] of Object.keys(scopes).entries()) {
  server.setRequestHandler(schemas[i], request => responseFor(item, scope, request.params?.cursor));
}
const transport = new StdioServerTransport();
await server.connect(transport);
const receive = transport.onmessage;
transport.onmessage = message => {
  if (message.method) appendFileSync(transcript, JSON.stringify({ method: message.method,
    cursor: message.params?.cursor, protocolVersion: message.params?.protocolVersion }) + '\n');
  receive?.(message);
};
