# Valid SSE comments could block initialization

At `49fd2169d9a700b2132862fe901679cc690c2c7f`, the HTTP byte guard searched the
remaining chunk for both CR and LF on every line. An LF-only chunk repeatedly
searched its entire suffix for a CR that was absent; CR-only streams had the
same problem. The guard's message limits did not bound this quadratic work.

The repair caches the next position of each separator. A search advances only
after that position has been consumed. Each byte can be searched once for CR
and once for LF in a chunk. Line/event byte limits, BOM handling, split CRLF,
raw wire bytes and the SDK's own parser behavior remain unchanged.

## Reproduction

These are **synthetic valid SSE comment streams**, not captured production
traffic. Short comments are permitted by the
[HTML event-stream parsing rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream).
The host was 14-vCPU WSL2 Linux with 48 GB RAM, Node 26.7.0, with concurrent
workloads. Timings describe these observations, not an isolated benchmark.

[`scaling.mjs`](scaling.mjs) feeds 16 KiB, 64 KiB, 256 KiB and 1 MiB chunks to
the real guard, three repetitions per size and line ending. Exact inputs and
all timings are retained [before](results/scaling-before.json) and
[after](results/scaling-after.json).

| 1 MiB comment chunk | Baseline median | Repaired median |
|---|---:|---:|
| LF | 6019 ms | 70.5 ms |
| CR | 5922 ms | 80.3 ms |
| CRLF (one byte shorter) | 66.9 ms | 48.7 ms |

A deterministic regression counts bytes covered by the actual separator
searches instead of asserting a timing threshold. For 8,192 bytes of LF-only
comments the baseline searched 16,789,504 bytes; the repair searches at most
16,384. Mixed endings, repeated comments and existing exact-limit checks remain
covered alongside the independent `eventsource-parser` framing controls.

[`replay.mjs`](replay.mjs) also exercises `guardHttpResponse` and the actual MCP
SDK HTTP client against an ordinary loopback server. The server sends one valid
tool definition after comments; it executes no tools. Initialization and
`tools/list` use a 5,000 ms connection budget.

| Loopback response prefix | Baseline | Repaired source |
|---|---|---|
| No comments | Complete collection, 0.040s | Identical metadata, 0.036s |
| 1 MiB of comments | Initialization timeout, returned after 6.76s | Complete collection, 0.170s |
| 12 MiB of short comments | Initialization timeout, 5.08s | Complete collection, 2.23s |

The 12 MiB case contains many completed short lines. It does not exceed the
10 MiB **per-line or joined-event-data** limit; imposing a lifetime stream limit
would incorrectly reject it. A complete single-chunk 1 MiB response through
`guardHttpResponse` also fell from 3202 ms to 71.7 ms, with identical output
bytes and no integrity failures. Its zero-delay timer records the event-loop
delay in the receipt. [Before](results/before.json), [after](results/after.json).

This change bounds the guard's separator searches. It does not promise a hard
wall-clock parsing deadline, a bound on a server's total stream duration, or
linear behavior in every downstream SDK/parser operation. CR-heavy behavior in
the third-party event parser is outside this repair.

## Run it

After `npm ci` and `npm run build`, from the repository root:

```bash
node studies/sse-scan/scaling.mjs dist /tmp/sse-scaling.json
node studies/sse-scan/replay.mjs dist /tmp/sse-replay.json verify
npx vitest run tests/collectors/http-bounds.test.ts
```

To replay another compiled checkout or an installed package, replace `dist`
with its distribution directory. Omit `verify` when observing the baseline's
connection failures. The scripts retain hashes for the input and tested modules.

The working source passes all 640 tests, lint and type checking. These are source
changes; no npm registry release or hosted deployment is implied.

## Clean and installed package checks

A clean archive of `d0e0a09` was installed with `npm ci`: lint, type checking,
all **640 tests on Node 20.20.2**, build and `npm pack` pass. All 125 files in
the tarball match both the clean build and a separate installation byte-for-byte
(including 94 distribution files). The installed CLI's complete fixture JSON
matches the clean CLI except for its generation timestamp.
[Artifact hashes and comparison scope](results/artifacts.json).

The installed package also replays every guard and loopback case on
[Node 20.20.2](results/packed-node20.json) and
[Node 26.7.0](results/packed-node26.json). All repaired collections match the
source metadata exactly, including the 12 MiB stream within the same 5,000 ms
initialization budget. The three compiled modules' hashes match the source build.
No browser code changed in this HTTP collector repair.
