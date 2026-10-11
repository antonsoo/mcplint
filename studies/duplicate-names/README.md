# Repeated names in one MCP tool list

At source revision `d7bfd75`, the two definitions in [`tools.json`](tools.json)
produce a complete audit with zero findings, a 100/100 heuristic score, and exit
code 0 under `--fail-on error`. Both are called `read_record`, but one requires
`invoice_id` and the other `customer_id`. A caller cannot select a definition by
name. The old collision rule returned early for a single-server audit.

The same failure occurs when a real MCP SDK server returns one definition on
each of two pages. [`before.json`](before.json) and [`after.json`](after.json)
retain the actual CLI outcomes, collection counts and fixture request logs.
No `tools/call` request occurs; the fixture does not execute tools.

| Controlled input | Before collision findings / exit | After collision findings / exit |
| --- | --- | --- |
| One file, different definitions with one name | 0 / 0 | 1 / 1 |
| One file, identical repeated definition | 0 / 0 | 1 / 1 |
| One file, case-sensitive names `read_record` / `READ_RECORD` | 0 / 0 | 0 / 0 |
| One SDK stdio server, duplicate across two pages | 0 / 0 | 1 / 1 |
| Duplicate within one server plus the same name on another server | 1 / 1 | 2 / 1 |

Collection remains complete in these cases: every supplied entry was retained
and checked. Completeness is separate from a finding. The saved duplicate's
score is now 90, and its default error severity causes `--fail-on error` to
exit 1. Scores remain a heuristic, not a safety certification.

## Change and scope

`naming/collision` now reports one within-server finding per repeated name per
server, as well as the existing cross-server collisions. It counts exact,
case-sensitive names and retains all metadata. The collection regression also
puts hidden Unicode in the later duplicate and checks that the safety finding
survives. Distinct tool schemas are retained; there is no first/last entry wins
filter. Severity overrides and name-specific ignores still apply.

The [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names)
recommends unique names within a server. The rule's default error level is this
linter's policy. Cross-server wording now describes the shared name without
claiming that the definitions are identical or that every client shadows them.

## Recorded public definitions

[`corpus.json`](corpus.json) replays 25,799 tool entries from 1,304 cached public
registry server snapshots. Direct occurrence counting independently agrees with
the rule. Five repeated names appear across two snapshots:

| Recorded server | Name | Occurrences | Distinct descriptions | Distinct serialized input schemas |
| --- | --- | ---: | ---: | ---: |
| `emblemai/emblem-mcp` | `getPolyMarketEvents` | 2 | 2 | 1 |
| `emblemai/emblem-mcp` | `getPolyMarketEventsByTag` | 2 | 2 | 1 |
| `emblemai/emblem-mcp` | `getPolyMarketTags` | 2 | 2 | 1 |
| `GigaChatTester/lichess-mcp` | `create_challenge` | 2 | 2 | 2 |
| `GigaChatTester/lichess-mcp` | `send_message` | 2 | 1 | 1 |

These are observations of retained registry responses, **not a live audit of
those servers**. No server in the corpus was connected to. The receipt records
manifest and snapshot hashes. Other naming-rule findings are unchanged across
the entire replay. Schema distinctions above compare serialized metadata, not
logical equivalence of schemas.

## Reports

[`reports.json`](reports.json) records all five CLI formats rejecting the
saved duplicate: JSON, SARIF, Markdown, terminal and HTML. SARIF distinguishes
a successful audit execution from its error finding. The actual CLI-generated
HTML was opened offline in Chromium and Firefox at 1440 and 375 px; the error,
remediation and both tool token bars remain present, with no page errors,
HTTP requests, horizontal page overflow or axe accessibility violations.

The captured [desktop](../../docs/assets/duplicate-names/duplicates-1440.png)
and [phone](../../docs/assets/duplicate-names/duplicates-375.png) screenshots
were opened and inspected. The phone's coverage table scrolls within its
keyboard-accessible region.

## Reproduce

```sh
npm ci
npm run build
node studies/duplicate-names/verify.mjs
```

That runs the saved, paginated and merged cases. To retain a baseline capture,
pass the old built CLI, an output filename and `observe` as arguments. To check
an installed package, pass its absolute CLI path, output filename, `verify`,
and optionally a Node executable path.

```sh
node studies/duplicate-names/reports.mjs dist/cli.js /tmp/duplicate-reports.json
node studies/duplicate-names/corpus.mjs dist /tmp/duplicate-corpus.json /path/to/baseline/dist
```

The browser script requires the project's Chromium and Firefox test engines.
The corpus script additionally needs the separately acquired, ignored caches
from the [registry census](../registry-census/README.md); future downloads may
differ from the recorded hashes. The controlled fixture is committed and needs
no registry download. These changes are in source and are not an npm release.
