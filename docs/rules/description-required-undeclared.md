# description/required-undeclared

**Category:** description · **Default severity:** error

Fires when `inputSchema.required` lists a parameter name that has no matching entry in
`inputSchema.properties`.

## Why it matters

A required parameter with no property definition can't be validated (no type, no description) or explained to
the model. Most clients will either drop the tool entirely or send a call missing that "required" field,
which the server then has to reject — the tool is effectively broken as declared, not just poorly documented.

## Example

```json
{
  "type": "object",
  "properties": {
    "artifact_id": { "type": "string" },
    "environment": { "type": "string" }
  },
  "required": ["artifact_id", "region"]
}
```

`"region"` is required but never declared in `properties`. Fix: either add a `region` property, or remove it
from `required` if it isn't actually needed.

## How to fix

Make sure every name in `required` has a corresponding entry in `properties` — this is usually a copy-paste or
refactor mistake (a parameter renamed in one place and not the other).

## Configuring

Override severity with `"severities": {"description/required-undeclared": "off"}` (not recommended — this
usually indicates a genuinely broken schema), or ignore one tool with `"ignore":
["description/required-undeclared:<toolName>"]`.
