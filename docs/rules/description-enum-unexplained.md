# description/enum-unexplained

**Category:** description · **Default severity:** info

Fires when a parameter's JSON Schema `enum` has 2 or more **scalar** values,
but the parameter's `description` does not mention any of them. A mention is
a lexical clue, not proof that the description explains the choice well.

- Nonempty strings use the existing case-insensitive substring check.
- Finite numbers match whole numeric spellings: `1` does not match `10`, `-1`,
  `1.5`, `1e3`, or `v1`; a choice of `1000` can be mentioned as `1e3`.
- Booleans and null match complete `true`, `false`, and `null` words.
- An empty string needs `""`, `''`, or the phrase `empty string`. Whitespace-only
  choices need their quoted JSON spelling. Empty strings and ordinary prose
  spaces cannot automatically suppress the finding.

Enums containing objects or arrays are outside this prose-mention heuristic.
Their JSON Schema validation, missing-description and safety checks still run.
JSON Schema allows these choices; a `toString` data key is not a method to call.
See the [controlled SDK/CLI study](../../studies/enum-values/README.md).

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
