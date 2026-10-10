// Deliberately malformed metadata, served over the real SDK stdio transport.
// No resource bodies, tools, external services or user files are accessed.
import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListResourcesRequestSchema, ListResourceTemplatesRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const snapshot = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const server = new Server({ name: 'resource-identity-fixture', version: '1.0.0' }, { capabilities: { resources: {} } });
server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: snapshot.resources ?? [] }));
server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({ resourceTemplates: snapshot.resourceTemplates ?? [] }));
await server.connect(new StdioServerTransport());
