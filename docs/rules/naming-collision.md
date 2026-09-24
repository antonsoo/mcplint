# naming/collision

**Category:** naming · **Default severity:** error

Fires when two or more servers *in the same run* expose a tool with the exact same name. Only relevant for
`mcplint config` (or any run that merges multiple servers' tools) — a single `stdio`/`http`/`file` target only
ever collects from one server, so there's nothing to collide with.

## Why it matters

Most MCP clients namespace or flatten tool lists gathered from multiple configured servers. An exact name
collision means one tool silently shadows the other in the model's view — and neither the model nor a human
approving a tool call can tell which server's `search` is actually about to run.

## Example

`.mcp.json` configuring two servers that both register a tool literally named `search`:

```json
{ "mcpServers": { "docs": { "command": "docs-server" }, "web": { "command": "web-server" } } }
```

`mcplint config .mcp.json` reports: `"search" is defined identically by 2 servers: docs, web.`

## How to fix

Rename one of the colliding tools, or prefix both with a server-specific namespace (`docs_search`,
`web_search`) — the same disambiguation strategy the MCP spec itself recommends for clients that aggregate
tools across servers.

## Configuring

Override severity with `"severities": {"naming/collision": "off"}`, or ignore a specific name with `"ignore":
["naming/collision:<toolName>"]`.
