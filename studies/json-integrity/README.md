# Saved metadata must not change before it is compared

Baseline `d5d3940ac60579ab02f2ba260e28400d14f45627` captured two different
integer constraints as the same number. A saved tool with account-ID maximum
`9007199254740992`, and another with maximum `9007199254740993`, both produced
snapshots containing `9007199254740992`. `mcplint diff` then exited 0 with two
unchanged records. Neither capture diagnosed the changed input.

```text
Saved JSON maximum 9007199254740992 -> snapshot 9007199254740992 --+
                                                               +-> unchanged (exit 0)
Saved JSON maximum 9007199254740993 -> snapshot 9007199254740992 --+

Corrected second capture -> explicit unsupported-number error (exit 2)
                         -> no new snapshot; earlier report preserved
```

A second input ambiguity discarded entire definitions: repeated object fields
were reduced to the last value before auditing. Escaped names such as `name`
and `\u006eame` are the same field. This differs from repeated tool identities
in an array, which remain separate records and keep their existing warnings.

The source checkout now checks raw saved inventories and imported snapshots
before using their decoded content. Native JSON parsing still validates syntax.
An iterative scan tracks keys separately for each object and bounds nesting;
number tokens must survive decimal serialization without changing value.
Equivalent spellings (`100.0`, `1e2`) are accepted. This is a metadata preservation
policy, not a new JSON number format or arbitrary-precision arithmetic engine.
[RFC 8259 sections 4 and 6](https://www.rfc-editor.org/rfc/rfc8259) describe the
interoperability problems of duplicate names and differing numeric precision.

## Actual capture and comparison workflows

[Before](results/before.json) and [after](results/after.json) retain **33 cases**
through the actual CLI, including six HTML exports: 39 CLI invocations per
version. All definitions and deliberate faults are synthetic. Each case starts
with an existing report whose bytes must survive a refusal. Inputs, full reports
and snapshots remain in the replay's work directory. The receipt omits only
`generatedAt` from audit objects and `createdAt` from newly captured snapshots;
diff inputs use fixed timestamps and require no report normalization.

| Workflows | Before | After |
| --- | --- | --- |
| Nine captures with rounded numbers, underflow or duplicate object fields | Exit 0; rewritten snapshot/report | Exit 2; no snapshot; previous report intact |
| Six comparisons with rounded values, underflow or duplicate object fields | Exit 0; falsely unchanged | Exit 2; previous report intact |
| Overflow and two excessive-depth cases | Already refused | Still refused, earlier actionable diagnostic |
| Invalid JSON syntax | Already refused | Still refused |
| Eight accepted captures and six accepted comparisons | Accepted with intended outcomes | Same outcomes and reports |

There are **15 changed operational outcomes**, improving from 18/33 to 33/33.
The receipt also checks specific diagnostic wording; three already-refused
controls differed on that stricter check before the change. They are not counted
as newly fixed capture or comparison outcomes.

The valid controls retain large serializable integers, ordinary decimals,
subnormal numbers, exponent equivalence, strings containing JSON-like content,
sibling objects, prototype-looking keys and duplicate list identities. The six
comparison HTML exports remain byte-identical. The incomplete/ambiguous identity
contract is unchanged.

```sh
npm ci
npm run build
node studies/json-integrity/replay.mjs dist/cli.js /tmp/mcplint-json-after check
```

Use a **new** work directory. To reproduce before, build the recorded baseline
in a separate checkout and supply its `dist/cli.js`, omitting `check`. To inspect
an installed package, supply its actual CLI file and run with that installation's
Node version. No remote MCP server, credential, tool call or paid API is involved.

## Compatibility and independent arithmetic

[Compatibility](results/compatibility.json) reads all 144 syntactically valid
tracked JSON files from the baseline checkout with identical decoded results.
It also runs 20 existing workflows through both CLIs: 11 inventories, eight
snapshot self-comparisons, and the retained official server's Zod 3 versus Zod 4
capture comparison. Audit reports match after omitting only their generated
timestamp; snapshot comparisons match without normalization. Existing schema
errors, unresolved references and incomplete inventories retain their outcomes.

```sh
node studies/json-integrity/compatibility.mjs /path/to/baseline/dist/cli.js dist/cli.js
python3 studies/json-integrity/oracle.py --module dist/core/read-json.js
```

The [independent oracle](results/oracle.json) generates 2,413 deterministic
numeric literals. JavaScript supplies its native serialization; Python `Decimal`
checks exact decimal equality independently of the guard's digit/exponent
normalization. All 938 accepted and 1,475 refused cases agree. The receipt records
the seed and full input/result hashes. This does not claim exact binary
arithmetic: normal `0.1` and `5e-324` serialize to their original decimal values
and remain accepted.

## Packaged runtime and parsing cost

[Clean-artifact verification](results/verification.json) archives implementation
`63f55df`, performs a fresh locked installation, lint, type checking, all 565
checks, compilation and `npm pack`. Two fresh local package installations then
run the full 33-case/39-invocation replay and the 2,413-case Decimal oracle on
Node 20.0.0 and Node 24.21.0. Reports, snapshots, exit codes and HTML hashes match
the corrected source. Full receipts: [Node 20](results/installed-node20.json),
[Node 24](results/installed-node24.json). Package installation itself used Node 24.
The native syntax-error diagnostic on Node 20 omits the newer V8 line/column
suffix; the receipt retains that difference. Application files were unchanged.

The [parsing measurement](results/benchmark.json) uses a constructed inventory
of 5,000 definitions (515,574 bytes). On this 14-CPU-affinity WSL2 host with a
Ryzen 7 7800X3D and Node 24.21.0, median native parsing was 4.07 ms and parsing
with the guard was 39.76 ms across six alternating measured samples after two
warmups. This is parser overhead, not full audit latency or a performance gate.

```sh
node --expose-gc studies/json-integrity/benchmark.mjs dist/core/read-json.js
```

## Boundaries

The check covers raw saved inventories and snapshot imports. It cannot recover
precision or overwritten keys from an older snapshot, a decoded library object,
or live MCP metadata already decoded by the SDK. Client configs and lint configs
keep their existing separate parsers. Declaring a schema limit as a string changes
its meaning; do that only when the producer's schema actually allows a string.

There is no new output rendering or UI code. Unsupported input exits before the
existing report writer runs; retained valid HTML compares byte for byte. Source
publication does not imply an npm release or hosted-demo deployment.
