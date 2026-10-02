# Changelog

All notable changes to this project are documented in this file.

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

- The package is named `@antonsoloviev/mcplint`, ready for npm. It isn't published yet; until it is, install from
  GitHub as before.
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
