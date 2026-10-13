# Review an update when the audit score stays the same

Source feature, verified 2026-10-12. No registry release or hosted-demo deployment.

## Reproduced gap

At source `cf89f23`, two controlled SDK tools changed their parameter maximum from
100 to 200. Both audits still reported 100/100, zero findings and 137 estimated
tokens. The JSON report omitted the definitions. [Before receipt](before.json)
and independent server replies in [fixtures/](fixtures/) retain that result.
This is a deliberately controlled contract change, not an attack example.

The new `--snapshot` collector retains decoded list entries before lint
projection. `diff` identifies both changed bounds and includes the actual old/new
values. It also compares instructions, capabilities, prompts, resources,
templates and unknown list fields. The [user guide](../../docs/metadata-review.md)
defines identities, formats, exit codes and boundaries.

| Actual SDK revision | Diff exit | Result |
| --- | --- | --- |
| Bounds only | 1 | 2 changed definitions, both 100 to 200 |
| Mixed update | 1 | 1 added, 1 removed, 5 changed, 1 unchanged |
| Reordered lists | 0 | Same metadata; no changes |
| Failed second tool page | 2 | Incomplete; 1 unpaired definition, no removals |
| Duplicate tool name | 2 | Incomplete; duplicate entries are not paired |

Counts include the server metadata entry. [Retained captures](results/) include
snapshots, server reply transcripts, comparison JSON and audit observations.
The replay compares each saved definition with the separate server transcript.
It never calls tools. HTML files are regenerated, not checked in.

```sh
npm ci
node studies/metadata-diff/verify.mjs dist/cli.js /tmp/mcplint-metadata-review
node dist/cli.js diff /tmp/mcplint-metadata-review/before.snapshot.json /tmp/mcplint-metadata-review/after.snapshot.json --format html --output /tmp/mcplint-metadata-review/changes.html
```

The last command intentionally exits 1. Use a new output directory for captures
you want to preserve: the study script replaces its own named fixture outputs.
To replay the original gap against an archived baseline build:

```sh
node studies/metadata-diff/baseline.mjs /path/to/baseline/dist/cli.js
```

## Real dependency-resolution control

The official `@modelcontextprotocol/server-filesystem@2025.8.21` package was
installed twice on this date. One resolution uses Zod 3.25.76 and the other
4.6.7. All installed package records except `node_modules/zod` are identical,
as is the compiled server entrypoint (SHA-256
`ce7bdceccfac6d848687bc7067167c72269bc3dbb6312261f5e9b9f481286ec7`).
The captured server info is identical too.

Under Zod 3, `read_text_file` declares `path`, `head` and `tail`, requires `path`,
and disallows additional properties. Under Zod 4 its input schema contains only
`$schema`. Across the 14 tools, **13 schemas change**; the no-argument
`list_allowed_directories` schema stays the same. The diff exits 1 with complete
coverage, 13 changed and 2 unchanged entries including server metadata.

An independent newline JSON-RPC probe, written without the MCP SDK or mcplint
parsers, initializes the same process and requests `tools/list`. Its raw decoded
entries equal the collected snapshot entries in both resolutions. No tool was
called, no resource contents were read, and the allowed filesystem root was an
empty temporary directory.

These are **current installations of a pinned historical package**, not a claim
about its original publication environment or the latest server release. The
experiment demonstrates an observable dependency-driven metadata regression;
it does not test whether tool execution succeeds under either resolution.

The [package receipt](reference/package.json) records registry integrity and
upstream commit `b5ba7184b9c3024a3101cb665de603abbe91ea87`.
[Dependency locks](reference/locks/), [raw replies and snapshots](reference/captures/)
and the [upstream MIT notice](reference/LICENSE-server-filesystem.txt) are retained.
The notice was fetched at that pinned upstream commit.

Reconstruct both installations without resolving newer transitive versions:

```sh
mkdir -p /tmp/mcplint-zod3 /tmp/mcplint-zod4
cp studies/metadata-diff/reference/locks/zod3.json /tmp/mcplint-zod3/package-lock.json
cp studies/metadata-diff/reference/locks/zod4.json /tmp/mcplint-zod4/package-lock.json
node --input-type=module -e 'import fs from "node:fs"; for (const p of process.argv.slice(1)) { const lock=JSON.parse(fs.readFileSync(p+"/package-lock.json")); fs.writeFileSync(p+"/package.json",JSON.stringify(lock.packages[""])); }' /tmp/mcplint-zod3 /tmp/mcplint-zod4
npm ci --prefix /tmp/mcplint-zod3 --ignore-scripts --no-audit --no-fund
npm ci --prefix /tmp/mcplint-zod4 --ignore-scripts --no-audit --no-fund
node studies/metadata-diff/reference.mjs /tmp/mcplint-zod3 /tmp/mcplint-zod4 /tmp/mcplint-reference-capture
```

## Browser and performance checks

```sh
node studies/metadata-diff/browser.mjs /tmp/mcplint-metadata-review /tmp/mcplint-metadata-browser
node studies/metadata-diff/benchmark.mjs /tmp/mcplint-metadata-benchmark.json
```

The [browser receipt](browser.json) covers actual offline Chromium and Firefox at
1440 px/dark and 375 px/light. Each workflow filters changes, displays the old/new
bound, downloads full unfiltered JSON, toggles the theme, and reviews the partial
collection report. Sixteen downloads match the CLI JSON. All four screenshots
were inspected; there were no page errors, external requests, CSP violations,
page overflow or axe violations in the inspected filtered state.
[Desktop](../../docs/assets/metadata-review/chromium-1440.png) and
[phone](../../docs/assets/metadata-review/firefox-375.png) examples.

Browser regression tests additionally page 24 changed definitions and 13 fields,
display long values with a bounded preview, preserve the full download, and
render script-closing text, an image event handler and a bidi control as inert
text. They run in both browsers at both widths.

[Synthetic timing](benchmark.json): 4,000 definitions, ten schema parameters each,
400 changed bounds; each snapshot is 3,755,175 bytes. Five measured in-memory
comparisons after one warm-up had a median of 212.2 ms on Node 26.7.0, Linux x64
under WSL2, 14 logical CPUs and about 47 GiB reported memory. This excludes live
collection, file decoding and HTML rendering; it is not a production latency
claim. Full values remain in JSON; the DOM pages definitions and fields.
