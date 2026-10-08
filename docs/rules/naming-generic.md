# naming/generic

**Category:** naming · **Default severity:** warning

Fires when **every** `_`/`-`/`.`-delimited word of a tool's name is on a list of generic words — `run`,
`execute`, `exec`, `query`, `do`, `process`, `handle`, `call`, `invoke`, `action`, `perform`, `task`, `go`,
`main`, `operation`, `op`, `command`, `cmd`, `tool`, `helper`, `util`, `misc`, `generic`, `request`, `submit`,
`use`: `query`, `run_action`, `use_tool`.

One specific word is enough to say what a tool is for. An earlier version also flagged a generic last word
in a two-word name; on the [registry census](../../studies/registry-census/README.md) that made 81 findings,
`create_task`, `overpass_query` and `distance_tool` among them, where this rule makes 8.

## Why it matters

A name like `run` or `query` gives the model no signal about what the tool actually does, and collides
semantically with tools from other servers exposing the same generic verb. It forces the model to rely entirely
on the description — which it may truncate, under-weight, or not read carefully — to disambiguate what should
have been obvious from the name.

## Example

```json
{ "name": "run", "description": "Runs the requested operation." }
```

Fix: name it after the resource or effect instead — `list_widgets`, not `query`; `deploy_service`, not `run`.

## How to fix

Rename the tool after the noun it acts on and the verb describing the effect (`create_x`, `list_x`,
`delete_x`), not a content-free action word.

## Configuring

Override severity with `"severities": {"naming/generic": "error"}` (tighten it) or `"off"`, or ignore a specific
tool with `"ignore": ["naming/generic:<toolName>"]`.
