#!/usr/bin/env node
/**
 * A small, well-behaved MCP server used as an mcplint fixture: three tools
 * with clear names, complete descriptions, fully-described parameters, and
 * correct destructive/read-only annotations. `tests/e2e/fixtures.test.ts`
 * asserts that mcplint reports zero errors and zero warnings against it.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'mcplint-good-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: 'list_invoices',
      description:
        'Lists invoices for the current account, optionally filtered by status and date range. Returns invoice ' +
        'id, customer name, amount due, currency, and status for each match. Use this before calling ' +
        'get_invoice_detail if you only need a summary.',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['draft', 'sent', 'paid', 'overdue'],
            description:
              'Filter by invoice status: "draft" (not yet sent), "sent" (sent, awaiting payment), "paid" ' +
              '(payment received), or "overdue" (past due date, unpaid).'
          },
          since: {
            type: 'string',
            description: 'ISO 8601 date (YYYY-MM-DD). Only include invoices created on or after this date.'
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of invoices to return. Defaults to 50, capped at 200.'
          }
        },
        additionalProperties: false
      },
      annotations: {
        title: 'List invoices',
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    {
      name: 'get_invoice_detail',
      description:
        'Fetches full details for a single invoice by id, including line items, tax breakdown, and payment ' +
        'history. Call list_invoices first if you do not already know the invoice id.',
      inputSchema: {
        type: 'object',
        properties: {
          invoice_id: {
            type: 'string',
            description: 'The invoice id, e.g. "inv_01HXYZ". Obtained from list_invoices or a webhook payload.'
          }
        },
        required: ['invoice_id'],
        additionalProperties: false
      },
      annotations: {
        title: 'Get invoice detail',
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    {
      name: 'void_invoice',
      description:
        'Permanently voids a draft invoice so it can no longer be sent or paid. This cannot be undone; voided ' +
        'invoices are excluded from revenue reports. Only draft invoices can be voided — sent or paid invoices ' +
        'must be credited instead.',
      inputSchema: {
        type: 'object',
        properties: {
          invoice_id: {
            type: 'string',
            description: 'The id of the draft invoice to void, e.g. "inv_01HXYZ".'
          }
        },
        required: ['invoice_id'],
        additionalProperties: false
      },
      annotations: {
        title: 'Void invoice',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, (request) => {
  return {
    content: [{ type: 'text', text: `mcplint-good-fixture: pretend-executed "${request.params.name}"` }]
  };
});

await server.connect(new StdioServerTransport());
