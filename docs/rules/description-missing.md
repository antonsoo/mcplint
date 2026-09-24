# description/missing

**Category:** description · **Default severity:** error

Fires when a tool has no `description` field at all, or the field is present but empty/whitespace-only.

## Why it matters

Without a description the model has only the tool name to decide when to call it. Anthropic's own tool-use
documentation calls detailed descriptions "by far the most important factor in tool performance," recommending
at least 3-4 sentences per tool covering what it does, when to use it, what each parameter means, and any
caveats — see [Define
tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#best-practices-for-tool-definitions).
A tool with no description at all gets none of that.

## Example

```json
{ "name": "run", "inputSchema": { "type": "object", "properties": { "cmd": { "type": "string" } } } }
```

Fix: add a `description` explaining what the tool does, when to use it, and what it returns.

## How to fix

Write a description covering what the tool does, when it should (and shouldn't) be used, and what each
parameter means — see `description/too-short` for a length floor.

## Configuring

Override severity with `"severities": {"description/missing": "off"}` (not recommended — this is close to a
correctness bug, not a style nit), or ignore one tool with `"ignore": ["description/missing:<toolName>"]`.
