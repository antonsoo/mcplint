// Controlled SDK server: metadata revisions only. No tools are executed.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { appendFileSync } from 'node:fs';
const revision = process.argv[2] ?? 'before';
const transcript = process.argv[3];
const changed = revision === 'after';
const tool = (name, description) => ({ name, description,
  inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'Maximum number of records to return.', minimum: 1, maximum: revision === 'contract' || changed ? 200 : 100 } }, required: ['limit'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { 'fixture/origin': 'controlled-local-server', 'fixture/review': changed ? 'new' : 'original' },
});
const tools = [tool('search_records', 'Search stored records and return their identifiers, without reading document contents or changing storage.'),
  tool(changed ? 'export_records' : 'read_record', changed ? 'Export matching record identifiers as a local report. Does not upload records or contact another service.' : 'Read a stored record and return its contents. Does not modify the record or contact another service.')];
const prompts = [{ name: 'review_record', description: changed ? 'Review the complete record against the current policy.' : 'Review the record summary against the current policy.', arguments: [{ name: 'record', description: 'The record to review.', required: changed }] }];
const resources = [{ name: 'schema', uri: 'fixture:///catalog', description: changed ? 'Catalog schema revision two.' : 'Catalog schema revision one.', mimeType: 'application/json' },
  { name: 'schema', uri: 'fixture:///policy', description: 'Policy schema, independent of the catalog.', mimeType: 'application/json' }];
const templates = [{ name: 'collection', uriTemplate: 'fixture:///{collection}', description: 'Metadata about a named collection.', mimeType: changed ? 'text/csv' : 'application/json' }];
const instructions = changed ? 'Review the complete record before accepting an export.' : 'Review the record summary before accepting an export.';
const server = new Server({ name: 'metadata-review-fixture', version: '1.0.0' }, { capabilities: { tools: {}, prompts: {}, resources: {} }, instructions });
function record(method, request, response) {
  if (transcript) appendFileSync(transcript, JSON.stringify({ method, params: request.params ?? {}, response }) + '\n');
  return response;
}
server.setRequestHandler(ListToolsRequestSchema, request => {
  const page = request.params?.cursor === 'page-2' ? 1 : 0;
  if (revision === 'partial' && page === 1) throw new Error('Controlled failure after the first page');
  const rows = revision === 'duplicate' ? [tools[0], tools[0]] : tools;
  const selected = revision === 'reordered' ? [...rows].reverse() : rows;
  return record('tools/list', request, { tools: [selected[page]], ...(page === 0 ? { nextCursor: 'page-2' } : {}) });
});
server.setRequestHandler(ListPromptsRequestSchema, request => record('prompts/list', request, { prompts }));
server.setRequestHandler(ListResourcesRequestSchema, request => record('resources/list', request, { resources: revision === 'reordered' ? [...resources].reverse() : resources }));
server.setRequestHandler(ListResourceTemplatesRequestSchema, request => record('resources/templates/list', request, { resourceTemplates: templates }));
await server.connect(new StdioServerTransport());
