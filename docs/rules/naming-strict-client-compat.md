# naming/strict-client-compat

**Category:** naming · **Default severity:** warning

Fires when a tool name passes the MCP spec's tool-name rules (so `naming/invalid-chars` doesn't fire) but would
still be rejected by a stricter client: it contains a dot, or is longer than 64 characters.

## Why it matters

The MCP spec allows dots and names up to 128 characters. Two real clients are stricter:

- Anthropic's Claude API requires `^[a-zA-Z0-9_-]{1,128}$` (no dot) — [Define
  tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools).
- OpenAI function calling requires `^[a-zA-Z0-9_-]{1,64}$` (no dot, 64-character cap) — [Function
  calling](https://developers.openai.com/api/docs/guides/function-calling).

A tool named `reports.export.csv` is perfectly spec-valid, but a bridge that hands MCP tools to either API as-is
will fail to register it. This rule exists to catch that gap before a user finds it the hard way.

## Example

```json
{ "name": "reports.export.csv", "description": "Exports the current report view as a CSV file." }
```

Fix: `"name": "reports_export_csv"` (or `reports_export_csv_v2`, keeping the whole name under 64 characters).

## How to fix

Replace dots with underscores or hyphens, and keep names under 64 characters if the server (or a proxy in
front of it) might ever be bridged into Anthropic- or OpenAI-style tool calling.

## Configuring

Override severity with `"severities": {"naming/strict-client-compat": "off"}`, or ignore a specific name (e.g.
one that's already public API and can't change) with `"ignore":
["naming/strict-client-compat:reports.export.csv"]`.
