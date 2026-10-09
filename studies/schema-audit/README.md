# Independent schema checks on retained MCP metadata

On 9 October 2026, the schema rule was replayed against the registry snapshots already retained by
[`registry-census`](../registry-census/README.md). No listed server was started or contacted. The
baseline is local commit `b1438c0`; this is a local implementation comparison, not a released-version
or current-server audit.

The change adds output-schema validation and isolates each schema's resources. It also uses declared
dialects and separates definite meta-schema errors from unfinished compilation/reference checks.

| Retained sample | Servers | Tools | Supplied output schemas | Previously unreported output findings |
|---|---:|---:|---:|---:|
| Original registry-census sample | 418 | 11,545 | 3,670 | 71 |
| Second registry-census sample | 886 | 14,254 | 5,385 | 130 |
| Total | 1,304 | 25,799 | 9,055 | 201 |

The 201 output findings affect 30 servers' **snapshots**: 19 malformed schemas and 182 references
whose local definitions are absent. The original input findings also contained 103 missing local
definitions, one malformed schema, and one schema that Ajv could not compile despite accepting its
meta-schema. All attack, description, naming, budget and portability findings remain unchanged on
these snapshots. The complete changed findings, source hashes and manifest hashes are in
[`corpus-results.json`](corpus-results.json).

The second sample was held out from the earlier attack-rule calibration, not from this implementation's
review. Both samples were inspected during this schema work. Neither is a representative random sample
of all MCP servers. A registry may transform or omit metadata; these findings do not establish that the
original servers currently return the same schemas.

## Independent checks

[`compare.py`](compare.py) checked every resulting schema finding using Python `jsonschema` 4.10.3
and direct JSON Pointer traversal, independently of Ajv:

| Check | Confirmed |
|---|---:|
| Meta-schema rejection of malformed input/output schemas | 20 |
| Local reference target absent from supplied schema | 285 |
| Meta-schema-valid schema rejected by Ajv compilation | 1 |

All observed unresolved references were local JSON Pointers. The script decodes their URI fragments
and `~0`/`~1` escapes and checks the supplied document. It asserts that other rules' findings did not
change. It does not prove the absence of other schema problems or validate actual tool results.

Two small, unmodified output-schema excerpts are retained in
[`registry-excerpts.json`](registry-excerpts.json), with source URLs and SHA-256 hashes of the full
downloaded registry records:

- The `mapbox` snapshot's `bbox_tool` uses an array of tuple schemas in `items`, but declares no dialect.
  That syntax fails the default 2020-12 meta-schema. A server can migrate to `prefixItems` or explicitly
  declare an older compatible dialect.
- The `adamamer20/paper-search-mcp-openai` snapshot's `search` references `#/$defs/TextContent` and four
  other content types without supplying `$defs`. A consumer of this saved schema cannot resolve them.

The `receiptor-ai/receiptor-mcp` snapshot supplied a `nullable` extension without `type`. Ajv's OpenAPI
handling rejects it, but the JSON Schema meta-schema permits that extension. It is now reported as
an unfinished compiler check, rather than a proven JSON Schema error.

## Controlled reproductions

[`examples/schema-audit`](../../examples/schema-audit/README.md) contains synthetic invoice fixtures
and a replay that runs a built or installed CLI over files, stdio and loopback HTTP. It records the
actual request methods and also performs repeated library calls in one process.

| Scenario | `b1438c0` | Updated implementation |
|---|---|---|
| Second audit of the identical `$id` | False invalid-schema error; score 90 | Same valid result; score 100 |
| External reference after an unrelated earlier audit | No schema finding; audit complete | Unresolved reference; audit incomplete |
| Malformed output type | Exit 0 with `--fail-on error` | Exit 1, output schema identified |
| Valid draft-07 tuple | Invalid under forced 2020-12 | Accepted under draft-07 |
| Identical `$id` in separate tools | Later tool rejected | Each schema checked independently |
| Unresolved output reference with diagnostic suppressed | Exit 0 | Exit 1; score unavailable |

