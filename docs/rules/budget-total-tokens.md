# budget/total-tokens

**Category:** budget · **Default severity:** warning

Fires when the sum of every collected tool's estimated token cost exceeds a configured total budget. Unlike
every other rule, this one is opt-in: it only runs when `--total-budget` (or `totalBudget` in
`.mcplintrc.json`) is set, because there's no sensible universal default for "how many tools is too many."

## Why it matters

Most clients inject the entire tool list on every request, so the per-tool cost from `budget/tool-tokens`
compounds across the whole server. A server with thirty reasonably-sized tools can still blow a context budget
even if no single tool trips the per-tool rule. This rule catches that aggregate case — useful when deciding
whether a server (or a `config` run combining several servers) is worth the context it costs before every
conversation even starts.

## Example

Thirty tools at ~150 tokens each is ~4500 tokens spent before a single message is sent — run
`mcplint config .mcp.json --total-budget 3000` to catch that.

## How to fix

Split the server into a smaller "core" server plus an opt-in extension, gate rarely-used tools behind a
discovery/dispatch tool instead of listing them all individually, or cut the tools that show up in the CLI's
"top offenders" list.

## Configuring

Set with `--total-budget <n>` or `"totalBudget"` in `.mcplintrc.json` (omit either and this rule never runs).
Override severity with `"severities": {"budget/total-tokens": "off"}`.
