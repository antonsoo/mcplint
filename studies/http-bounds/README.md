# An oversized response must leave an incomplete audit

At source `b2b95661b0ebe3583a317b390c4392702219cf4a`, a loopback MCP server
returned one readable tool page followed by a 96 MiB description. The real CLI
aborted with `SIGABRT` and V8's heap-out-of-memory diagnostic under a 256 MiB
old-space cap. It emitted no audit or snapshot. Existing item/page/time limits
could not help: HTTP JSON and SSE data were buffered before those limits applied.

The source now bounds each decompressed HTTP JSON response, buffered SSE line,
and joined SSE event data at 10 MiB. It stops before JSON/SDK metadata decoding,
closes the affected connection and uses the existing incomplete-collection rule.
Earlier pages retain their definitions; no whole-target score or passing gate is
invented. Oversized initialization fails with a fixed diagnostic. This is the same
byte scale as the existing stdio message bound, not an overall process sandbox.

| Real CLI case | Original build | Corrected source |
| --- | --- | --- |
| SDK server, two ordinary tool pages; each HTTP transport | Exit 0; two tools; complete; score 100 | Same report apart from timestamp and ephemeral URL |
| Oversized second page; each HTTP transport | SIGABRT; no report or snapshot | Exit 1 with `--fail-on error`; one page/tool retained; incomplete; score null |
| Oversized initialization; each HTTP transport | SIGABRT; no report | Exit 2; bounded diagnostic; no invented audit |
| Compare complete and partial snapshots | No partial snapshot to compare | Exit 2; incomplete comparison; zero invented removals |

## Capture and scope

`replay.mjs` starts local servers for HTTP JSON, Streamable HTTP SSE and legacy
HTTP+SSE. Normal controls use the actual MCP SDK server and its transports, with
two paginated definitions. Oversized cases deliberately stream a valid JSON
envelope with 96 repetitions of a 1 MiB ASCII buffer. They are constructed load
cases, not a census of hostile production servers. Original-response construction,
hash/size, attempted write bytes, client commands, stdout/stderr, signals and
timings are retained in `results/before.json` and `after.json`. Large bodies are
specified by their exact prefix, padding and suffix rather than checked in.

Both phases use MCP SDK 1.31.0 for the server/client, with matching package bytes
in the original archive and working checkout. `results/provenance.json` pins
that package and the capture driver. The SDK controls' reports are identical after
excluding only generation timestamps and ephemeral loopback labels. The CLI calls
only initialize, initialized notification and tools/list; it does not invoke tools,
read resources or contact an external server. Child processes alone have the
256 MiB V8 old-space cap. The invoking shell disables core dumps for these deliberate
abort cases. That cap does not describe total resident memory.

## Bound semantics and limits

- HTTP JSON counts actual response bytes supplied by fetch, including automatic
  decompression. A small compressed `Content-Length` cannot bypass it. The new
  regression uses a real gzip HTTP response, not a replaced fetch implementation.
- SSE counts line bytes excluding CR/LF terminators and joined UTF-8 data bytes
  after field prefixes/one optional space are removed. Joined data newlines count.
  Complete comments, retries and overwritten IDs do not accumulate into a
  lifetime stream cap. Independent small events may continue beyond 10 MiB total.
- LF, CR, split CRLF, split Unicode, initial BOM, bare data fields and optional
  space handling are retained. The framing checks use the existing independent
  event parser as a control, following [the HTML event-stream rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation).
- The limit applies before metadata decoding. A transport may have already
  received or queued extra network bytes; attempted server-write counts are not
  client-received or retained byte counts. Timings are single diagnostic captures,
  not throughput benchmarks.
- Legitimate larger responses are now refused. Servers can split tool inventories
  into smaller pages; individual oversized definitions still require smaller
  metadata. Saved file inputs retain their separate limits.
- Schema compilation, tokenization and accumulated retained pages still consume
  memory/CPU. These read bounds do not guarantee an overall heap or runtime bound.

## Reproduce

