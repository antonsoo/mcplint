# safety/missing-annotations

**Category:** safety · **Default severity:** warning

Fires when a tool's name or description contains a destructive-sounding verb stem (`delete`, `remove`,
`destroy`, `drop`, `purge`, `wipe`, `erase`/`eras-`, `terminat-`, `kill`, `uninstall`, `format`, `truncat-`,
`revok-`) but its `annotations` object is missing, or has neither `destructiveHint` nor `readOnlyHint` set.

## Why it matters

The MCP spec's [tool annotations](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) —
`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` — exist so a client can gate confirmation
prompts on tool behavior. A tool that sounds destructive but declares neither hint gives the client nothing to
gate on. Per spec, unset hints default to `readOnlyHint: false, destructiveHint: true`, which *is* the safe
default — but only if the client actually enforces that default rather than treating "unset" as "don't ask."
Declaring it explicitly removes the ambiguity.

## Example

```json
{
  "name": "delete_customer",
  "description": "Permanently deletes a customer account and all associated billing records from the system."
}
```

No `annotations` at all. Fix:

```json
{ "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true } }
```

## How to fix

Add `annotations.destructiveHint: true` (and `readOnlyHint: false`) to any tool that changes or removes state
irreversibly; add `readOnlyHint: true` instead if, despite the name, the tool is actually read-only (e.g. a
`preview_delete` dry-run).

## Configuring

Override severity with `"severities": {"safety/missing-annotations": "off"}`, or ignore one tool with
`"ignore": ["safety/missing-annotations:<toolName>"]`.
