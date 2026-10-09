# Replaying schema decisions through the real CLI

These **synthetic invoice schemas** reproduce three defects in `b1438c0`: a second audit of the same
`$id` reported a false schema error; an unrelated earlier schema could satisfy a missing reference;
and malformed output schemas were never validated. The replay also covers declared draft-07 tuple
syntax, array outputs and an unresolved dependency that must keep its audit score unavailable.

From the repository root:

```sh
npm ci
npm run build
node examples/schema-audit/replay.mjs dist/cli.js /tmp/mcplint-schema-replay --verify
```

The script runs all four snapshots through file collection, a real stdio process and a loopback
Streamable HTTP fixture. It retains JSON reports, request logs, terminal/Markdown/HTML/SARIF reports,
and `observations.json`. It also checks a suppressed diagnostic and repeated library calls in one
process. Pass an installed package's `dist/cli.js` to exercise that package rather than this checkout.

| Snapshot | Expected `--fail-on error` exit | Schema findings | Audit complete |
|---|---:|---|---|
| `valid.json` | 0 | None | Yes |
| `invalid.json` | 1 | One malformed output schema | Yes |
| `unresolved.json` | 1 | One unchecked output reference | No |
| `mixed.json` | 1 | Both of the above | No |

The `mixed` snapshot includes another tool whose schema has the exact `$id` requested by the unresolved
reference. It must **not** satisfy that dependency. Input schemas, output schemas and different tools
are separate schema documents; bundle definitions into the document that uses them.

```text
tool A: inputSchema with $id /invoice
              |
              +--> inspect --> clear resource registry

tool B: outputSchema referring to /invoice
              |
              +--> inspect --> dependency absent --> incomplete audit
```

`server.mjs` is deliberately a raw JSON-RPC fixture so an SDK cannot reject malformed metadata before
the linter sees it. It advertises protocol `2025-11-25`, the installed SDK's transport contract. Schema
validation follows the documented dialect rules; this fixture is not evidence of full 2026-07-28
transport support. Its request logs must contain only `initialize`, `notifications/initialized` and
`tools/list`, in that order. It does not implement `tools/call`.

For a single saved-file audit:

```sh
node dist/cli.js file examples/schema-audit/mixed.json --format html > /tmp/mcplint-schema-report.html
```

Open that file directly in a browser. The report identifies the malformed `outputSchema`, leaves the
unresolved tool's audit incomplete, and works offline. Browser checks cover Chromium and Firefox at
1440 and 375 pixels, including accessibility, keyboard theme switching and network silence.

Before/after observations, independent registry checks and measured limits are in
[`studies/schema-audit`](../../studies/schema-audit/README.md).
