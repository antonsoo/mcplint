# schema/invalid

**Category:** schema · **Default severity:** error

Checks each tool's `inputSchema` and, when supplied, `outputSchema` independently. Both must be JSON
objects; input schemas must also have `type: "object"` at the root. Output schemas can describe arrays,
scalars, null or objects. This follows the
[2026-07-28 tool definition](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts).

The rule reports malformed schema structure using [Ajv](https://ajv.js.org/) meta-schema validation.
It then compiles the schema to check reference resolution and compiler compatibility. Compilation
failures are reported as [`safety/unchecked`](safety-unchecked.md), since a compiler limitation does
not by itself prove a schema invalid. The distinction affects audit completeness and scoring.

| `$schema` | Validator |
|---|---|
| Absent | JSON Schema 2020-12 |
| Draft-06 | Draft-06 |
| Draft-07 | Draft-07 |
| 2019-09 | 2019-09 |
| 2020-12 | 2020-12 |
| Other dialects, or mixed dialects within one document | Unchecked; score unavailable |

Known dialect URIs accept HTTP/HTTPS and an optional trailing `#`. The declared dialect is retained;
draft-07 tuple `items` arrays are valid there, but require `prefixItems` under 2020-12.

## Why it matters

The MCP spec requires `inputSchema` to be "a valid JSON Schema object (not `null`)" with a `type: "object"`
root — see [Tools: Data
Types](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#data-types). A schema that doesn't
describe valid inputs can't reliably be used by a client or server. In testing, the official
`@modelcontextprotocol/sdk` TypeScript client validates the *entire* `tools/list` response against the spec's
schema — one tool with an invalid `inputSchema` makes the whole response fail Zod validation, silently hiding
every other tool in the list from that client. mcplint uses a lenient list request and validates the retained
items itself (see `src/collectors/collect.ts`) so a bad schema does not hide its siblings. This SDK example
concerns malformed MCP envelopes; it does not mean the SDK detects every nested schema error.

## Example

```json
{ "name": "batch_tags", "inputSchema": { "type": "array", "items": { "type": "string" } } }
```

`type: "array"` at the root is invalid per the spec. Fix: wrap it — `{"type": "object", "properties": {"tags":
{"type": "array", "items": {"type": "string"}}}}`.

## How to fix

Make sure `inputSchema` is always present, is a plain object, and has `"type": "object"` at the root.
Validate output schemas too. Declare the dialect when using older syntax, or migrate to 2020-12.

Bundle referenced definitions into the schema that uses them. An identical `$id` in another tool,
another field, or a previous audit is **not** a supplied dependency. Same-document `$defs`, relative
resource IDs and recursive local references work. External URLs are never fetched. A missing local
definition is also unchecked because reference compilation could not finish; it still fails CI.

Schema traversal is bounded before compilation, and Ajv reference inlining is disabled to avoid
exponential expansion of repeated reference graphs. The limits are described in
[`safety/unchecked`](safety-unchecked.md). These are structural and compilation checks, not tool
execution, validation of actual returned values, or a proof of support in every client. Unknown
formats are not asserted, custom vocabularies are not implemented, and Ajv's OpenAPI extensions can
still prevent compilation of an otherwise meta-schema-valid schema; that outcome is explicitly unchecked.

See the [synthetic transport replay](../../examples/schema-audit/README.md) and
[retained registry comparison](../../studies/schema-audit/README.md).

## Configuring

Override severity with `"severities": {"schema/invalid": "off"}` (not recommended), or ignore one tool
with `"ignore": ["schema/invalid:<toolName>"]`. Suppressing `safety/unchecked` does not restore an audit's
completeness or score, and any `--fail-on` threshold still rejects an incomplete audit.
