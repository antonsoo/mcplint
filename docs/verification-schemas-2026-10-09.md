# Schema validation verification, 9 October 2026

Local work only. No package, repository or site was published. The package version remains 0.3.3;
the tested tarball is a local build containing the unreleased changes.

## What changed

`schema/invalid` now checks input and supplied output schemas independently, using the declared
draft-06, draft-07, 2019-09 or 2020-12 dialect. Every field gets a fresh resource namespace, including
after failed compilation. Unsupported dialects, unresolved references and compiler limits leave the
audit incomplete. Suppressing their diagnostic does not restore a score or a successful CI gate.

The [retained corpus comparison](../studies/schema-audit/README.md) covers 25,799 tools and 9,055
output schemas from 1,304 previously downloaded registry records. It adds 201 output-schema findings.
Independent Python meta-schema checks and direct JSON Pointer traversal cover every resulting schema
finding. These are observations about the retained metadata, not current remote-server behavior.

## Checks run

| Check | Result |
|---|---|
| Fresh `npm ci` from the lockfile | Completed; MCP SDK 1.31.0, Ajv 8.20.0 |
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm test` | 337 passed across 29 files |
| `npm run build` | Completed |
| `UPDATE_SCHEMA_SCREENSHOTS=1 npm run test:browser` | 24 passed, Chromium and Firefox |
| Final focused schema browser replay after fixture descriptions were clarified | 4 passed |
| Packed tarball installed in a fresh directory, lifecycle scripts disabled | Completed; MCP SDK 1.32.1, Ajv 8.20.0 |
| Installed package replay, Node 26.7.0 | 12 file/stdio/HTTP workflows, four report formats, suppression and repeated-library checks passed |
| Same installed package replay, Node 20.0.0 | Same checks passed |
| All four supported dialects through the installed library | Passed on both Node versions |
| Registry replay and independent checks | All 1,304 records read; 20 malformed schemas, 285 absent local pointers and one compiler limitation confirmed |
| 5,000-schema same-process soak | All schemas accepted; retained heap stayed around 34-35 MiB after warm-up |

The lockfile and fresh installed dependency sets exercise different SDK versions. The tarball
SHA-256 is `ccda0b0eb9ac643b14b88e2ebda27f340498472215e41e863c582b66b95f41d5`.
The [portable replay script](../examples/schema-audit/replay.mjs) accepts an installed
`dist/cli.js` path and retains observations plus actual JSON-RPC request logs. All transport
fixtures received only initialization and tool-list requests; none received `tools/call`.

The built static site is generated with `npm run build:site` into `site/`. It was built and
checked locally; nothing was deployed.

## Visible result

The existing report UI is unchanged. At 1440 and 375 pixels it distinguishes complete collection
from an incomplete schema audit, shows an unavailable score, and names both the malformed output
and unresolved output reference. The screenshots below were opened and inspected: no document
overflow or clipped finding text; the coverage table keeps its existing horizontal scroll on phones.
Offline browser checks made no network requests and reported no page errors or axe violations.

- [Desktop report](assets/schema-audit-1440.png)
- [Phone report](assets/schema-audit-375.png)

## Limits and cost

The fixtures are synthetic and the registry snapshots can differ from current servers. This is
metadata inspection, not a tool-execution or security guarantee. Unknown formats and custom
vocabularies are not validated; mixed dialect resources are explicitly unsupported. Compiler
limitations remain visible even when a schema passes its meta-schema.

The schema-only corpus run takes 25.11 seconds versus the baseline's 10.29 seconds on this machine,
including the added output checks. Measured memory and the separate equal-work soak are retained in
the [study](../studies/schema-audit/README.md#measured-cost-and-retention). Traversal limits and
periodic compiler replacement are not a hard process-memory or wall-clock limit.
