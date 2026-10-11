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

## Calculation and limits

The source checkout computes exact edit distances through two edits with two five-cell
rows, stopping once no qualifying path remains. Longer distances are represented only as
"more than two"; they never qualify for this rule. Matching prefixes and suffixes are
removed before that calculation. Names are still lowercased and measured in JavaScript
UTF-16 code units; this change does not add Unicode normalization. Case-only differences
continue to produce no shadowing finding.

The calculation uses constant scratch memory and at most linear work per name pair.
The number of pairs across a large catalogue is still quadratic; this is not a deadline
or a memory bound for the entire audit. Invalid names are still inspected and reported
by the other rules. See the [retained SDK reproduction](../../studies/name-comparisons/README.md).

## Configuring

Override severity with `"severities": {"naming/shadowing": "off"}`, or ignore one side of a specific pair with
`"ignore": ["naming/shadowing:<toolName>"]`.
