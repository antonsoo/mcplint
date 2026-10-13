# Review MCP metadata changes

Available in the source checkout; not yet released to npm. A lint score describes
one collection. A snapshot comparison answers which recorded definitions changed
between two collections, even when both audits have the same score and findings.

## Capture, update, compare

Use the same target and stable server IDs for both captures:

```sh
node dist/cli.js config .mcp.json --snapshot before.json
# Update the server or its dependency lock, then collect again.
node dist/cli.js config .mcp.json --snapshot after.json
node dist/cli.js diff before.json after.json --format html --output changes.html
```

`--snapshot` also works with `stdio`, `http` and `file`. Collection still produces
the usual lint report and retains its existing audit exit behavior. Use
`--fail-on warning` or `--fail-on error` to fail that audit on incomplete collection
or findings. Snapshot files must be new: an existing baseline is never replaced.
Choose a new filename for another capture. Report output cannot alias a snapshot.

`config` uses the configured server key as its identity. Direct live targets use
the collector's server ID, normally the advertised server name; `file` uses
`file`. A renamed ID appears as additions and removals. Keep the same config keys
when comparing an upgrade. IDs are labels, not authenticated server identities.

Live capture starts or connects to the supplied server and initializes it. It
requests supported lists, following pagination; it does not call tools, read
resource contents or obtain prompt expansions. Starting a server can itself have
effects. Saved-file collection only covers the supplied arrays, not a live
inventory. A single-target connection failure exits without writing a snapshot;
config captures retain failed and disabled entries as incomplete coverage.

## Read the result

| Diff exit | Meaning |
| --- | --- |
| 0 | Recorded metadata is unchanged within the recorded scope. |
| 1 | Complete comparison with added, removed or changed metadata. |
| 2 | Incomplete collection, ambiguous identities, invalid input or another error. |

An incomplete comparison can still show changes between uniquely matched
definitions. Missing records in an incomplete scope are **unpaired**, not
classified as removed or added. Duplicate identities remain unpaired even when
their values happen to be identical. An explicitly unsupported scope is a known
empty inventory; enabling that capability can therefore show additions.

The summary counts server metadata entries as well as list definitions. The
terminal report prints changed JSON Pointer paths and bounded value previews:

```text
CHANGED metadata-review-fixture | tools/list | search_records
  /inputSchema/properties/limit/maximum
  - 100
  + 200
```

The HTML report filters by server, scope, identity or changed path. It pages
definitions and fields, escapes invisible formatting characters, and previews
the first 6,000 characters of long values. Its download always contains the full,
unfiltered JSON comparison with original strings. It is a self-contained file:
no remote fonts, icons, scripts or analytics. `--format json` also writes the
complete comparison directly. Only terminal, JSON and HTML formats apply to diff;
audit-specific options such as `--fail-on` do not apply.

## What is saved and compared

| Record | Matching key | Saved values |
| --- | --- | --- |
| Server | Server ID | SDK-exposed server info, capabilities and instructions |
| Tool | Server ID + `tools/list` + `name` | Entire decoded list entry |
| Prompt | Server ID + `prompts/list` + `name` | Entire decoded list entry |
| Resource | Server ID + `resources/list` + `uri` | Entire decoded list entry |
| Resource template | Server ID + `resources/templates/list` + `uriTemplate` | Entire decoded list entry |

Snapshots retain malformed entries and extension fields such as `_meta`, icons
and execution declarations before projecting the fields used by lint rules.
Collection coverage records accompany the values. A versioned envelope validates
server references, counts, duplicate scopes and finite JSON values when read.
Ordinary lint JSON reports are not snapshots: they do not retain these entries.

Saved tool inventories (`file`) and imported metadata snapshots are checked
before their decoded values enter an audit or comparison. Duplicate object
fields, including escaped spellings of the same name, are refused. Numbers
that overflow, underflow to zero or change decimal value when JavaScript
serializes them are also refused. For example, `9007199254740993` must not become
`9007199254740992` and make a changed constraint appear unchanged. Exit 2 leaves
an earlier report intact and creates no snapshot from the unsupported input.
[CLI reproduction and retained controls](../studies/json-integrity/README.md).

Equivalent numeric spellings such as `100`, `100.0` and `1e2` remain accepted,
as do ordinary decimals such as `0.1`. This checks decimal serialization, not
exact binary floating-point arithmetic. Keep numeric schema constraints numeric;
use a string representation only where the producer's schema permits one.
Duplicate definitions in an array are still retained and handled by the existing
identity/coverage rules; they are different from duplicate fields in one object.
Saved JSON has a 128-container nesting limit. Diagnostics identify the problem
without quoting the offending field name or numeric literal.

This check needs the original JSON text. It cannot recover values already lost
in an older snapshot, a caller-supplied JavaScript object, or the MCP SDK's live
transport decoding. Live snapshots still record SDK-decoded metadata. Client
configuration and lint-configuration parsing are separate from these metadata
input checks.

Object key order and list-entry order do not count as changes. Arrays **inside**
an entry remain ordered; strings remain exact; an absent key differs from `null`.
Objects are compared at changed fields, while an array change displays the whole
array. Paths follow [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901): `~`
becomes `~0`, `/` becomes `~1`, and the empty pointer denotes the whole value.
No JSON Schema compatibility or semantic equivalence is inferred.

The displayed SHA-256 identifies the canonical decoded snapshot, including its
capture timestamp and recorded list order. It is not the hash of the original
file bytes, a signature or an approval record. It can differ for snapshots whose
compared metadata is unchanged. Capturing and comparing never approves a new
baseline automatically.

## Limits

- A snapshot compares decoded JSON. JavaScript number decoding can lose precision
  for large integers; duplicate object keys and original whitespace are not
  preserved. It is not a wire-byte archive.
- Initialization metadata is limited to the fields exposed by the client SDK.
  Unknown initialization-envelope extensions and transport headers are outside
  the snapshot. List entries retain their decoded extension fields.
- Scopes absent from both saved files are outside the comparison. A scope missing
  from only one side, a disabled target or an incomplete page prevents an
  unchanged-inventory conclusion. Simultaneous capture omissions and forged
  coverage cannot be detected from the saved files alone.
- Collection is bounded by the existing [coverage limits](collection-coverage.md).
  Snapshots additionally have a 50 MiB byte limit, one million JSON nodes and
  128 nesting levels. Exceeding a bound fails explicitly; it does not truncate a
  snapshot into an apparently complete baseline.
- Launch labels, config values, environment variables, command arguments and
  HTTP headers are not intentionally copied into snapshots. Server-provided
  definitions, instructions and identifiers can themselves contain sensitive
  information; the files preserve those values.
- Unchanged metadata establishes neither unchanged code nor unchanged behavior.
  A server can advertise benign text and act differently. Annotations remain
  server claims, as the [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
  describes. This is a review aid, not an authorization or safety verdict.
