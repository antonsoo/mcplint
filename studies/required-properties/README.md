# Required names do not have to be local properties

At baseline `38f9366`, the following valid MCP input schema triggers
`description/required-undeclared` at error severity, and `--fail-on error` exits 1:

```json
{
  "type": "object",
  "required": ["region"],
  "allOf": [{ "properties": { "region": { "type": "string" } } }]
}
```

The rule looked only at root `properties`. JSON Schema defines `required`
independently: the example accepts `{"region":"us"}` and rejects `{}`. Definitions
may be supplied by composition, references, patterns or additional-property schemas.
The [JSON Schema object reference](https://json-schema.org/understanding-json-schema/reference/object)
and [combining reference](https://json-schema.org/understanding-json-schema/reference/combining)
describe these semantics.

The correction narrows the rule to a documentation heuristic for simple schemas.
An undeclared required name in an open schema gets a warning. A simple schema
with `additionalProperties: false` still gets an error: the name is both required
and forbidden. The heuristic declines composed/referenced/pattern-based cases;
it does not attempt general satisfiability analysis or reference resolution.

## Retained observations

These are constructed counterexamples and controls, not findings against public
servers. The [nine cases](cases.json) run through the actual compiled CLI,
with its exit status checked against the library's gate decision.

| Case | AJV and Python validator | Baseline error gate | Corrected error gate |
| --- | --- | --- | --- |
| `allOf`, local reference, pattern, additional-property schema | Accept supplied argument; reject empty object | Fail | Pass |
| Open schema with undocumented required name | Accept argument; reject empty object | Fail | Pass, documentation warning |
| A nested object's definition does not define a root name | Accept argument; reject empty object | Fail | Pass, documentation warning |
| Direct named-property control | Accept argument; reject empty object | Pass | Pass |
| Invalid `type: "strng"` | Schema rejected | Fail | Fail |
| Required name forbidden by a simple closed schema | Both supplied argument and empty object rejected | Fail | Fail |

`--fail-on warning` and an explicit severity override still reject the
documentation warning. These are recorded or checked in the regression suite.

- [Baseline CLI/library results](before-38f9366.json).
- [Corrected results, including AJV instance validation](after.json).
- [Independent Python jsonschema results](python-oracle.json).
- [Retained registry replay](corpus.json): **25,799 tool definitions**, zero findings
  from this rule before or after. This is a compatibility check, not evidence
  of defect prevalence. Inputs are the previously collected registry snapshots;
  their file hashes are retained. No live registry servers were contacted.

```sh
npm ci
node studies/required-properties/replay.mjs . /tmp/required-after.json
python3 studies/required-properties/oracle.py /tmp/required-oracle.json
# The Python command requires jsonschema; both validator versions are in receipts.
node studies/required-properties/corpus.mjs /path/to/baseline-checkout
```

Both checkouts need their compiled `dist` directory for the corpus comparison.
`replay.mjs` also accepts an installed package directory as its first argument.
The retained baseline is source `38f936699d70848cadd270d87da812a4037fddd9` built
with the locked dependencies. The rule's [documentation](../../docs/rules/description-required-undeclared.md)
lists its deliberate scope limits. Source changes do not constitute an npm release.

## Installed package verification

A clean clone of source `e2aa7b4` installed the lockfile, built a tarball, and
passed lint, typecheck and 380 checks. The working production HTML reports also
passed all 24 existing browser scenarios. A separate prefix installed only the
locally built package and runtime dependencies. Both this study's replay and
its counterpart pass on Node 26.7.0 and the declared minimum Node 20.0.0:
[installed](installed.json), [minimum Node](installed-node20.json).
The observed results equal the corrected source receipts (apart from the Node
version field on the minimum runtime).

Every compiled JavaScript file matches between working build, clean clone,
and installation. The [artifact receipt](../resource-identity/installed-verification.json)
records their hashes and the tarball SHA-256. Four additional offline workflows
opened HTML produced by the installed CLI in Chromium and Firefox at 1440/375 px;
JSON and SARIF agreed about incomplete coverage and withheld scoring.
[Installed browser receipt](../resource-identity/installed-browser.json).
