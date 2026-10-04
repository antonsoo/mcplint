# Collection coverage verification, 2026-10-03

This pass fixes six locally tracked Beads issues. It was implemented and reviewed
by one agent. The source and demo changes are local; this pass did not publish a
package or deploy Pages.

| Beads issue | Verified behavior |
| --- | --- |
| `officina-ah8` | List failures, repeated cursors, malformed envelopes and bounds retain partial evidence and fail configured gates. |
| `officina-9b5` | Config reports retain failed, unresolved, malformed and disabled entries; empty saved lists remain valid. |
| `officina-o55` | Schema literals and extensions are inspected; depth, work and text limits produce incomplete results. |
| `officina-53f` | Every report exposes scope; HTML status is independent of score; Markdown metadata stays literal after GFM rendering. |
| `officina-9f0` | Same-named tools on different servers receive separate quality scores; delimiter-bearing identities stay distinct. |
| `officina-570` | Invalid lint settings are rejected before collection and cannot weaken an error gate. |

## Reproduced before fixing

Nine regression cases failed on the original implementation: a failed advertised
list passed the gate; a valid empty saved list was rejected; malformed entries,
saved cursors and wrongly typed lists were ignored; failed config servers vanished;
structured schema values were missed; cross-server quality scores were wrong; and
Markdown could render untrusted HTML/images. A further eight config validation
cases failed before runtime validation was added.

## Clean checkout

Runtime/test changes were verified from detached commit `4ff70d6` with a fresh
install using Node 24.21.0 and npm 11.19.0 on Linux. Subsequent changes refine
coverage documentation and include it in the npm package; they do not change the
runtime implementation.

```sh
npm ci
npm run lint
npm run typecheck
npm test
LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8 npm test
npm run test:browser
npm pack --dry-run --json
```

- Installation, lint, typecheck and production builds passed.
- 273 tests in 26 files passed in both locales. These include structural fuzzing,
  reference-server regressions, real stdio and HTTP/SSE transports, independent
  JSON-RPC failure fixtures, all report formats and built-CLI exit codes.
- 20 Chromium/Firefox workflows passed. They cover offline reports, desktop and
  375px layouts, both themes, keyboard access to the table, unavailable storage,
  hostile HTML/Markdown and navigation among the three built demo reports.
- All 16 accessibility scans passed with zero axe findings. Evidence-view checks
  recorded no page exceptions, CSP violations or off-origin requests; the demo
  navigation and Markdown checks also recorded no off-origin requests.
- All 124 compiled `dist/` files matched the source checkout by SHA-256. All four
  site files matched after normalizing only generated timestamps.

Earlier source verification on Node 26.7.0 passed 268 tests and all 20 browser
workflows; the final 273-test suite was verified in the clean Node 24 checkout. A synthetic
schema containing a 2,000,001-character extension value completed linting in 571 ms
in one Node 26 run on the 14-vCPU WSL2 / 48-GB machine, with `complete: false`, a null
score and one `safety/unchecked` finding. This is a single local check of the text
limit, not a general performance guarantee.

## Package and minimum runtime

On Node 20.0.0, the clean-built CLI passed version and saved-file checks. A real
interrupted stdio fixture retained one tool, emitted `complete: false`, and exited
1 with `--fail-on error`.

The local tarball contains 92 files (85,220 compressed bytes), including
`docs/collection-coverage.md`, the new rule documentation and compiled collectors.
It excludes tests, the demo and node_modules. The tarball was installed into a
separate consumer directory with development dependencies and install scripts
disabled; the installed API and a Node 20 CLI SARIF run passed.

## Visual review and build output

Reviewed real browser screenshots from the synthetic hostile-input fixture:

- `docs/assets/coverage-dark-1440.png`
- `docs/assets/coverage-light-1440.png`
- `docs/assets/coverage-dark-375.png`
- `docs/assets/coverage-light-375.png`

Status and missing score are prominent. Hostile names remain visible text. On a
phone the coverage table scrolls within its panel, including with arrow keys; the
page itself does not overflow horizontally. Long hostile names make this stress
fixture tall, as expected.

`npm run build:site` builds `dist/` and produces `site/index.html`, `site/good.html`,
`site/incomplete.html` and `site/.nojekyll`. The third page is a real collection of
the synthetic first-page-success/second-page-failure fixture.

## Limits

This remains a metadata linter, not a proof of server safety. File and response
JSON decoding still occur before the collection caps; the caps do not bound all
memory use or all rule execution time. No new protocol generation or sandbox is
claimed. API consumers must handle nullable scores and token totals. Full details
are in [collection coverage](collection-coverage.md).
