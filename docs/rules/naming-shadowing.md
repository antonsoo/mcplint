# naming/shadowing

**Category:** naming · **Default severity:** warning

Fires when two tools from *different* servers in the same run have names that are Levenshtein edit-distance
&le; 2 apart (and at most 30% of the longer name's length), for names of at least 5 characters. Like
`naming/collision`, this only fires across servers — a single-server run has nothing to compare against.

## Why it matters

A one- or two-character difference between tool names from different servers (`search` vs `search_`, or
`get_user` vs `get_users`) is easy for a human reviewer to miss and easy for a model to call the wrong one,
especially once descriptions get truncated under token pressure. Unlike `naming/collision`, this catches
*near*-matches, not just exact ones.

## Example

Server A exposes `fetch_invoice`; server B exposes `fetch_invoices`. Edit distance 1, both names 13-14
characters — `naming/shadowing` reports it as a likely source of confusion even though neither name is wrong on
its own.

## How to fix

Rename one of the two tools to be clearly distinct, or namespace both by server (as with `naming/collision`).

## Configuring

Override severity with `"severities": {"naming/shadowing": "off"}`, or ignore one side of a specific pair with
`"ignore": ["naming/shadowing:<toolName>"]`.
