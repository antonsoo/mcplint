# Enum descriptions without false alarms or object coercion

At source `48c74c3`, `description/enum-unexplained` only recognized string
choices in prose. It flagged `0 disables; 1 enables`, `true`/`false`, and `null`
explanations as absent. Conversely, an empty-string choice matched every
possible description, suppressing the finding even with no description.

A valid object choice such as `{"toString":"compact"}` exposed a second
failure. Rendering the enum with `Array.join` tried to call that data field as
a method. The linter's exception guard correctly marked the audit incomplete,
but discarded this rule's other findings and incorrectly called the metadata
malformed. The correction keeps this prose heuristic explicitly scoped to
scalar choices; schema validation, description-presence and safety checks
still inspect structured choices.

## Actual CLI and SDK results

The [four controlled fixtures](fixtures.json) are synthetic, not captured
production metadata. They exercise documented scalars, object choices,
numeric/empty-string boundaries, and an instruction embedded in a structured
choice. [`capture.mjs`](capture.mjs) loads each through a saved file and a real
local SDK server/client. Only metadata is listed; no tool is called.

| Workflow | Baseline | Corrected |
| --- | --- | --- |
| Documented numeric, boolean and null enums | Three false enum findings | No enum findings |
| Object choices alongside an unexplained string enum | Incomplete audit; enum findings lost; exit 1 | Complete audit; string enum finding retained; exit 0 |
| Empty-string choice with no literal explanation | Finding suppressed | Choice remains visible as `""` in a finding |
| Instruction inside a structured choice | Safety finding plus failed description check | Safety finding retained; description check does not fail |

The [baseline capture](before.json) disagrees with the expected behavior in all
eight workflows; the [corrected capture](after.json) agrees in all eight.
An actual strict SDK client retains every fixture choice. Separately,
[`schema-oracle.py`](schema-oracle.py) uses python-jsonschema 4.10.3 to validate
all nine schemas and every choice against both Draft 7 and Draft 2020-12:
[18 independent schema checks](schema-oracle.json). Mcplint's fixture audits use
its default 2020-12 dialect. JSON Schema explicitly allows enum members of any
type, including null: [validation specification, section 6.1.2](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.1.2).

## Retained registry snapshots

[`corpus.mjs`](corpus.mjs) replays this rule against the two existing
[registry-census manifests](../registry-census/README.md), using cached metadata
without contacting any server. It uses manifest entries rather than every
cache file: an extra cached server outside the first manifest is excluded.
These are historical snapshots, not current statements about those services.

| Recorded group | Servers with tools | Tool definitions | Old enum findings | New enum findings | Removed / added |
| --- | --- | --- | --- | --- | --- |
| Initial manifest | 418 | 11,545 | 1,145 | 1,133 | 13 / 1 |
| Held-out manifest | 886 | 14,254 | 1,806 | 1,790 | 20 / 4 |

The [corpus receipt](corpus.json) includes hashes and every changed parameter's
actual enum and description. All 33 removals name numeric choices already
present in their descriptions; each was inspected. All five additions contain
an empty choice that previously suppressed the check. Four have no description;
one has a Vietnamese description with none of the literal English choices.
The latter demonstrates the heuristic's language limitation, not proof of poor
documentation. Other findings in these snapshots are not reassessed here.

## Scope and report inspection

Numeric mentions use whole tokens: the choice `1` is not documented by `10`,
`-1`, `1.5`, `1e3` or `v1`. A choice of `1000` can be mentioned as `1e3`.
Decimal spellings are compared without floating-point rounding or underflow:
`1.00000000000000001` does not document `1`, and `1e-999` does not document `0`.
Boolean and null choices use whole words. An empty string requires quotes or
`empty string`; whitespace-only choices require their quoted JSON spelling.
Nonempty string matching retains its existing case-insensitive substring rule.

This is a lexical clue, not semantic evaluation. It does not establish that
prose explains every option, that a tool behaves as declared, or that a server
is safe. Object/array choice explanations are outside this particular rule.
Schema compiler and collection limits continue to produce incomplete audits.

The [Chromium desktop](browser-chromium-1440.json), [Chromium mobile](browser-chromium-375.json),
[Firefox desktop](browser-firefox-1440.json) and [Firefox mobile](browser-firefox-375.json)
checks inspect real exported HTML files offline. Null and empty strings remain
visible, the structured tool stays in the report, and no incomplete-audit error
is invented. They record no page errors, network requests, CSP violations,
page overflow or accessibility violations. All four screenshots were opened
and inspected; findings and coverage remain readable at 375px:

- [Chromium desktop](../../docs/assets/enum-values/chromium-1440.png)
- [Chromium mobile](../../docs/assets/enum-values/chromium-375.png)
- [Firefox desktop](../../docs/assets/enum-values/firefox-1440.png)
- [Firefox mobile](../../docs/assets/enum-values/firefox-375.png)

## Clean build and installed package

A fresh archive of `fdff59d` passed `npm ci`, lint, typecheck, all 464 tests
in 40 files, the build, and all 28 Chromium/Firefox workflows. Its eight
CLI/SDK captures and regenerated schema-oracle JSON match the retained
receipts byte for byte. [Commands, log hashes and package hashes](checks.json)
also record a corrected verification-driver comparison: the oracle writes a
JSON file and prints a status line; those are separate outputs.

All 102 files in the locally packed installation match the clean archive's
build. The installed CLI passes the eight controlled workflows on both
[Node 26.7.0](installed-node26.json) and the minimum supported
[Node 20.0.0](installed-node20.json). Both documented fixture commands also
run from the installed executable. This is source and local-package evidence;
the npm version remains unchanged.

The source and [hosted static reports](https://antonsoo.github.io/mcplint/)
are now published. The [publication receipt](publication.json) checks pinned
source files and all three served HTML files against the verified build.
Chromium and Firefox inspect the findings, no-findings and incomplete-audit
reports at 375px, with offline theme controls and no page, CSP, network or
accessibility errors. The site displays fixture reports; it does not audit
visitor-supplied servers. These checks do not constitute an npm release.

## Reproduce

Build source `48c74c3` separately and use its checkout as `BASELINE_ROOT`.

```sh
npm ci
python3 studies/enum-values/schema-oracle.py # requires python-jsonschema
node studies/enum-values/capture.mjs "$BASELINE_ROOT/dist/cli.js" > studies/enum-values/before.json
node studies/enum-values/capture.mjs dist/cli.js --check > studies/enum-values/after.json
CAPTURE_ENUM_EVIDENCE=1 npx playwright test tests/browser/enum-values.spec.mjs
```

For the optional registry replay, first restore the cached snapshots described
in the existing census study, then run:

```sh
node studies/enum-values/corpus.mjs "$BASELINE_ROOT" studies/enum-values/corpus.json
```

The command checks manifest members only and stops if required snapshot files
are unavailable. The reproduction commands do not publish anything.
