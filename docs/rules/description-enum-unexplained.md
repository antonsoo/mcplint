# description/enum-unexplained

**Category:** description · **Default severity:** info

Fires when a parameter's JSON Schema `enum` has 2 or more values, but the parameter's `description` doesn't
mention any of them (case-insensitive substring match).

## Why it matters

When enum members aren't self-explanatory — single letters, codes, abbreviations — the model needs the
description to spell out what each one means. An enum listed with no accompanying prose forces the model to
guess from the literal token alone, which works for `["celsius", "fahrenheit"]` and fails for `["p0", "p1",
"p2", "p3"]`.

## Example

```json
{ "type": "string", "enum": ["p0", "p1", "p2", "p3"] }
```

with no description at all, or a description that never says what `p0`..`p3` mean. Fix:

```json
{
  "type": "string",
  "enum": ["p0", "p1", "p2", "p3"],
  "description": "Priority: \"p0\" (drop everything) through \"p3\" (backlog)."
}
```

## How to fix

Add a description that explains what each enum value means, especially for codes or abbreviations that aren't
self-evident.

## Configuring

Override severity with `"severities": {"description/enum-unexplained": "off"}`, or ignore one tool with
`"ignore": ["description/enum-unexplained:<toolName>"]`.
