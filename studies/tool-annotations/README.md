# A string "false" is not a boolean hint

The built CLI previously gave a tool with four string-valued behavior hints a
complete, 100/100 audit with no findings and exit 0 under `--fail-on error`.
The installed MCP SDK's strict `listTools()` rejected the same response. mcplint
intentionally collects leniently so one malformed tool cannot hide valid
siblings, but its own annotation checks stopped at the outer object.

The [2026-07-28 ToolAnnotations definition](https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations)
declares a string title and four boolean hints. The
[2025-11-25 definition](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts)
used by the installed SDK has the same field types. No field is required.
These are declarations, not evidence that the tool behaves as claimed.

| Declaration | Result |
| --- | --- |
| `readOnlyHint: false` | Valid boolean declaration |
| `readOnlyHint: "false"`, `0`, `null`, array or object | Incomplete collection; no whole-audit score |
| `title: ""` | Valid string |
| `title: 42` or `null` | Incomplete collection; no whole-audit score |
| Omitted annotations or unknown extension properties | Accepted |

The fix checks the known fields without coercing them. Up to three entry indices,
field paths and expected types appear in the coverage diagnostic. All tool
records remain available, including raw annotation objects. A valid title beside
an invalid hint still reaches the existing safety rules. Nonboolean hints also
stop satisfying the destructive-name rule's request for a boolean declaration.
Suppressing either diagnostic cannot make incomplete collection complete.

## Evidence and reproduction

[Before](results/before.json) uses the installed packed build of `2c04bc0`;
[after](results/after.json) uses this source. The three sets are string hints
alone, mixed valid/malformed tools, and valid controls. Each runs through both
saved JSON and a real stdio server. A separate strict SDK client requests each
list, and the SDK's `ToolSchema` independently checks each tool.

Four of six scenarios disagreed before the fix; none disagree afterward. Both
valid controls preserve their earlier findings and score. Mixed lists retain all
five tools and still report the synthetic secret-access instruction in a valid
title beside an invalid hint. The pure string-hint case now exits 1 with an
incomplete audit and a null score, instead of exit 0 and 100.

```sh
npm ci
node studies/tool-annotations/capture.mjs dist/cli.js --check
```

Pass another built or installed `dist/cli.js` to compare versions. The capture
script resolves its SDK oracle from that CLI's installation. To capture a known
failure, omit `--check`. Regressions additionally compare all five known fields
against the SDK, including wrong scalar/container types, valid false values,
extensions, suppressed diagnostics and usable titles.

All fixtures are synthetic. No remote MCP server is contacted and no tool is
called. A read-only scan of the existing 25,808-tool registry cache found no
retained annotation objects, so that cache cannot estimate this defect's
prevalence. This is a source update, not a registry release or a behavioral
security assessment of the described tools.
