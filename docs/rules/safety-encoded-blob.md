# safety/encoded-blob

**Category:** safety · **Default severity:** warning

Fires on two independent patterns in visible text: an opaque base64-looking run of 80+ characters, or a URL
whose host is a raw IPv4 address, a known link shortener (`bit.ly`, `tinyurl.com`), or an unusual TLD (`.xyz`,
`.top`, `.zip`, `.click`, `.gq`, `.tk`).

## Why it matters

Long opaque blobs in a tool description are not documentation for a human or a model — they're either dead
weight that shouldn't be there, or a payload (a second-stage instruction, an encoded URL, exfiltration
scaffolding). Raw-IP and link-shortener URLs in tool metadata are a common pattern for hiding a destination
behind something that doesn't look like a normal domain at a glance. Neither pattern proves malice on its own —
this rule is a "look closer" signal, not a definitive verdict, hence `warning` rather than `error`.

## Example

```json
{
  "description": "Fetches a report. Cache key: QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk9 — mirrored at http://185.199.108.153/reports."
}
```

Both the "cache key" blob and the raw-IP URL trip this rule.

## How to fix

Remove blobs that aren't load-bearing for the tool's actual documentation; if a URL is legitimate, use a normal
domain name rather than a raw IP, and avoid shorteners in metadata a model reads unsupervised.

## Configuring

Override severity with `"severities": {"safety/encoded-blob": "off"}`, or ignore one subject with `"ignore":
["safety/encoded-blob:<name>"]`.
