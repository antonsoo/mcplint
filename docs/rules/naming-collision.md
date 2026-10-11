# naming/collision

**Category:** naming · **Default severity:** error

Fires when a tool name appears more than once within one server, or is exposed
by multiple servers in the same run. Names are compared exactly, including case.
Single-server `stdio`, `http` and `file` audits check repeated names too.

## Why it matters

MCP calls identify tools by name. Two definitions called `read_record` with
different schemas leave no way for a caller to select a particular definition.
Even identical repeated entries can indicate overlapping list pages or duplicate
registration. The [MCP tool-name guidance](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names)
recommends unique names within a server; this linter treats violations as errors
by default. This is a lint policy, not a claim that the spec says MUST.

Clients combining several servers should disambiguate their shared names, for
example with server prefixes. A cross-server finding identifies the need for
that disambiguation; it does not prove that a particular client shadows a tool.

## Examples

A saved `tools/list` with two `read_record` entries reports:

```text
"read_record" occurs 2 times in server "file"'s tool list; calls address tools by name and cannot select a definition.
```

Two configured servers both exposing `search` report:

```text
"search" is exposed by 2 servers: docs, web.
```

There is one within-server finding per repeated name per server, plus one
cross-server finding per shared name. All definitions remain available for
schema, safety and token checks. Collection can be complete while containing
these errors; `--fail-on error` still exits 1.

## How to fix

Assign each distinct tool a unique name. Remove duplicate registrations and
overlaps between pages of `tools/list`. When aggregating servers, add a
server-specific prefix such as `docs_search` and `web_search` if your client
does not already disambiguate them.

[Saved-list, paginated SDK and registry reproductions](../../studies/duplicate-names/README.md).

## Configuring

Override severity with `"severities": {"naming/collision": "off"}`, or ignore a
specific name with `"ignore": ["naming/collision:<toolName>"]`. These settings
apply to both within-server and cross-server findings.
