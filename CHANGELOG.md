# Changelog

All notable changes to this project are documented in this file.

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
