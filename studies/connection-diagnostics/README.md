# A safe JSON report can still have a leaking stderr

At source commit `f8170b3`, mcplint's config coverage records omitted raw connection
errors, but its progress callback printed the same SDK error to stderr. Direct
HTTP and stdio mode also printed raw errors. A server returning HTTP 503 with an
authorization header in its response body therefore copied that header into a
terminal or CI log. MCP initialization error messages had the same path.

The [before](results/before.json) and [after](results/after.json) captures use a
loopback HTTP endpoint and a synthetic stdio server through the real MCP SDK and
built CLI. Every credential is fictitious; no remote MCP server is contacted.

```text
HTTP 503 response body / MCP initialize error
                     |
                     v
              SDK Error object
                 /       \
library caller <-         -> CLI: recognized code + local guidance
```

| Input | Retained diagnostic information | Omitted text |
| --- | --- | --- |
| HTTP or SSE transport failure | Valid HTTP status number | Response body and SDK message |
| MCP initialize error | Safe integer MCP error code | Server message and error data |
| Known OS/network failure | Allowlisted system code | Arbitrary message, cause and stack |
| Local connection deadline | Configured duration and remediation | No server text was present |
| Malformed server-config JSON | File path, syntax guidance, position when available | Parser's nearby text excerpt |
| Malformed `--header` or `--input` | Expected argument syntax | Supplied argument |

Ten scenarios cover direct HTTP and stdio failures, mixed config collection in
JSON/SARIF/HTML/Markdown/terminal output, and three malformed-input paths. Each
mixed config includes two unavailable servers and a healthy server. The JSON
case checks that its healthy tool survives, its two connection gaps remain
incomplete, and its whole-audit score stays null. Every mode retains its prior
exit behavior. The loopback server separately verifies that all six requests
still carry the exact supplied authorization value.
All ten selected scenarios exposed a private marker before the fix; none do
afterward. These are counterexamples, not a measurement of leak frequency in
deployed servers.

## Reproduce

```sh
npm ci
node studies/connection-diagnostics/capture.mjs dist/cli.js --check
```

For the old behavior, build a separate checkout of `f8170b3` and pass its
`dist/cli.js` to the current capture script; omit `--check` to retain the failing
receipt. A packed installation works the same way: pass its installed CLI path.
The fixture and capture script remain in the source checkout, while the CLI
imports the package being checked. The regression test uses this full process
boundary, not a mocked report renderer.

## Scope

This source change does not publish a new registry version or anonymize reports.
Server metadata and names, successful target labels, command arguments, URLs,
file paths and a spawned server's own stderr can still contain sensitive values.
The change removes raw error propagation at the demonstrated diagnostic paths;
it is not a promise that arbitrary server content is safe to publish.

Library consumers keep access to raw rejected errors and `onServerError` values.
The exported `connectionFailureMessage(error)` helper supplies the bounded
diagnostic used by the CLI and config coverage records. Collection, fallback,
authorization and connection deadlines retain their existing behavior.
