# Changelog

All notable changes to this project are documented in this file.

## Unreleased

- Check original live MCP JSON before SDK decoding on stdio, HTTP JSON and both
  SSE transports. Duplicate fields, changed numeric values, malformed JSON and
  invalid UTF-8 now make collection explicitly incomplete, retaining prior valid
  pages. Damaged initialization fails the connection. Preserve SSE framing and
  safe diagnostics; close the affected connection and join direct-child cleanup.
  [Four-transport and CLI reproduction](studies/live-json/README.md).

- Check saved metadata JSON before auditing or comparison: refuse duplicate
  object fields, numeric overflow/underflow and decimal changes on serialization.
  A constraint changing from `9007199254740992` to `9007199254740993` previously
  became two equal snapshots and a successful unchanged diff. Refusal now
  preserves prior reports and avoids writing a misleading snapshot. Ordinary
  decimals, equivalent exponent spellings and duplicate list identities retain
  their documented behavior. [CLI and Decimal evidence](studies/json-integrity/README.md).

- Protect file-audit definitions, explicit/discovered lint settings, MCP client
  configs and their resolved `envFile` inputs from report/snapshot destinations.
  Check aliases and both output paths before starting configured servers.
  Replace reports atomically; keep exclusive snapshot creation and remove a
  partial new snapshot on write failure. Preserve incomplete collection when
  an unrelated env file is missing. [Before/after and OS-failure evidence](studies/report-inputs/README.md).

- Capture full decoded list entries and collection coverage with `--snapshot`,
  then review updates with `mcplint diff` in terminal, JSON or offline HTML.
  Match tools/prompts by name and resources/templates by URI; retain unknown
  fields, missing/null distinctions and exact string changes. Incomplete pages
  and duplicate identities cannot establish an unchanged inventory or invent
  removals. Preserve existing snapshots, including report path aliases.
  [SDK and official-server dependency captures](studies/metadata-diff/README.md).

- Keep remote collection requests within the configured HTTP origin, including
  custom API keys and MCP session headers that native fetch forwards across
  redirects. Check each hop in Streamable HTTP and legacy SSE, retain same-origin
  redirects, bound loops, and report a safe actionable connection error.
  [Actual SDK and CLI captures](studies/http-redirects/README.md).

- Read `envFile` comments and quoted values without appending comment text to
  credentials. Preserve quoted hashes, decode double-quoted newline escapes,
  and recognize backtick quotes, colon separators and CR-only lines used by
  VS Code's parser. Explicit `env` entries and null removals still take priority.
  [Reference-parser and actual launch checks](studies/envfile-syntax/README.md).

- Honor null environment entries when launching configured stdio servers. A
  removal now overrides both inherited variables and `envFile`, including
  variables the MCP SDK normally inherits. Keep empty strings distinct and
  leave the parent environment unchanged.
  [Child-process reproduction](studies/config-env-unset/README.md).

- Correct scalar enum description checks for numeric, boolean, null and empty
  choices. Numeric mentions respect token boundaries; findings preserve null and
  empty strings as JSON. Structured choices no longer trigger object coercion
  failures or discard other enum findings; schema and safety checks still run.
  [SDK/CLI and registry comparison](studies/enum-values/README.md).

- Reject invalid UTF-8 and BOM-marked UTF-16 before decoding can silently change
  tool metadata, configuration or credentials. Preserve valid Windows encodings
  and literal replacement characters. A damaged per-server environment file
  prevents that server from starting and leaves the audit incomplete.
  [CLI byte-level reproductions](studies/input-decoding/README.md).

- Validate tool annotation field types in both live and saved lists. String,
  numeric or null hints no longer produce a complete audit or satisfy a
  destructive tool's boolean hint declaration. Keep the malformed tool and
  usable title alongside its valid siblings; report fixed field paths and
  expected types. [SDK comparisons](studies/tool-annotations/README.md).

- Keep HTTP response bodies and MCP initialization error text out of CLI stderr,
  including config-mode progress diagnostics. Preserve recognized HTTP/MCP/system
  codes and connection deadlines in bounded messages; healthy config entries
  continue to be inspected. Malformed server-config JSON and credential-bearing
  `--header`/`--input` arguments no longer echo their values.
  [Loopback captures and installed-package evidence](studies/connection-diagnostics/README.md).

