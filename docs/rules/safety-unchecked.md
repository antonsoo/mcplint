# safety/unchecked

**Category:** safety · **Default severity:** error

Reported when another rule fails to run on a server's metadata. It is not a check of its own: `mcplint` emits it
in place of the rule that failed, naming that rule and the error.

## Why it matters

Server metadata is untrusted input. If one malformed field could make a rule throw, a linter that stopped
there, or carried on as if that rule had passed, could be evaded: put the malformed field next to a poisoned
description and the scan never reports it. So a rule that cannot run is an error finding. The other rules still
run, the score drops, and `--fail-on error` fails the build. The server is unverified, not clean.

## Example

No metadata is known to trigger this: every malformed shape found so far (by fuzzing the three reference
servers' tool lists with fields dropped, duplicated, renamed and replaced by values of the wrong type) is handled
by the rules themselves. This finding is the backstop for a shape nobody has thought of yet. This is what it
looks like, from a test that makes `description/param-missing` throw on an otherwise clean one-tool server:

```
  ✖ s1 (server, s1)
      error   safety/unchecked  Rule description/param-missing could not run on this server's
                                metadata, so that check was not made.
              -> Treat the server as unverified for this rule. The metadata is malformed in a way
                 the rule did not expect; fix the metadata, or report the input at
                 https://github.com/antonsoo/mcplint/issues.

  Findings: 1 error, 0 warning, 0 info
  Score: 90 / 100
```

## How to fix

Fix the metadata the named rule tripped over (the finding's detail carries the error). If the metadata is valid
MCP, it is a bug in mcplint: please report the input.

## Configuring

Override severity with `"severities": {"safety/unchecked": "warning"}`. Turning it off is possible but not
recommended, since it hides exactly the case it exists for.
