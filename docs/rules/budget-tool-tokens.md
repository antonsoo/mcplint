# budget/tool-tokens

**Category:** budget · **Default severity:** warning

Fires when a single tool's serialized definition — `{name, description, inputSchema, outputSchema,
annotations}` as JSON — costs more estimated tokens than the configured budget (default 550).

The default is the 90th percentile of the 11,545 tool definitions in the [registry census](../../studies/registry-census/README.md): the median real tool costs
133 tokens, three in four cost 261 or fewer, one in ten more than 549. A finding at or beyond that point says
where the tool stands: "Heavier than 95% of tool definitions on the most-used public servers."

## Why it matters

Every tool definition is re-sent to the model on every turn, whether or not it gets called. A tool that alone
costs hundreds of tokens is usually over-described: verbose prose, a flattened schema with redundant nested
objects, or an enum list that could be shortened. Trimming it back buys context the model could spend on the
actual conversation instead. Token counts are estimates using the o200k_base tokenizer (see the README's "How
it works" section) — treat them as directional, not exact, for any specific model.

## Example

```json
{
  "name": "search_knowledge_base",
  "description": "Searches the knowledge base. <500+ more words of usage examples, edge cases, and caveats...>",
  "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } } }
}
```

Fix: move the usage examples and edge-case notes into a resource the tool can point to, and keep the
description to what's needed for tool *selection* (what it does, when to use it).

## How to fix

Shorten the description to a few sentences, flatten unnecessarily nested schema objects, and shorten long enum
lists (or move rarely-needed enum values behind a follow-up parameter).

## Configuring

Set the threshold with `--budget <n>` or `"budget"` in `.mcplintrc.json`. Override this rule's severity with
`"severities": {"budget/tool-tokens": "off"}`, or ignore it for one tool with `"ignore":
["budget/tool-tokens:<toolName>"]`.