Before/after observations are retained alongside this document. Unit regressions additionally cover
nested resource IDs left by failed compilations, URI aliases, cyclic/oversized metadata, recursive
local references, non-object output values, and a 24-level repeated-reference diamond. These fixtures
are synthetic and establish behavior, not a prevalence estimate.

## Reproduction

The synthetic replay needs no registry cache:

```sh
npm ci
node examples/schema-audit/replay.mjs dist/cli.js /tmp/mcplint-schema-replay --verify
```

The full corpus comparison requires the exact ignored `registry-census/cache/servers` and `heldout`
downloads used here. The two tracked manifests and per-record hashes identify them. Re-downloading
the registry today may produce different records. With the baseline built separately, run from this
checkout, replacing `/path/to/before/dist/index.js` with that build:

```sh
node studies/registry-census/census.mjs --label schemas-before --lib /path/to/before/dist/index.js
node studies/registry-census/census.mjs --label schemas-before-heldout --manifest manifest-heldout.json --servers heldout --lib /path/to/before/dist/index.js
node studies/registry-census/census.mjs --label schemas-after
node studies/registry-census/census.mjs --label schemas-after-heldout --manifest manifest-heldout.json --servers heldout
python3 studies/schema-audit/compare.py
```

`compare.py` requires Python's `jsonschema` package. The replay and benchmark scripts accept paths to
both checkout builds and installed packages, so package contents and dependency resolution can be
verified separately from source tests.

## Measured cost and retention

These are single sequential runs on this machine (WSL2 Linux, 14 vCPU, 48 GB RAM, Node 26.7.0), not
portable performance guarantees. [`benchmark.mjs`](benchmark.mjs) runs the schema rule alone on the
retained corpus in a fresh process, then yields and forces three garbage collections before measuring
retained heap. It includes reading the cached JSON; it excludes tokenization and the other rules.

| Corpus run | `b1438c0` | Updated implementation |
|---|---:|---:|
| Time | 10.29 s | 25.11 s |
| Retained heap after GC | 208.9 MiB | 165.6 MiB |
| Peak sampled RSS | 675.8 MiB | 703.9 MiB |
| Schema findings | 105 | 306 |

The updated run also validates 9,055 supplied output schemas, performs bounded preflight traversal,
and periodically recompiles trusted meta-schemas. It is slower on this bulk check. Input/output
validation is roughly one millisecond per tool here; other rules and collection add their own cost.

[`soak.mjs`](soak.mjs) isolates long-lived cache behavior with equal work: 5,000 distinct synthetic
input schemas, each with 20 string properties, sampled after every 500 schemas. Both versions accept
every schema. The baseline heap grows from 33.1 to 91.4 MiB; the updated implementation stays between
34.2 and 35.4 MiB at the post-warm-up samples and ends at 34.2 MiB. This is evidence against the
previous accumulation pattern, not a bound on all possible inputs. Raw benchmark and soak results
are retained as JSON alongside this document.

```sh
node --expose-gc studies/schema-audit/benchmark.mjs dist/index.js /tmp/mcplint-schema-benchmark.json
node --expose-gc studies/schema-audit/soak.mjs dist/index.js /tmp/mcplint-schema-soak.json
```

## Limits

This implementation supports draft-06, draft-07, 2019-09 and 2020-12. Unsupported or mixed dialects,
missing references and compiler limits produce `safety/unchecked`; suppression cannot make the audit
complete. It does not implement custom vocabularies or format assertions, fetch reference URLs, call
tools, or validate actual returned values. Meta-schema validity is not a proof of client compatibility.

Traversal has the existing 128-level, 20,000-value and 2,000,000-text-unit limits before compilation.
Reference inlining is disabled. Ajv resource registrations are cleared after each schema, including
failures, and instances are recycled after 32 checks to release code-generation bookkeeping. These
are bounded-input checks, not a hard execution-time or process-memory guarantee.

The dialect and output decisions follow the primary
[MCP JSON Schema usage rules](https://modelcontextprotocol.io/specification/2026-07-28/basic#json-schema-usage)
and [tool type definition](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts).
The transport replay uses the installed SDK's `2025-11-25` protocol contract; it does not establish
full support for the newer transport protocol.