- Detect repeated tool names within a single server, including across list pages.
  Keep every definition available for schema and safety checks; `--fail-on error`
  rejects the ambiguity. Exact-name comparisons remain case-sensitive.
  [Reproductions and recorded public examples](studies/duplicate-names/README.md).

- Replace the full name-comparison matrix with a five-diagonal edit-distance calculation.
  Long names from different servers no longer exhaust memory in `naming/shadowing`;
  comparisons retain the same two-edit cutoff, case folding and findings.
  [SDK captures and registry replay](studies/name-comparisons/README.md).

- Require `uri` on collected resources and `uriTemplate` on resource templates.
  Missing identities now leave the audit incomplete and unscored, including
  when diagnostics are suppressed; usable metadata remains available to safety rules.

- Stop treating required names outside local `properties` as inherently invalid.
  Keep simple open-schema documentation warnings and closed-schema contradictions
  distinct; decline the heuristic for composed or referenced definitions.

- Bound transport startup and the entire MCP handshake with a per-server connection
  deadline (30 seconds by default; `--connect-timeout <ms>` / `connectTimeoutMs`).
  This covers SSE connections without an endpoint and stalled initialization notifications,
  which were outside the SDK's request timeout. Config audits retain the timeout as
  incomplete coverage and continue. HTTP legacy fallback shares the original deadline
  and only follows an HTTP 4xx rejection before initialization succeeds.
  [Before/after loopback and installed-package evidence](studies/connection-deadlines/README.md).

- Validate input and supplied output schemas independently, respecting draft-06, draft-07, 2019-09
  and 2020-12. Clear compiled resources after every check, including failures: repeated `$id`s no
  longer produce false errors or allow unrelated audits to resolve missing references.
- Distinguish malformed schemas from unsupported dialects, unresolved references and compiler limits.
  The latter leave the audit incomplete even when their diagnostic is suppressed. Bound traversal
  before compilation and disable reference inlining. A retained registry replay finds 201 previously
  unreported output-schema issues; see `studies/schema-audit/` for inputs, independent checks and limits.
- **The rules were recalibrated on 11,545 real tool definitions** (`studies/registry-census/`: 418 servers of
  one public registry, from its first 500 listed rows and its verified view). 0.3.3 reported 14 attack errors
  on them, none an attack, and 57.8 findings per server; this version reports none, 2 attack warnings, and
  17.6 findings per server there. That is in-sample. On 886 servers not used for the rework it reports 5
  errors and 7 warnings (0.3.3: 36 and 39); read by hand, none of the errors is an attack and two are false
  alarms. One of three published poisoning examples (a WhatsApp takeover) is now a warning, not an error.
  - `safety/prompt-injection`, `safety/secret-access` and `safety/cross-tool-reference` report one attack
    signal as a warning and two on the same tool, prompt or resource as an error, and say which. A stated tool
    order is a note.
  - `safety/secret-access` is an error for an instruction to obtain a local secret and pass it on, and a
    warning for a credential store that is only named. A `.env` file or an API key merely mentioned is no
    longer reported; a client's MCP configuration is matched by where clients keep it.
  - `safety/cross-tool-reference` reports coercive wording about a tool the same server does not define. A
    server's instructions about its own tools are not reported.
  - `safety/missing-annotations` looks for a destructive verb in the tool's name, not in its description.
  - `safety/encoded-blob` does not read `$ref`, `$id`, `$schema` or `$anchor` values as blobs.
  - `naming/generic` fires only when every word of a name is generic.
  - `schema/portability` reports non-strict schemas once per server; `description/param-missing` once per
    tool.
- Token counts are of what a model is given for a tool: name, description and input schema as compact JSON
  (the Anthropic and OpenAI tool formats). Output schemas and annotations are no longer counted;
  `estimateOutputSchemaTokens()` reports the former separately. Counts are o200k_base estimates, not Claude's.
