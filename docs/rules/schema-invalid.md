# schema/invalid

**Category:** schema · **Default severity:** error

Fires when a tool's `inputSchema` is missing/null, isn't a JSON object, doesn't have `type: "object"` at the
root, or fails to compile as JSON Schema (checked with [Ajv](https://ajv.js.org/), 2020-12 dialect).

## Why it matters

The MCP spec requires `inputSchema` to be "a valid JSON Schema object (not `null`)" with a `type: "object"`
root — see [Tools: Data
Types](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#data-types). A schema that doesn't
compile can't be validated by the client or the server. Worse than that: in testing, the official
`@modelcontextprotocol/sdk` TypeScript client validates the *entire* `tools/list` response against the spec's
schema — one tool with an invalid `inputSchema` makes the whole response fail Zod validation, silently hiding
every other tool in the list from that client. mcplint works around this itself (falling back to an unvalidated
request so it can still report on the other tools; see `src/collectors/collect.ts`), but most real clients
won't.

## Example

```json
{ "name": "batch_tags", "inputSchema": { "type": "array", "items": { "type": "string" } } }
```

`type: "array"` at the root is invalid per the spec. Fix: wrap it — `{"type": "object", "properties": {"tags":
{"type": "array", "items": {"type": "string"}}}}`.

## How to fix

Make sure `inputSchema` is always present, is a plain object, and has `"type": "object"` at the root. Run the
schema through a JSON Schema validator during development, not just against real client input.

## Configuring

This rule doesn't check `$schema`-declared draft conformance — an older draft (e.g. `draft-07`) doesn't trigger
it, only structural invalidity does. Override severity with `"severities": {"schema/invalid": "off"}` (not
recommended), or ignore one tool with `"ignore": ["schema/invalid:<toolName>"]`.
