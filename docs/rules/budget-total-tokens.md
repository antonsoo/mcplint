# budget/total-tokens

**Category:** budget · **Default severity:** warning

Fires when the sum of every collected tool's estimated token cost exceeds the total budget: `--total-budget`
(or `totalBudget` in `.mcplintrc.json`), and 16,000 tokens when none is set.

The default is a round number, 8% of a 200,000-token context window. In the 418 servers of the
[registry census](../../studies/registry-census/README.md) the median tool list costs 1,700 tokens (name,
description and input schema, counted with o200k_base), three in four cost 4,322 or fewer, 6.7% cost more than
16,000, and the largest 202,728. For a single server the finding says where it stands: "Heavier than 95% of
whole tool lists in the registry census." Those servers are 418 of the 19,041 a public registry lists, not a
sample of all servers.

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
