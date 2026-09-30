# Changelog

All notable changes to this project are documented in this file.

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