- `--total-budget` defaults to 16,000 tokens (was unset), 8% of a 200,000-token window; `--budget` stays 400.
  Neither is a percentile. In the census, 8.9% of tools exceed 400 and 6.7% of servers exceed 16,000. A budget
  finding says where the tool or server stands among the census servers.
- The HTML report shows findings before the collection-coverage table when the audit is complete.
- `resolveConfig()` works without arguments for library callers.
- The attack fixture's `translate_text` now shadows a tool of another server (`send_email`), as the published
  attack does, in place of one of its own.
- Require MCP SDK 1.31.0 or newer, which includes the OAuth credential issuer-binding
  fix for GHSA-6qxp-vccf-f47h. Current mcplint transports do not configure an OAuth
  provider. Patch the build dependency source-map-js to 1.2.2 as well.
- Preserve collection coverage and partial pages in every report. Failed advertised
  methods, broken pagination, malformed entries, skipped inputs and failed config
  servers no longer disappear into apparently successful audits.
- Accept intentional empty saved lists and flag saved cursors as incomplete exports.
- Bound list requests and pagination. Scan schema keys and strings iteratively,
  including structured literals and extension keywords; expose limits as unchecked
  work while retaining other tools' findings.
- Incomplete audits have no score and fail either `--fail-on` threshold, even when
  their diagnostic is suppressed. JSON adds collection records and completion;
  score and token totals can be null. See `docs/collection-coverage.md`.
- Make report status independent of its heuristic score. Add accessible coverage
  tables, a synthetic interrupted-collection demo, and Chromium/Firefox regressions.
- Keep untrusted Markdown metadata literal after rendering. Scope scoring, finding
  groups and HTML anchors to server/kind/name identities.
- Validate lint settings before collection, including severity values and positive
  integer budgets, so malformed settings cannot weaken a CI gate.

## [0.3.3] - 2026-10-03

### Security

- New rule `safety/control-characters` (error): control characters in a name or in any text the model reads,
  such as the terminal escape codes in Trail of Bits' "Deceiving users with ANSI terminal codes in MCP". A
  description ending in `ESC[8m` and a second sentence shows only its first sentence in a terminal; the model
  reads both. The finding quotes the escape sequences in visible form (`"\x1b[8m"`). The poisoned fixture has
  a tool that does this (`get_forecast`), so its report has 14 tools and 33 findings.
- mcplint printed text a server wrote as it came, escape codes included. A tool named
  `get<ESC>]0;pwned<BEL>_weather` retitled the terminal mcplint ran in, an escape code in a description reached
  the Markdown report, and an error about a malformed file quoted its bytes raw. The terminal, Markdown and
  HTML reports and the error messages now write each control character as a visible escape (`\x1b`, `\x07`);
  JSON and SARIF already escaped them.

## [0.3.2] - 2026-10-02

### Added

- Published to npm as `@antonsoloviev/mcplint`: `npx @antonsoloviev/mcplint stdio -- node your-server.js`. The
  README and the CI guide use the registry package instead of the GitHub install, which npm 12 blocks by default.

### Fixed

- A file saved by a Windows shell. `... > tools.json` in Windows PowerShell
  writes UTF-16 with a byte-order mark, which `mcplint file` refused as "not
  valid JSON: Unexpected token"; the same went for a client config, a
  `.mcplintrc.json` and an env file saved that way. The mark decides the
  encoding now, and a UTF-16 copy of a tools file lints exactly like the
  UTF-8 one. (A UTF-8 mark was already handled.)

### Security

- The HTML report carries a Content-Security-Policy. A tool description is
  text a server wrote, which is what this report exists to distrust: it is
  escaped, and if some ever were not, the policy lets no script run but the
  report's own theme toggle (allowed by its hash) and lets nothing be fetched.
  Opened from disk in Chromium and Firefox: no violations, the toggle works,
  and the report looks the same.

### Accessibility

- The HTML report, checked with axe-core (WCAG 2.1 A and AA, and its best-practice rules) in light and dark,
  at desktop and phone widths: no findings now.
  In the light theme the accent used for links (4.0:1), the severity chips
  (3.8:1 to 4.0:1 on their own tint), the "good" label (4.25:1) and the dimmed
  tag (3.0:1) are above 4.5:1. The report has an `h1` and a `main` landmark.

