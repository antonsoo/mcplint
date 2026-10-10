# Collection coverage and incomplete audits

A clean list and a failed request used to look the same in mcplint. Collection now
travels with the report: each server and list has a status, the number of pages
received, the number of entries received, the number retained for linting, and a
reason when work could not finish. Successfully collected entries are still checked.

The HTML report puts the audit status first. Terminal, Markdown, JSON and SARIF
carry the same evidence. The coverage table scrolls horizontally on small screens
and has a keyboard focus stop. Reports remain self-contained and work offline.

| Status | Meaning | Effect on the audit |
| --- | --- | --- |
| `complete` | The requested list ended normally, or the supplied snapshot was read. | Counts cover the collected data. |
| `incomplete` | A request failed, pagination could not finish, an entry was malformed, or a server could not be started. | `summary.complete` is false; `summary.score` is null. |
| `unsupported` | A capability was not advertised, or the optional resource-template method returned Method Not Found on its first request. | Explicitly outside the collected scope. |
| `disabled` | The config explicitly disabled the server. | Excluded intentionally; not an error. A config containing only disabled servers has no score. |

A high score never labels a report "clean". Completed reports say "No findings" or
"Findings to review" according to the actual findings. The score is a documented
heuristic over retained metadata, not a security certification.

## Failures and partial data

An advertised method failing on its first request is incomplete, even if its error
is Method Not Found. A later request failing retains earlier pages. Repeated
cursors, invalid cursors and missing list arrays are explicit gaps. Empty string
cursors are followed like any other string; only an absent `nextCursor` ends a list.

Malformed objects retain usable fields, with a synthetic name if necessary. Scalar
and null entries cannot become tool/prompt/resource objects. Both cases are counted
and reported; the report gives the index of the first malformed entry, starting at
zero. A retained object can still be malformed, so retained count is not a validity
count. A malformed input schema is also checked by the schema rules.

A config report names every entry, including failed connections, unresolved
placeholders, invalid entries and disabled servers. An all-failed config therefore
produces an inspectable incomplete report instead of a zero-server success.

Server-controlled error messages are not copied into collection records: they can
contain response bodies or credentials. The records name the failed operation and
page, and suggest checking connectivity, authorization and response shape. Config
connection errors are also available in the CLI's stderr progress output.

## Saved files

An empty `tools`, `prompts`, `resources` or `resourceTemplates` array is valid. A
saved `nextCursor` means the snapshot has uncollected pages, so the audit is
incomplete. Present fields with the wrong type are reported even if other lists are
usable. Files without any recognized list or instructions field are rejected.

A saved file is only evidence about its contents. A complete snapshot report does
not mean mcplint contacted a server or proved that every live tool was included.
Missing list fields in saved snapshots are outside that snapshot's scope.

## Bounds and remaining limits

| Work | Bound | Result at the bound |
| --- | --- | --- |
| One live list | 1,000 pages; 100,000 retained raw entries | Incomplete if more pages/entries remain. |
| One live list request | 10 seconds, including progress extensions | Incomplete; prior pages retained. |
| Connection and initialization, per server | 30 seconds by default; `--connect-timeout <ms>` | Single target exits 2; config entry is incomplete and collection proceeds to the next server. |
| One live list operation | 60 seconds for requests across its pages | Incomplete; prior pages retained. |
| One list in a saved file | 100,000 raw entries | Incomplete if entries are omitted. |
| Safety text per input/output schema | 128 levels; 20,000 visited values; 2,000,000 UTF-16 units including keys | `safety/unchecked`; retained text and other tools still checked. |

The schema text walk is iterative and visits strings and keys, including nested
objects and arrays in `default`, `const`, `enum`, `examples`, and custom keywords.
It does not expand `$ref` or fetch referenced URLs. Diagnostic paths longer than
500 characters are shortened; this does not shorten the key's scanned text.

These bounds are not a sandbox or an overall memory/CPU guarantee. File reading and
JSON decoding still read the input into memory. Network response decoding occurs
before the item cap can be applied. The schema compiler, tokenizer and pairwise
naming/description rules have their own costs. Use trusted-size exports and an
external process timeout for hostile or very large servers. mcplint still never
calls tools, reads resource bodies or renders remote icons.

The connection budget covers transport startup, the `initialize` exchange and
the final `notifications/initialized` send. An HTTP fallback uses the remaining
budget; only an HTTP 4xx rejection before successful initialization triggers it.
List collection has its separate limits after the handshake completes. Library
callers can pass `connectTimeoutMs` to `collectHttp`, `collectStdio` or `collectConfig`;
values must be integers from 1 through 2147483647. The default is 30000.
The collector closes its transport on timeout. Scheduling and cleanup add to
elapsed time: a directly spawned process that ignores EOF can take another two
seconds to terminate through the SDK. This is not a deadline for the entire audit
or a guarantee of terminating a server's detached descendants.
[Actual connections, child-process checks and retained reports](../studies/connection-deadlines/README.md).

## CI and library consumers

With `--fail-on error` or `--fail-on warning`, an incomplete audit exits **1**,
even if its diagnostic has been ignored or assigned a lower severity. Suppression
does not change missing evidence into completed work. Without `--fail-on`, reports
remain informational and exit 0. Invalid configuration, unreadable files and fatal
connection/initialization errors for a single target exit **2** before a report.
Config-target connection failures can be recorded, so those follow the report/gate
behavior instead. An intentionally disabled-only config is not a gate failure.

Lint configuration is validated before collection. It must be an object with only
`budget`, `totalBudget`, `severities` and `ignore`. Budgets must be positive safe
integers. Severity values must be `error`, `warning`, `info` or `off`; ignore entries
must be nonempty strings. Invalid settings produce a clear configuration error.

API changes in this unreleased update:

- Collectors add `target.collection: CollectionRecord[]`. Caller-built library
  targets may omit it; reports identify that as caller-supplied metadata.
- `summary.complete` indicates whether collection and checks finished within the
  described scope. It does not assert the absence of findings.
- `summary.score` is `number | null`; null means no whole-target score is available.
- `summary.totalEstimatedTokens` is `number | null`; null means at least one tool
  could not be serialized for estimation. Unknown is never counted as zero.
- JSON exposes `collection`. SARIF puts it in run `properties`, alongside `complete`
  and `score`, and marks `invocations[].executionSuccessful` false for incomplete work.
- Item scoring and report grouping use server/kind/name tuples. The same tool name
  on two servers receives separate quality penalties.

## Reproducing an interrupted collection

The independent JSON-RPC fixture returns one valid tool, then fails page two:

```sh
npm ci
node dist/cli.js stdio --format html --output partial-report.html --fail-on error -- node tests/fixtures/servers/collection-evidence.mjs partial
```

The second command writes the full report and exits 1. `npm run build:site` includes
this synthetic scenario as `site/incomplete.html`, alongside the good and poisoned
fixture reports. The browser tests also render hostile names through a real
Markdown parser to check that they remain literal text rather than images, scripts,
links or table structure.

Collection follows the capability and pagination semantics in the
[MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
and [resource specification](https://modelcontextprotocol.io/specification/2025-11-25/server/resources),
matching the protocol revisions supported by the installed SDK. This change does
not upgrade protocol support to a newer SDK generation.
