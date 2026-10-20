# Audit native catalogs without repeating fixed work

The retained public `pipeworx/gateway` catalog contains 2,530 tools. The old
CLI repeatedly compiled the same official JSON Schema validators as its
bounded user compiler was replaced, and tokenized every tool separately for
two budget rules and the summary. Both operations repeated work without
adding evidence.

The new source keeps one fixed official meta-schema validator per supported
dialect. User schemas are never registered or compiled in those instances.
User compilers still include the same built-in resources, remove every user
resource after each attempt, and are replaced after 32 compilations. A separate
WeakMap shares successful tool-token counts within one synchronous `lint()`
call. It retains counts, not serialized descriptions, and is discarded between
audits. Reusing and editing a library tool cannot reuse its previous count.

## Measured CLI behavior

Five fresh Node 24.22.0 CLI processes per variant and catalog, with order
rotated between samples. Each reads the same unchanged native definitions,
writes a JSON report and exits 1 because the catalogs contain warnings.
These are medians of all five samples, not selected best runs:

| Retained catalog | Tools | Before | Shared meta-schemas only | Combined change |
| --- | ---: | ---: | ---: | ---: |
| `pipeworx/gateway` | 2,530 | 3.808s | 3.068s | 2.730s |
| `bitquery/bitquery-mcp` | 314 | 2.538s | 2.312s | 1.977s |

The combined change reduces median elapsed time by 28.3% and 22.1% in these
measurements. Median peak process RSS, measured by GNU time:

| Retained catalog | Before | Shared meta-schemas only | Combined change |
| --- | ---: | ---: | ---: |
| gateway | 366.7 MiB | 350.4 MiB | 347.8 MiB |
| Bitquery | 271.1 MiB | 296.4 MiB | 232.4 MiB |

The meta-schema-only variant uses more peak memory on Bitquery here; the
combined change reduces measured peak RSS on both. This is not a general
memory bound or a speed guarantee. The machine is WSL2 on a Ryzen 7 7800X3D,
14 available CPUs and about 47 GiB RAM. Processes ran sequentially, with
default Node options. Filesystem caches were not flushed; host load and
garbage collection vary. Full samples, CPU times, RSS, environment and all
compiled-module hashes are retained in [benchmark.json](benchmark.json).
The [dependency record](dependencies.json) identifies the actual installed
Ajv, tokenizer, SDK, TypeScript and lockfile.

## Same audits

Every one of the 30 measured reports compares exactly after removing only
`generatedAt`. The gateway retains 1,518 findings and a 202,728-token estimate;
Bitquery retains 568 findings and a 317,569-token estimate. These token counts
are the existing o200k_base estimates, not provider measurements.

The [full census comparison](corpus.json.gz) checks **1,304 servers and 25,799
tools**, with zero skipped records. Complete audit objects compare exactly,
including findings, severities, collection evidence, summaries and token
estimates, apart from `generatedAt`. No rule is skipped and no warning is
suppressed for the optimization. Incomplete audits remain incomplete.

The regression checks also retain built-in meta-schema references beyond
compiler replacement boundaries, resource isolation after failed compilation,
and fresh budget estimates when a library caller edits a reused tool between
audits. This changes computation reuse, not the advertised audit scope.

## Inputs and replay

`captures/` contains the complete original tool definitions from the two
retained Smithery census responses, compressed without changing any entry.
Only their enclosing registry fields are omitted. `provenance.json` records
original response hashes, extracted-byte hashes, endpoints and the
third-party notice. This is a historical metadata replay; no vendor server
is launched and no tool is called.

Baseline source: `dd2c625aef078a237703e2255da4b489d8f609c9`. Build it in a
separate checkout with its locked dependencies. `benchmark.json` retains the
exact JavaScript module identities for the intermediate meta-schema-only
ablation too. With the corresponding three built CLIs:

```sh
node studies/audit-throughput/benchmark.mjs /path/to/before/dist/cli.js /path/to/meta-only/dist/cli.js dist/cli.js /tmp/audit-benchmark.json
node studies/audit-throughput/corpus.mjs /path/to/before/dist/index.js dist/index.js /tmp/audit-corpus.json.gz
```

Use Node 24 and GNU time for the benchmark. The full census comparison
additionally needs the existing `studies/registry-census/cache/` captures.
The two timed catalogs are bundled and can be replayed without that cache.
Source, installed-package and public-source verification are distinct from
the unchanged npm release and previously rendered hosted reports.

## Clean source and installed CLI

[Installation verification](installation.json) records a fresh Node 24 locked
install, lint/types, all 661 checks in both tested locales, all 32 existing
browser cases, and a separate packed-package consumer. All 130 installed
payload files equal the tarball. Native SDK metadata replay retains the
enum/type warning gate on [Node 24](installed-sdk-24.json) and the supported
[Node 20 floor](installed-sdk-20.json), with zero tool calls.

[Installed native-catalog checks](installed-native.json) compare both full
catalog reports on both Node versions with the benchmark's exact report
hashes. Every installed runtime module also matches the measured build.
These checks do not publish an npm version or rerender the hosted static
reports; their existing findings remain unchanged.
