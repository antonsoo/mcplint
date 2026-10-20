# schema/enum-type

**Category:** schema · **Default severity:** warning

Finds a local schema node where every `enum` value is excluded by its declared
`type`. This is valid JSON Schema syntax: compilation can succeed even though
none of the offered choices is usable.

```json
{
  "type": "object",
  "properties": {
    "duration": { "type": "number", "enum": ["5", "10"] },
    "isPrivate": { "type": "boolean", "enum": ["true", "false"] }
  }
}
```

For `duration`, a string `"5"` fails `type`, while a number `5` fails `enum`.
Likewise neither a string `"false"` nor a boolean `false` satisfies `isPrivate`.
Because those fields are optional, `{}` can still match the whole schema. The
finding describes the local choices, not a claim that the entire tool is
uncallable. That is why its default severity is warning.

The rule checks both input and output schemas, including supported nested
properties, array items, definitions and positive branches. Locations use
JSON Pointers, with an explicit marker if a very long path is shortened.
Numbers that are mathematically integers match both `integer` and `number`;
booleans do not count as numbers. Type unions and mixed-type enums remain valid
when at least one choice matches. No data is coerced.

The finite enum is the complete candidate set, so proving that each candidate
fails the local type proves an empty intersection. This is a narrow check, not
a general schema satisfiability solver. References are not resolved, regular
expressions are not executed and arbitrary conditional implications are not
inferred. `not` and `if` tests, examples, defaults, enum/const literal objects and
unknown extension data are not inspected as advertised value constraints.
Draft-06/07 `$ref` objects ignore their siblings, which this rule also skips.
Dialect-specific schema positions are respected; unknown dialects and OpenAPI
`nullable` nodes are left to the separate structural/compatibility checks.
Bounds and malformed-evidence handling remain those of the schema audit.

## How to fix

Choose the intended representation: use numeric enum members for a numeric
parameter, booleans for a boolean parameter, or change the declared type when
strings are actually intended. The linter cannot decide which representation
the tool implementation expects and does not rewrite the schema.

Do not infer a runtime privacy or generation failure from metadata alone. The
[retained native example](https://github.com/antonsoo/mcplint/tree/main/studies/finite-choices) records four
such contradictions in three public registry definitions. Independent
validators reject every offered value, but no generation tool was called.

To gate on this warning, use `--fail-on warning` or configure
`"severities": {"schema/enum-type": "error"}`. An intentional empty value
domain can be ignored for a specific tool with
`"ignore": ["schema/enum-type:<toolName>"]`.

The JSON Schema references for [type](https://json-schema.org/understanding-json-schema/reference/type)
and [enum](https://json-schema.org/understanding-json-schema/reference/enum)
describe the independent assertions and their strict JSON types.
