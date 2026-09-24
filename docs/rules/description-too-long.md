# description/too-long

**Category:** description · **Default severity:** info

Fires when a tool's description exceeds 1200 characters.

## Why it matters

Past a few sentences, additional prose in a tool description has diminishing returns for tool *selection* (the
model deciding whether to call it) while still costing real tokens on every request. Long usage guides, worked
examples, and edge-case documentation belong in a resource the tool can reference, not inline in the
description that's injected into context every single turn. This is the lowest-severity description rule (info)
— a long description is a cost/efficiency nit, not a correctness problem the way a missing one is.

## Example

A 2000-character description containing five worked examples and a troubleshooting section trips this rule.
Fix: keep the description to what a model needs to decide whether and how to call the tool; move the examples
to a linked resource or the server's own docs.

## How to fix

Cut the description down to what's needed for selection and correct use; move deep usage guidance elsewhere.
Check `budget/tool-tokens` too — a description this long is usually also over the per-tool token budget.

## Configuring

Override severity with `"severities": {"description/too-long": "off"}` (this is what
[`examples/mcplintrc.example.json`](../../examples/mcplintrc.example.json) does), or ignore one tool with
`"ignore": ["description/too-long:<toolName>"]`.