Build this source or a fresh archive of the original commit, then pass its actual
CLI to the replay. `NEW_WORK_DIR` must not exist yet.

```sh
npm ci
npm run build
ulimit -c 0
node studies/http-bounds/replay.mjs dist/cli.js /tmp/mcplint-http-after after
# Original built CLI:
node studies/http-bounds/replay.mjs ORIGINAL_DIST/cli.js /tmp/mcplint-http-before before
```

Each replay runs nine real CLI workflows: six oversized cases and three SDK
controls. The corrected replay also writes an actual standalone incomplete HTML
audit. Retained snapshots can be compared with the normal CLI; it exits 2:

```sh
node dist/cli.js diff studies/http-bounds/results/after-json-sdk-control.snapshot.json studies/http-bounds/results/after-json-oversized-second-page.snapshot.json --format json
```

`results/diff.json` and `diff.html` are actual CLI outputs. The browser walkthrough
opens both retained HTML files from disk after disconnecting fresh contexts:

```sh
node studies/http-bounds/browser.mjs
```

Chromium and Firefox at 1440 and 375 px show the incomplete audit, unavailable
score, retained page and byte-limit diagnostic. Metadata review keeps collection
gaps explicit and downloads the exact full comparison JSON. All eight views had
no page errors, external requests, accessibility violations or document overflow.
All eight screenshots were inspected. The narrow audit uses its existing internal
coverage-table scroll region. Chromium's file-response bytes match the original
HTML hash; Firefox file navigation exposes no response body, so its receipt
records the exact local path/input hash and that limitation.

| Browser / viewport | Incomplete audit | Metadata comparison |
| --- | --- | --- |
| Chromium, dark 1440 | [capture](../../docs/assets/http-bounds/incomplete-chromium-1440.png) | [capture](../../docs/assets/http-bounds/diff-chromium-1440.png) |
| Chromium, light 375 | [capture](../../docs/assets/http-bounds/incomplete-chromium-375.png) | [capture](../../docs/assets/http-bounds/diff-chromium-375.png) |
| Firefox, dark 1440 | [capture](../../docs/assets/http-bounds/incomplete-firefox-1440.png) | [capture](../../docs/assets/http-bounds/diff-firefox-1440.png) |
| Firefox, light 375 | [capture](../../docs/assets/http-bounds/incomplete-firefox-375.png) | [capture](../../docs/assets/http-bounds/diff-firefox-375.png) |

These are source and local artifact observations. No npm release, version tag or
manual hosted deployment is included.

## Clean and installed verification

Implementation `3c93355ff4d160075a97b500570509ebd6739dae` was checked from a fresh
Node 24.21.0 archive on 2026-10-14. Install, lint, strict types, all 636 tests
in both default and German locales, build, 32 browser checks and both real fixture
servers passed their expected gates. The good server passes; the deliberately
poisoned server fails. Full unit runs used two workers without relaxing assertions
or deadlines. All 525 implementation and 492 baseline archive files match their
original bytes, including after checks. All 188 built files match the working
Node 26 build.

The locally packed 0.3.3 artifact was installed in an empty consumer. All 125
package files match the clean build and consumer. Clean Node 24, installed exact
Node 20.0.0 and installed Node 26.7.0 each passed all nine live workflows plus the
HTML export, with matching report data after only timestamp/ephemeral-URL
normalization. The package is 135,137 bytes, SHA-256
`5d433da9f43eaf281b3dc03cbd781ad1b5edcd06e3b0e5da9a8555c34e0500d6`.
[Verification receipt](results/verification.json) retains commands, file digests,
installed replay receipts and limits. `verify.py` checks the clean build, consumer,
before/after observations and actual browser downloads before writing it.

The source and verification commits are public on `main` at
`70073142eb2316091a16704ec000869bc5e8fafc`. All 51 changed files were fetched
from pinned public raw URLs and matched byte for byte to the clean local source.
[Public source receipt](results/public-source.json) records each size and SHA-256.
The upload response timed out after the body was sent; independent remote-head
and public-byte checks establish publication. No registry release or manual
hosted deployment was performed.
