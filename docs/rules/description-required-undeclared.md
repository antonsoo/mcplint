# description/required-undeclared

**Category:** description. **Default severity:** warning; error for a simple closed-schema contradiction.

In a simple input schema, this rule looks for `required` names without a corresponding
entry in `properties`. An open schema may validly require such a name: the warning
asks whether its type and usage need documenting. It does not claim clients reject
the tool or that the schema is malformed.

When that same simple schema sets `additionalProperties: false`, the required name
is forbidden. No object can satisfy both constraints, so this case remains an error.

## Example

```json
{
  "type": "object",
  "properties": { "artifact_id": { "type": "string" } },
  "required": ["artifact_id", "region"]
}
```

This is a valid schema that accepts `{"artifact_id":"a", "region":"us"}`. It gets
a documentation warning for `region`. Adding `additionalProperties: false` makes
it contradictory and raises the severity to error. Add a `region` definition,
or remove it from `required` if it is optional.

## Composed schemas and limits

JSON Schema does not require `required` names to appear in local `properties`.
The [object reference](https://json-schema.org/understanding-json-schema/reference/object)
and [combining reference](https://json-schema.org/understanding-json-schema/reference/combining)
explain these independent constraints.

This rule declines its local-name inference when the root has references,
`allOf`, `anyOf`, `oneOf`, conditionals, dependencies, nonempty `patternProperties`,
or a schema-valued `additionalProperties`/`unevaluatedProperties`. Those constructs
may supply definitions elsewhere. It does not resolve references, execute untrusted
regular expressions, determine branch reachability, or prove general schema
satisfiability. Unreferenced definitions and properties of nested objects do not
count as definitions of root parameters. Schema compilation remains a separate rule.

For example, this correctly produces no required-property finding:

```json
{
  "type": "object",
  "required": ["region"],
  "allOf": [{ "properties": { "region": { "type": "string" } } }]
}
```

[Before/after CLI and independent-validator evidence](../../studies/required-properties/README.md).

## Configuring

`--fail-on error` permits the open-schema warning; `--fail-on warning` fails on it.
An explicit `"severities": {"description/required-undeclared":"error"}` still promotes
warnings to errors. `"off"` disables the rule, or use
`"ignore": ["description/required-undeclared:<toolName>"]` for one tool.
