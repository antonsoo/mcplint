// Controlled SDK metadata fixture. No callable tools, network requests or credentials.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(process.argv[2]);
const { Server } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/index.js')));
const { StdioServerTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')));
const { ListToolsRequestSchema } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/types.js')));
const { tools } = JSON.parse(await readFile(process.argv[3], 'utf8'));
const server = new Server({ name: 'enum-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
await server.connect(new StdioServerTransport());
