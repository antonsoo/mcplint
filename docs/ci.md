# Running mcplint in CI

mcplint's npm package (`@antonsoloviev/mcplint`) isn't published yet, so `npx` runs it straight from GitHub;
npm 12 needs `--allow-git=root` for a git-hosted package. Two ways to wire it into a server repository's CI:

## GitHub Actions

```yaml
# .github/workflows/mcplint.yml
name: mcplint

on:
  push:
  pull_request:

jobs:
  lint-tools:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24

      # Runs the CLI via npx, no local install step needed.
      - name: Lint MCP tool definitions
        run: npx --allow-git=root github:antonsoo/mcplint stdio --fail-on error -- node dist/server.js
```

Swap the final `-- node dist/server.js` for however your server actually starts (a built entrypoint, `npx tsx
src/server.ts`, `python -m my_server`, etc. — anything mcplint can spawn over stdio).

For a server exposed over Streamable HTTP instead, start it as a background step and point `mcplint http` at it:

```yaml
      - run: node dist/server.js &
      - run: npx wait-on http://localhost:3000/mcp
      - run: npx --allow-git=root github:antonsoo/mcplint http http://localhost:3000/mcp --fail-on error
```

## Any other CI system

The same idea works anywhere a shell step runs:

```sh
npx --allow-git=root github:antonsoo/mcplint stdio --format sarif --output mcplint.sarif -- node dist/server.js
```

`--format sarif` produces a [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/) log; GitHub code
scanning, GitLab, and most other CI dashboards can ingest it directly (on GitHub, upload it with
[`github/codeql-action/upload-sarif`](https://github.com/github/codeql-action)).

## Choosing `--fail-on`

- `--fail-on error` — only hard problems (missing/invalid schemas, hidden Unicode, prompt-injection patterns,
  secret-access instructions) fail the build. This is the recommended default; start here.
- `--fail-on warning` — also fails on style/clarity issues (short descriptions, undocumented parameters, generic
  names). Stricter; a good target once a server's existing tools are clean.
- Omit `--fail-on` to lint without failing the build — useful for a first pass on an existing server, or to just
  publish the report.

Rule severities can be tuned per-repository in a `.mcplintrc.json` — see the main [README](../README.md#configuration).
