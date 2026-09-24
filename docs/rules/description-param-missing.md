# description/param-missing

**Category:** description · **Default severity:** warning

Fires once per `inputSchema.properties` entry that has no `description` field (or an empty one).

## Why it matters

The model has only the parameter's name and JSON type to decide what value to pass. That's enough for something
truly self-explanatory (`query: string` on a search tool), but not for anything where the name is ambiguous, the
expected format matters (a date string, an id with a specific prefix), or the valid range/units aren't obvious.

## Example

```json
{
  "type": "object",
  "properties": {
    "ticket_id": { "type": "string" },
    "level": { "type": "string", "enum": ["p0", "p1", "p2", "p3"] }
  },
  "required": ["ticket_id", "level"]
}
```

Fix: `"ticket_id": { "type": "string", "description": "The ticket id, e.g. \"TICK-1234\"." }` (and see
`description/enum-unexplained` for `level`).

## How to fix

Add a one-sentence `description` to every parameter: what it means, expected format, and units if relevant.

## Configuring

Override severity with `"severities": {"description/param-missing": "off"}`, or ignore one tool's parameters
with `"ignore": ["description/param-missing:<toolName>"]`.
