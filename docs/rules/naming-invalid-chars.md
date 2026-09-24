# naming/invalid-chars

**Category:** naming · **Default severity:** error

Fires when a tool name is empty, longer than 128 characters, or contains a character outside `A-Z a-z 0-9 _ - .`

## Why it matters

The MCP spec's [Tool Names](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names)
section (2026-07-28) says tool names **SHOULD** be 1-128 characters, case-sensitive, and restricted to that
charset, with no spaces, commas, or other special characters. It's a SHOULD, not a MUST, but a name outside it
is likely to be rejected or mangled by real clients — worth treating as an error, not a suggestion.

## Example

```json
{ "name": "run tool!", "description": "..." }
```

The space and `!` are both outside the allowed charset. Fix: `"name": "run_tool"`.

## How to fix

Restrict tool names to letters, digits, underscore, hyphen, and dot, and keep them under 128 characters.
`naming/strict-client-compat` covers the (stricter) subset of that charset that Anthropic and OpenAI actually
enforce.

## Configuring

Override severity with `"severities": {"naming/invalid-chars": "off"}` in `.mcplintrc.json`, or ignore it for
one tool with `"ignore": ["naming/invalid-chars:<toolName>"]`.
