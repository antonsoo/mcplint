# safety/unchecked

**Category:** safety. **Default severity:** error.

A rule could not finish checking metadata, or the schema text walk reached a
limit. The finding names the failed rule or input/output schema and the reason.
Unsupported JSON Schema dialects, mixed dialect resources, unresolved references and compiler
limitations also produce this finding. Both input and output schemas are checked. A schema that
fails meta-schema validation instead gets `schema/invalid`; this is a known defect, not an unfinished
check. Other rules continue. A schema limit retains the scanned text, and sibling tools
still receive their safety checks.

The text walk inspects JSON strings and keys, including structured literals and
custom keywords. Its limits per schema are 128 levels, 20,000 visited values and
2,000,000 UTF-16 text units. Cyclic library inputs are reported rather than followed
forever. External `$ref` URLs are never fetched.

The schema compiler uses the same preflight limits and does not inline references. Its resource
registry is cleared after each field, including failed compilations: a schema in a different tool
or a previous audit cannot satisfy an otherwise unresolved reference. Compiler instances are
replaced after 32 checks to release Ajv's retained code-generation bookkeeping too.

An unfinished check sets `summary.complete` to false and `summary.score` to null.
The report says "Incomplete audit" and "Score: unavailable". With either
`--fail-on` threshold, it exits 1 even when the diagnostic is suppressed or
assigned a lower severity.

Reduce oversized metadata or fix the field named in the error, then rerun. A rule
failing on ordinary valid MCP metadata is a bug in mcplint; report a minimal,
non-sensitive example. See [collection coverage](../collection-coverage.md) for
scope, limits and library output changes.
