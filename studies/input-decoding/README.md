# Audit the supplied text, or reject its encoding

The file reader previously used replacement decoding. Invalid bytes inside a
JSON string became U+FFFD before parsing, so a damaged tool description could
receive a complete, 100/100 audit. The same reader silently changed configuration
and environment-file values before launching a server.

Decoding now fails on malformed UTF-8 or UTF-16. No audit is produced from the
altered text. Valid UTF-8 (with or without a BOM), UTF-16LE and UTF-16BE with a BOM
remain supported. An intentionally written U+FFFD is valid; its presence alone
does not imply corruption. Valid supplementary characters remain intact too.

| Supplied bytes | Before | After |
| --- | --- | --- |
| Invalid UTF-8 in a tool description | Complete, score 100, exit 0 | No audit, exit 2 |
| Unpaired UTF-16 surrogate in either byte order | Complete, score 100, exit 0 | No audit, exit 2 |
| Invalid UTF-8 in server config environment | Server launched with changed value | No launch or audit, exit 2 |
| Invalid UTF-8 in per-server `envFile` | Server launched with changed value | No launch, incomplete audit, exit 1 |
| Valid UTF-8/BOM/UTF-16 controls | Accepted | Accepted |

## Reproduce the actual CLI behavior

[Before](results/before.json) was captured against the installed packed build of
`2c04bc0`; [after](results/after.json) uses the updated source. Five of nine cases
disagree with the intended behavior before the fix, and none afterward. The
capture writes byte-damaged files directly and uses a local stdio fixture whose
request log proves whether initialization happened. The valid controls contain
an accent, a literal replacement character and a supplementary character.

```sh
npm ci
node studies/input-decoding/capture.mjs dist/cli.js --check
```

An alternate built or installed CLI path can replace `dist/cli.js`. Omit
`--check` to retain the behavior of a version known to fail. Additional byte-level
regressions cover stray continuation bytes and truncated UTF-16 code units.

The files and environment values are synthetic; no remote server or real
credential is used. This does not detect text already corrupted before it was
saved as valid Unicode, guess legacy encodings, or reject every unusual but valid
Unicode character. These changes are source updates, not an npm release.
