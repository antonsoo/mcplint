# MCP SDK dependency verification - 2026-10-07

Local source commit `cd7b907` raises the SDK minimum from `^1.30.1` to `^1.31.0`
and locks 1.31.0. Only the declared minimum and the SDK package's version, tarball
and integrity changed; transitive dependencies did not. The preceding commit
`d186ae0` patches the development dependency `source-map-js` to 1.2.2. Neither
change has been pushed, published to npm or deployed to Pages.

The SDK update includes the fix for
[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h), concerning
OAuth credentials sent to a different authorization-server issuer. Current
mcplint HTTP/SSE transports configure request headers, not an OAuth provider, and
stdio does not use that flow. This is dependency maintenance; it is not evidence
that mcplint previously leaked OAuth credentials. No live OAuth account was used.

## Verified behavior

`npm ci`, lint, type checking, all 273 tests, and 20 Chromium/Firefox report
workflows passed with locked SDK 1.31.0 on Node 26.7.0. The transport checks run
actual SDK servers for Streamable HTTP and legacy SSE, including fallback and
request headers, and real child processes for stdio collection. Partial pages,
malformed responses and incomplete audit gates retain their existing behavior.
The report checks cover desktop/mobile, light/dark, accessibility, inert Markdown,
blocked storage and the three demo outcomes.

The packed artifact was installed outside the repository, with install scripts
disabled, and executed on the supported Node 20 line (20.20.2). That clean
consumer resolution selected SDK 1.32.1, which satisfies the new minimum. These
are the actual installed-package outcomes:

| Process workflow | Tools retained | Complete | Score | Exit |
| --- | ---: | --- | ---: | ---: |
| Real SDK-backed good stdio server | 3 | Yes | 100 | 0 |
| Independent JSON-RPC server failing on its second list page | 1 | No | null | 1 |
| Saved deliberately poisoned metadata | 4 | Yes | 41 | 1 |

The partial result retains its first page and refuses to present a score. The
poisoned metadata produces seven errors, four warnings and two informational
findings. These fixture servers supply metadata; no invoice tool is executed.

The full checkout and clean consumer audits both report zero vulnerabilities at
verification time. [Machine-readable evidence](verification-sdk-2026-10-07.json)
includes the package SHA-256, exact dependency versions, audit counts and CLI
summaries. This is compatibility verification of mcplint's supported transports,
not a new audit of the SDK's OAuth implementation.
