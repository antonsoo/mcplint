# schema/portability

**Category:** schema · **Default severity:** info

Fires on two specific, cited constructs that are spec-valid but handled inconsistently by some clients:
optional properties without `additionalProperties: false`, and `$ref` pointers to an external (non-`#/...`)
location.

## Why it matters

These are not spec violations — mcplint phrases them as portability suggestions, not errors, precisely because
they're valid JSON Schema and valid MCP. They are documented gaps in *specific* client implementations:

- OpenAI's Structured Outputs / strict function calling mode requires every property to be listed in `required`
  and `additionalProperties: false` — see [Structured
  Outputs](https://platform.openai.com/docs/guides/structured-outputs). A schema with genuinely optional fields
  needs translation before it works in strict mode there.
- Many client implementations only resolve local (`#/...`) `$ref` pointers; an external ref may silently fail to
  resolve in some clients, even though `$ref` resolution is otherwise unrestricted in JSON Schema.

## Example

```json
{
  "type": "object",
  "properties": { "artifact_id": { "type": "string" }, "environment": { "type": "string" } },
  "required": ["artifact_id"]
}
```

`environment` is optional and `additionalProperties` isn't `false` — fine for MCP, would need adjustment for
OpenAI strict mode.

## How to fix

If you need OpenAI strict-mode compatibility, either make every property required or generate a separate strict
variant of the schema. For external `$ref`s, inline the referenced schema or convert it to a local `#/...`
pointer if broad client support matters more than DRY schema authoring.

## Configuring

Override severity with `"severities": {"schema/portability": "off"}` — reasonable if you don't target OpenAI's
strict mode at all, which is what
[`examples/mcplintrc.example.json`](../../examples/mcplintrc.example.json) does via `"ignore":
["schema/portability"]`.
