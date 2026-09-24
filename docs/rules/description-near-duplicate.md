# description/near-duplicate

**Category:** description · **Default severity:** warning

Fires when two differently-named tools (descriptions at least 20 characters each) have &ge;75% word-overlap
(Jaccard similarity over normalized, lowercased, 3+ letter words) in their descriptions.

## Why it matters

Word-overlap similarity above the threshold usually means the model can't reliably tell the two tools apart
from their descriptions alone, and will pick between them close to at random. This is a real finding, not
theoretical — linting the reference `@modelcontextprotocol/server-filesystem` server surfaced a genuine 88%
overlap pair (`list_directory` and `list_directory_with_sizes`; see the README's "Real-world run" section).

## Example

```json
[
  { "name": "delete_customer", "description": "Permanently deletes a customer account and all associated billing records from the system." },
  { "name": "delete_customer_record", "description": "Permanently deletes a customer record and all associated billing records from the system." }
]
```

85% word overlap. Fix: make the difference between the two tools explicit in each description (what makes
`delete_customer` different from `delete_customer_record`? if nothing does, they should probably be one tool).

## How to fix

Either merge the two tools if they really do the same thing, or rewrite both descriptions to foreground what
actually distinguishes them.

## Configuring

Override severity with `"severities": {"description/near-duplicate": "off"}`. Because this rule compares pairs,
per-subject `ignore` suppresses findings *starting from* the named tool — `"ignore":
["description/near-duplicate:<toolName>"]`.

## Limitations

This uses word-overlap (Jaccard similarity), not semantic similarity — it will miss paraphrases that reuse
different words for the same meaning, and can over-trigger on two tools that legitimately share a lot of
domain vocabulary (e.g. two tools that are both, correctly, about invoices).
