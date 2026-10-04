# collection/incomplete

**Category:** collection. **Default severity:** error.

Some requested metadata could not be collected or decoded completely. Examples
include a failed list request, repeated pagination cursor, exceeded list limit,
malformed list entry, unavailable config server, or an unresolved config input.
Valid entries and fields remain available to the other rules.

Every finding names the server and collection scope. The full collection record
also appears in each report, with pages and received/retained entry counts.
An intentionally disabled server and an unadvertised capability are recorded
separately; neither produces this error.

Fix the reported gap and rerun. For a saved page carrying `nextCursor`, obtain a
complete export. For a missing config input, supply it with `--input id=value`.

Severity overrides and ignores can suppress the finding, but the incomplete status
and unavailable score remain. Either `--fail-on` threshold fails incomplete audits.
See [collection coverage](../collection-coverage.md) for bounds and output semantics.
