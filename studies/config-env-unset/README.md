# Explicitly removed environment variables must stay absent

On baseline `f9900d198a9dc5e86f5e4ffe9c0c19a041839874`, mcplint discarded
`null` values in a client's `env` map. Its stdio collector then inherited the
parent's value, or a value from `envFile`. The resulting audit could be complete
while describing a server launched with the wrong credentials or settings.

This study uses a synthetic local server, with no external account or network
service. It always advertises `read_records` and adds `write_records` when its
fake `MCPLINT_FIXTURE_TOKEN` is nonempty. The parent supplies `parent-token`;
the config explicitly removes it with `null`.

| Child launch | Before | Corrected |
| --- | --- | --- |
| Remove parent token | Token inherited; 2 tools | Token absent; 1 tool |
| Remove token from envFile | File token retained; 2 tools | Token absent; 1 tool |
| Remove inherited TERM | Parent TERM retained | TERM absent |
| Empty token string | Empty string; 1 tool | Empty string; 1 tool |
| No override | Parent token; 2 tools | Parent token; 2 tools |

All baseline audits reported complete. The failure was the child environment,
not a failure to enumerate the child that actually started.

## Semantics and correction

[VS Code's configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
allows null environment values. Its
[process launcher](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/node/extHostMcpNode.ts)
loads the environment file before applying configured entries and converts null
to an absent child variable. This was checked against the upstream source on
2026-10-12. The three config layouts tested here are `servers`, `mcp.servers`,
and `mcpServers`; mcplint applies the same explicit-removal behavior to each.

mcplint now retains null through config parsing and environment-file merging.
At the SDK boundary it converts null to an own property with value `undefined`.
That property must survive the SDK's default-environment merge: deleting it
would restore variables such as `TERM`. Node's spawn omits the undefined value.
The SDK's environment type permits only strings, so the boundary has a documented
type assertion, exercised through real SDK launches on the supported Node floor.
The parent process environment is never edited by the collector.

On Windows, all existing case variants of an overridden name receive the same
value before Node chooses a spelling. Node documents its case-insensitive
[environment selection](https://nodejs.org/api/child_process.html#child-process).
The retained process executions are on Linux/WSL2; no Windows or macOS runtime
claim is made. This change does not establish full behavioral equivalence with
every MCP client's launcher.

## Reproduce

After `npm ci`, run from the repository root:

```sh
python3 studies/config-env-unset/replay.py --node "$(command -v node)" --cli dist/cli.js --out /tmp/mcplint-env-after.json
```

The runner launches the actual CLI 36 times: twelve explicit cases across three
config layouts. It checks the actual child environment, advertised tool names,
CLI tool count, completion state and exit code against literal expectations.
It records only four named synthetic environment values. It never serializes
the ambient environment. `null`, empty strings, the string `"null"`, zero,
false, unchanged inheritance, file values and explicit overrides remain distinct.
The integration regression additionally launches removed/inherited/empty
configurations sequentially and verifies that one server's removal does not
affect the next server or parent.

The retained [baseline](results/before.json) matches 21/36 cases; the
[corrected Node 24 run](results/after-node24.json) matches 36/36.
These are controlled fixtures, not observations of a real credential leak or
evidence that any public MCP server was affected.
