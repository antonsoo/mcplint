# naming/convention-consistency

**Category:** naming · **Default severity:** info

Fires when a single server (with at least 3 tools) mixes naming conventions — some tools `snake_case`, others
`camelCase`, `kebab-case`, or `dot.case`.

## Why it matters

A model has to remember which convention each tool uses in order to predict or recall a name correctly. Most
real MCP servers are consistently `snake_case`; a server that mixes conventions makes that harder for no
benefit. This is the lowest-stakes naming rule (info, not warning or error) — it's a polish suggestion, not a
correctness or safety issue.

## Example

A server exposing `list_invoices`, `get_invoice_detail`, and `voidInvoice` (nine tools, mostly `snake_case`, one
`camelCase`) trips this rule: `Mixed naming conventions across 9 tools: snake_case (8), dot.case (1)`.

## How to fix

Pick one convention (usually `snake_case`, matching most existing MCP servers) and rename outliers to match it.

## Configuring

Override severity with `"severities": {"naming/convention-consistency": "off"}` in `.mcplintrc.json`. This rule
reports once per server (subject is the server id), so per-subject ignoring targets the server id rather than a
tool name.
