#!/usr/bin/env node
// A stdio MCP server whose one tool describes where it was started and with what environment,
// so a test can see what a config's "cwd", "env" and "envFile" did to the process.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'echo-environment', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: 'where_am_i',
      description: JSON.stringify({
        cwd: process.cwd(),
        args: process.argv.slice(2),
        fromFile: process.env.FIXTURE_FROM_FILE ?? null,
        fromEnv: process.env.FIXTURE_FROM_ENV ?? null,
        both: process.env.FIXTURE_BOTH ?? null
      }),
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}));
await server.connect(new StdioServerTransport());