## [0.3.1] - 2026-10-02

### Fixed

- **With `--fail-on`, a report longer than 64 KB was cut off when piped.** The
  CLI called `process.exit(1)` with the report still on its way out. A lint of
  120 poisoned tools that fails writes 250 KB of JSON, 359 KB of SARIF or
  503 KB of HTML to a file, and through a pipe (a CI step's captured output,
  `| tee report.json`, `$(mcplint ...)`) exactly 65,536 bytes of each: invalid
  JSON, in the one case where the report is wanted. The exit code is now set
  and the process ends when the output has drained. `--output` was not
  affected.

## [0.3.0] - 2026-10-01

`mcplint config` and `mcplint http` against what is really deployed: other clients' config files, and servers
that still speak the transport Streamable HTTP replaced.

### Added

- `mcplint config` reads VS Code's `.vscode/mcp.json` (a `servers` map, and the `mcp.servers` section of a
  `settings.json`), which it used to refuse for having no `mcpServers`. Comments and trailing commas are allowed,
  as VS Code allows them.
- Placeholders are filled in as the clients fill them: `${workspaceFolder}`, `${userHome}`, `${env:NAME}` and
  `${input:id}` (VS Code), `${NAME}` and `${NAME:-default}` (Claude Code). `--input id=value` supplies an input;
  an input's `default` is used otherwise.
- A stdio entry's `cwd` and `envFile` are honored, and a VS Code server with no `cwd` runs in the workspace
  folder, as it does in VS Code.
- `mcplint http`, and remote entries of a config, fall back to the HTTP+SSE transport when a server does not
  answer Streamable HTTP, as the MCP specification asks of clients. An entry with `"type": "sse"` uses it
  directly. Such servers used to fail with the 405 or 404 their endpoint gives a Streamable HTTP request.

### Fixed

- A server marked `"disabled": true` was started and linted anyway. It is listed as not started.
- A placeholder was passed to the server as written: a server whose key was `${API_KEY}` was started with
  that literal string for a key. A server whose placeholder cannot be filled in is now named, with what it
  needs, and not started; when no server in a config can be started, the error says why for each.

## [0.2.2] - 2026-10-01

Tool metadata comes from the server being linted, and a server can be built to make the linter slow or its report
unreadable. This release is about that.

### Fixed

- The token estimate took time proportional to the square of the longest unbroken run in a text: one 40 KB
  description of zero-width spaces took 5 seconds to lint (of plain spaces, 1 second), four times that for each
  doubling. A run of more than 2,048 characters with no whitespace, or of nothing but whitespace, is now counted
  in pieces: 1 MB of zero-width spaces lints in under a second, and the count is within 2% of the exact one on
  the base64, CJK and single-letter runs tested. Shorter runs are counted exactly as before, so nothing changes
  for the reference servers (their longest run is 933 characters).
- `safety/prompt-injection` looked for `<IMPORTANT>` blocks with a lazy pattern that rescanned the rest of the
  text from every opening tag without a closing one.
- A tool name containing half of a surrogate pair (`"\ud83d"` is valid JSON) crashed the SARIF report with
  `URIError: URI malformed`.

### Changed

- `safety/hidden-unicode` reports each field once per family of single characters, with the count and the code
  points, instead of once per character: a description padded with 40,000 zero-width spaces was 40,000 findings.
  Payload runs (tag characters, variation selectors) are still listed one by one, up to ten per field.
- `description/near-duplicate` reports a group of similar tools once, on its first tool, instead of once per
  pair: 250 tools generated from one template were 31,125 findings. A pair reads as before.

## [0.2.1] - 2026-10-01

### Added

- The package is named `@antonsoloviev/mcplint`, ready for npm (published there from 0.3.2).
- `safety/unchecked`: if a rule still fails to run on some metadata, that is reported as an error finding naming
  the rule, the other rules still run, and `--fail-on error` fails. A crash or a silent pass would both let a
  poisoned server through.
- A structural fuzz test: the three reference servers' tool lists, mutated, must lint and render in every format
  with no rule failing.

