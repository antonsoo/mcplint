# budget/total-tokens

**Category:** budget · **Default severity:** warning

Fires when the sum of every collected tool's estimated token cost exceeds the total budget: `--total-budget`
(or `totalBudget` in `.mcplintrc.json`), and 16,000 tokens when none is set.

The default is the 90th percentile of the 418 servers in the [registry census](../../studies/registry-census/README.md): the median server's tool list costs
2,403 tokens, three in four cost 6,340 or fewer, one in ten more than 16,336, and the largest 202,728. For
a single server the finding says where it stands: "Heavier than 95% of whole tool lists on the most-used
public servers."

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
