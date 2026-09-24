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