### Fixed

- `mcplint --version` (and `-v`) printed the help text and exited 1, because the no-arguments check ran first.
- Malformed metadata could crash the linter, which is a way to dodge it: a property whose `description` is a
  number, or a prompt argument that is `null` or has a non-string description, raised a `TypeError` instead of a
  report. Those shapes are now read safely (a non-string description counts as missing; `schema/invalid` reports
  the schema itself).

## [0.2.0] - 2026-09-30

### Added

- The safety rules read every string the model reads, not just top-level text: descriptions, titles, enum,
  default, const and example values, and property names at any depth of a tool's input and output schema
  (nested objects, array items, `$defs`, `anyOf`/`oneOf`/`allOf`...). An injection hidden in a nested
  parameter's description previously produced no finding and a 100/100 score.
- Server `instructions` are linted by the text-matching safety rules, as a `server` subject.
- `tools/list`, `prompts/list` and `resources/list` follow `nextCursor` to the last page, and
  `resources/templates/list` is collected; `mcplint file` accepts `resourceTemplates` and `instructions`.
- `safety/secret-access` recognizes more credential stores: `~/.netrc`, `~/.npmrc`, `~/.pgpass`,
  `~/.git-credentials`, `~/.kube/config`, `~/.docker/config.json`, `~/.config/gh/hosts.yml`, Google Cloud
  `application_default_credentials.json`, and MCP client configs (`mcp.json`, `claude_desktop_config.json`).
- `safety/prompt-injection` recognizes "do not mention/reveal ... to the user" and "do not mention that you
  ..." concealment.
- The poisoned fixture gains a nested-parameter attack (`create_ticket`) and poisoned server instructions.
- `safety/hidden-unicode` also flags other default-ignorable invisible characters (a new `invisible` kind):
  the Hangul fillers, which can stand alone as an invisible identifier, the combining grapheme joiner, the
  invisible math operators, the Khmer inherent vowels and the Mongolian free variation selectors.

### Changed

- `safety/encoded-blob` no longer flags loopback, unspecified or RFC 1918 addresses
  (`http://127.0.0.1:11434` is configuration), and trailing sentence punctuation is no longer part of a URL.
- Two phrasings of the same injection technique in one field are reported once.
- The version is defined once (`src/version.ts`) and checked against `package.json`.

## [0.1.0] - 2026-09-24

Initial release.

### Added

- `mcplint stdio|http|file|config` targets for collecting tools, prompts, and resources from an MCP server via
  the official `@modelcontextprotocol/sdk` client.
- 23 rules across five categories: token budget, naming, descriptions, schema validity, and safety (hidden
  Unicode, prompt injection, secret-access instructions, cross-tool references, encoded blobs, missing
  destructive annotations). See `docs/rules/`.
- Terminal, JSON, SARIF 2.1.0, Markdown, and self-contained HTML report formats.
- `--budget`, `--total-budget`, `--fail-on`, `--config`, and `--ignore` CLI flags; `.mcplintrc.json` for rule
  severity overrides and ignores.
- `examples/good-server` and `examples/poisoned-server` fixture MCP servers, used by the end-to-end test suite
  and as a live demonstration in the README.
- GitHub Actions CI running lint, typecheck, tests, and build, plus a job that lints both fixture servers.
- `npm run build:site` (`scripts/build-site.mjs`) and a Pages workflow publishing mcplint's own HTML report,
  run against both fixture servers, as a live demo.
- Scoring (`src/core/score.ts`) averages a per-item quality score across every collected tool/prompt/resource
  (so a big, mostly well-documented server isn't punished just for having more tools than a small one), while
  safety findings are summed rather than averaged (so one tool trying to exfiltrate a secret still tanks the
  score on a large server, not just a small one).
- `scripts/dump-reference-fixtures.mjs` and `tests/fixtures/reference-servers/` capture the raw `tools/list`
  response of `@modelcontextprotocol/server-everything`/`-filesystem`/`-memory`; every finding mcplint reports
  against them is audited by hand and locked in as a regression test
  (`tests/reference-servers.test.ts`) against new false positives.
