# What 11,545 real tool definitions cost, and what they did to mcplint

[Smithery](https://smithery.ai), a public MCP registry, publishes for each server it lists the tool
definitions that server returned when the registry connected to it: the names, descriptions and input
schemas a client puts in a model's context. This study reads them for 444 of the 19,041 servers the registry
lists, 418 of which publish tool definitions, and runs mcplint over all of them without starting or
contacting a single server. The rules were then reworked on those servers, so a second slice of 886 servers
that the rules had not seen was run once, frozen, and read by hand.

All token figures are o200k_base counts, GPT-4o's vocabulary: an estimate for any other model.

The rule comparisons below are frozen at `b1438c0`. The subsequent
[schema audit](../schema-audit/README.md) reuses these retained snapshots, adds output-schema checks,
and distinguishes incomplete reference checks from definite schema errors. Its changed findings are
reported separately; the historical totals below have not been rewritten.

**What came out**

- **About one server in fifteen (28 of 418, 6.7%) costs more than 16,000 tokens of tool definitions if a
  client loads them all; the median server costs 1,700.** Counted as a model receives them: name,
  description and input schema. Adding output schemas, which the budget used to count, gives one in ten, and
  that was the headline in the first version of this study. The server with the highest use count defines 2,530
  tools: 202,728 tokens.
- **The median tool costs 113 tokens, one in ten costs more than 374, and the largest costs 7,093.** On a
  random slice of 886 other servers the median server costs 1,196 tokens and 4.2% (37) exceed 16,000. The
  census is not a sample of the registry.
- **mcplint's attack rules were wrong about real servers.** The released 0.3.3 reported 14 errors from its
  prompt-injection and secret-access rules on the 418 servers. None was credential exfiltration or a prompt
  injection: an agency code `OECD.ENV`, "no API key needed). Returns ready-to-run YAML", a tool that parses
  `.env` files, a scanner whose description names what it scans for, and a description that asks the model to
  send USDC to a wallet.
- **After the rework, 0 errors and 2 warnings on those servers, which is in-sample.** The rework was made while
  reading those findings. On the 886 servers not used for it, the frozen rules report 5 errors and 7 warnings
  (0.3.3: 36 and 39). Read by hand, none of the 5 errors is an attack: 2 are false alarms and 3 are real
  zero-width spaces in marketing copy. The false-alarm rate on unseen servers is not zero.
- **One of the three published poisoning examples was an error in 0.3.3 and is a warning now**
  (Invariant Labs' WhatsApp takeover); the other two are still errors.

## The servers

`collect.mjs` reads two views of the registry's listing: the first 500 rows of its default ordering, and the
verified view (`q=is:verified`). The default ordering is not by use count (the first page runs 87,579; 57,738;
22,491; 43,392; ...). The listing also repeats rows across pages: the 500 rows are 266 distinct servers. The
verified view has the same cap and repeats, so it is not all verified servers: it returned 183, and 11 more
that carry the verified flag arrived through the first view. [`manifest.json`](manifest.json) lists the 444
servers and when the listing was read (8 October 2026); everything comes from the registry's own API.

| | |
|---|---:|
| Servers the registry lists | 19,041 |
| Servers in the two views | 444 |
| with published tool definitions | 418 |
| Tool definitions | 11,545 |
| Tools per server: median, 90th percentile, largest | 9, 46, 2,530 |

The 26 servers without tool definitions have an empty list (12) or none (14, `tools: null`). 19 of them carry
the verified flag and 14 are not remote servers, which the registry may not be able to connect to. They are
dropped, so the census holds the servers the registry could read, not all that it lists.

`useCount` is the registry's own number and I do not know what it counts. 82 of the 444 servers have a use
count of 0 (all arrived through the verified view); the 266 default-ordering servers start at 1,304. The 418
servers belong to 292 owners, the largest being 33 servers; 54 are registry-owned (`brave`, `gmail`). 95 of
the 11,545 tool definitions repeat another's name, description and schema exactly. `pipeworx/gateway` defines
21.9% of all tools and 9.7% of all tokens; without it the per-tool median is 138 and the 90th percentile 428.

## What a tool list costs

A tool is counted as `{name, description, inputSchema}` in compact JSON. That is what the model is given in
the two API formats I checked on 8 October 2026: the Anthropic Messages API tool is `name`, `description` and
`input_schema` (the tool examples on the [token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)
page), and an OpenAI function tool is `type`, `name`, `description`, `parameters` and `strict`, with no
output schema field and function definitions counted as input tokens
([function calling](https://developers.openai.com/api/docs/guides/function-calling)). Neither has a field for
an MCP output schema or annotations. I did not inspect an MCP client; one may send more. The first version of
this study counted output schemas and annotations on the assertion that clients do, which no source backed.

| Tokens | Median | 75% | 90% | 95% | 99% | Largest |
|---|---:|---:|---:|---:|---:|---:|
| per tool | 113 | 210 | 374 | 548 | 1,050 | 7,093 |
| per server | 1,700 | 4,322 | 11,870 | 21,801 | 49,109 | 202,728 |

11% of servers cost more than 10,000 tokens, 6.7% (28) more than 16,000 and 3.8% more than 25,000; one costs
more than 100,000. These are costs *if the whole list is loaded*: a client that searches tools or loads them
on demand pays less. Output schemas, if a client sent them, would add 25.0% to all tokens, and 42 servers
(10.0%) would exceed 16,000.

Anthropic's documentation says its token-counting endpoint returns an estimate and needs an API key, which this
study did not use, and that Claude Opus 4.7 and later models produce about 30% more tokens for the same text
than earlier ones. So a count from a Claude model may differ from o200k_base in either direction; I did not
measure by how much.

mcplint's default budgets are round numbers, not percentiles of this table: 400 tokens for a tool, which 8.9%
of these tools exceed, and 16,000 for a server, 8% of a 200,000-token window, which 6.7% of these servers
exceed. 0.3.3 used 400 as well. The first version of this study raised it to 550 because 400 flagged 15% of
tools; that was the output-schema count, and the raise is undone. A finding at or beyond the 90th percentile
says where the tool or server stands among these 418 servers.

## What the rules said

Both versions linted the same 418 servers: 0.3.3 as installed from npm, and this checkout. The rules were
changed while reading these findings, so the right-hand column is in-sample.

| | 0.3.3 | this checkout |
|---|---:|---:|
| Findings per server | 57.8 | 17.6 |
| Errors from the attack rules | 14 | 0 |
| Warnings from the attack rules | 15 | 2 |
| Servers with any error | 5.5% | 3.3% |
| `schema/portability` notes | 10,692 | 417 |
| `description/param-missing` warnings | 8,024 | 2,987 |
| `safety/missing-annotations` warnings | 909 | 199 |
| `naming/generic` warnings | 81 | 8 |
| `budget/tool-tokens` warnings | 1,768 | 1,032 |
| `budget/total-tokens` warnings | 0 | 28 |

The attack rules are `safety/prompt-injection`, `secret-access`, `cross-tool-reference`, `encoded-blob`,
`hidden-unicode` and `control-characters`. The errors that remain in this checkout are invalid schemas (26, on
12 servers), tools with no description (3) and one server whose tool list is malformed. The two `budget`
rows change with the count described above and the new total budget, not with the attack work.

### The attack rules

Nothing in this corpus is known to be an attack, but nobody read all 11,545 definitions for one, so "no
attack" rests on the old rules firing on text that was plainly harmless. Of the 14, one (the funding line) is
a payment solicitation aimed at the model; the pattern was wrong about it, since nothing is exfiltrated.

| 0.3.3 reported | Because the text said | Now |
|---|---|---|
| "references .env file" (4 errors) | "e.g., OECD.SDD.NAD, OECD.ECO, OECD.ENV"; "Optional filename for context (e.g. ".env", "config.js")"; "Parse a .env file content into a JSON object" | Not reported. Naming a `.env` file is not an instruction to read one |
| "API key exfiltration" (5 errors) | "no API key needed). Returns ready-to-run YAML"; "sign up for an API key and use sendEmail"; "(API key or OAuth). Read-only, no cost"; "Always free, no API key needed. ... Primary funding: send USDC to your custodial wallet" | Not reported. The pattern was "API key" within 30 characters of the letters "read" or "send". None is credential exfiltration; one solicits payment from the model |
| "references MCP client config" (1 error) | a server's own manifest, `mcp.json` | Not reported. Client configurations are matched by where clients keep them |
| "system prompt override" (1 error) | "Detects system prompt overrides, jailbreak attempts", in a scanner's description | Not reported. The pattern now needs the verb first: "override the system prompt" |
| "forced tool ordering" (1 error) | "This is a required step for comprehensive results" | A note |
| "concealment from the user" (2 errors) | "do not reveal the upload_url or any headers to the user" | A warning each: this is the pattern, used here for a harmless reason, and worth a reader's eye |
| cross-tool reference (15 warnings) | "You must call resolve-library-id first" and the like, about the server's own tools | Not reported. Reported only for a tool the server does not define |

Two things changed in how these rules decide.

**One signal is a warning; two on the same item are an error.** The signals are an instruction override,
concealment from the user, an `<IMPORTANT>` block, an instruction to obtain a local secret and pass it on, a
named credential store, coercive wording about another server's tool, and any of these found inside hidden
Unicode. An honest description sometimes contains one. The published attacks contain three or four.

**Secret access means an instruction, not a mention.** The error is for a verb of obtaining, then a local
secret (a credential file, a dotenv file, a client's MCP configuration, the system prompt, the conversation
history), then a verb of passing it on, in that order within a short span.

### Servers the rework did not see

`collect-heldout.mjs` reads 80 search queries (`weather`, `github`, `database`, ...) to their last page, drops
the servers already in `manifest.json`, shuffles the 5,535 distinct servers left with a fixed seed and reads
the first 900 ([`manifest-heldout.json`](manifest-heldout.json)); 886 publish tool definitions. It is a random
sample of the servers those queries reach, not of the registry: 634 of the 900 have a use count of 0 and 12
carry the verified flag. The attack rules in `src/core/rules/safety.ts` were not changed after this slice was
read (the file has since had comments edited). `census.mjs --label heldout` linted it once with this checkout
and once with 0.3.3, and I read the findings by hand in one pass; labels and short excerpts are in
[`heldout-labels.json`](heldout-labels.json) and [`heldout-review.json`](heldout-review.json).

| | 0.3.3 | frozen rules |
|---|---:|---:|
| Findings per server | 34.7 | 11.5 |
| Attack-rule errors | 36 | 5 |
| Attack-rule warnings | 39 | 7 |

All 5 errors and all 7 warnings were read.

- **Errors (5).** Two are false alarms: `get-converse-history` ("Fetch converse conversation history via POST
  ...", where *conversation history* counts as a local secret and *POST* as passing it on) and
  `slack_read_channel` ("Read recent messages and conversation history ... DO NOT use for emails", where
  *emails* counts as passing it on). Three are zero-width spaces in a beauty-app's marketing copy, one to three
  per description: the characters are there and nothing is hidden in them. None is an attack.
- **Warnings (7).** Six are benign: an `override the agent's default system prompt` parameter, a base64
  pagination cursor, and four "do not tell the user ..." sentences that ask the model not to claim success
  (`do not tell the user the setup is done without it`). One is worth a reader's eye: an installer tool that
  says to write a per-caller credential under HOME and names `.mcp.json`.
- **Other errors (144).** 79 `schema/invalid` (all a `$ref` to a `$defs` entry that the recorded schema does
  not contain, on 22 servers; I cannot tell whether the server or the registry dropped it), 61
  `description/missing` (all 61 confirmed to have no description) and 4 `collection/incomplete`.
- **A random 8 warnings from each of six other rules (48), read.**

| Rule | Warnings | Read | Correct | Arguable | Wrong |
|---|---:|---:|---:|---:|---:|
| `description/param-missing` | 3,347 | 8 | 5 | 3 | 0 |
| `safety/missing-annotations` | 455 | 8 | 7 | 1 | 0 |
| `naming/strict-client-compat` | 412 | 8 | 8 | 0 | 0 |
| `description/near-duplicate` | 336 | 8 | 5 | 1 | 2 |
| `description/too-short` | 292 | 8 | 0 | 6 | 2 |
| `naming/generic` | 26 | 8 | 2 | 6 | 0 |

"Wrong" is a finding that says something false: `liters_to_gallons_us` and `gallons_us_to_liters` called
near-duplicates, `deg_to_rad` and `rad_to_deg` likewise (the same words, opposite tools), and three Chinese or
Japanese descriptions counted as "1 word" or "3 words" because the count splits on spaces. Eight per rule
cannot give a rate; they show which patterns are wrong. `strict-client-compat` I judged on the name having a
dot; whether a given client rejects it I did not re-check.

**What I would change, and did not.** Remove *conversation/chat history* from the local secrets, or require a
file path with it; match passing-on verbs only as instructions rather than anywhere in 200 characters;
report a lone zero-width space as a warning and keep the error for Unicode tags and bidirectional controls;
ignore near-duplicate pairs that differ in their one directional word; count characters, not spaces, for
scripts written without them.

### Published poisoning examples

[`recall.mjs`](recall.mjs) fetches the three examples in
[invariantlabs-ai/mcp-injection-experiments](https://github.com/invariantlabs-ai/mcp-injection-experiments)
at commit `7382a5e` (10 April 2025), the code behind Invariant Labs' April 2025 disclosure, and lints the
`<IMPORTANT>` docstring of each as the description of a tool. The repository has no licence file, so the text
is fetched, not copied here.

| Example | 0.3.3 | this checkout |
|---|---|---|
| direct poisoning (`add`, reads `~/.cursor/mcp.json`) | 5 errors | 3 errors |
| shadowing (`add` redirects `send_email`) | 2 errors | 2 errors |
| WhatsApp takeover (`get_fact_of_the_day`) | 1 error | **1 warning** |

The third was an error before the rework and is only a warning now: of its signals the rules match one, the
`<IMPORTANT>` block. Its concealment sentence ("don't notify the user about it") and its instruction to
change the recipient of another tool's message are not matched. That is a loss of recall from the rework, found by this check;
I did not tune on it. `tests/rules/registry-calibration.test.ts` and `examples/poisoned-server` still hold
descriptions modelled on the first two and a fixture the author wrote, which are caught.

### The quality rules

| Rule | 0.3.3 on this corpus | Now |
|---|---|---|
| `schema/portability` | One note for each of the 93% of tools with optional properties and no `additionalProperties: false` | One note per server, with the count |
| `description/param-missing` | One warning per parameter | One per tool, naming its bare parameters |
| `safety/missing-annotations` | "Sounds destructive" from words in the description: `strip_markdown`, `convert_to_md` ("formatted", "removes") | From a destructive verb in the tool's name |
| `naming/generic` | A generic last word in a two-word name: `create_task`, `overpass_query`, `distance_tool` | Only when every word of the name is generic: `query`, `run_action` |
| `safety/encoded-blob` | A long `$ref` path read as base64 | `$ref`, `$id` and `$schema` values are not scanned for blobs |

## What this does not show

- **That these servers are safe.** The rules are patterns over text. Finding no attack signal in 11,545
  definitions says the patterns do not fire on ordinary descriptions; it does not certify the servers.
- **A false-alarm rate for the rules.** The 886-server slice gives 5 errors and 7 warnings, none an attack,
  after one hand reading by the author; there is no second reader. It is not a rate over the registry.
- **How the rules do against attacks in the wild.** The positive examples are three published demonstrations,
  the fixture and descriptions modelled on them, a handful of texts. There is no public corpus of poisoned
  servers to measure recall on, and one of the three fell to a warning.
- **What a model receives.** The count is the API tool format, not the request body of any particular client,
  and o200k_base is not Claude's tokenizer.
- **What a server sends today.** The registry's record is what it saw when it last connected. A server can
  change its definitions afterwards, which is the "rug pull" this kind of static reading cannot see.
- **A representative sample of MCP servers.** The census is the registry's first 500 rows plus its verified
  view, 2.3% of what it lists, and the registry is one of several. Its use counts are not defined.

## Reproduce

```sh
git clone https://github.com/antonsoo/mcplint && cd mcplint
npm ci && npm run build
node studies/registry-census/collect.mjs          # the listing and each server's record into cache/
node studies/registry-census/census.mjs           # lint with this checkout
npm install --prefix /tmp/mcplint-0.3.3 @antonsoloviev/mcplint@0.3.3
node studies/registry-census/census.mjs --label 0.3.3 \
    --lib /tmp/mcplint-0.3.3/node_modules/@antonsoloviev/mcplint/dist/index.js
node studies/registry-census/report.mjs           # results.json
node studies/registry-census/collect-heldout.mjs  # the 900-server slice, manifest-heldout.json
node studies/registry-census/census.mjs --label heldout --manifest manifest-heldout.json --servers heldout
node studies/registry-census/census.mjs --label heldout-0.3.3 --manifest manifest-heldout.json --servers heldout \
    --lib /tmp/mcplint-0.3.3/node_modules/@antonsoloviev/mcplint/dist/index.js
node studies/registry-census/heldout.mjs && node studies/registry-census/heldout.mjs --score
node studies/registry-census/recall.mjs
```

The registry is live and the downloaded records (`cache/`, 23 MB for the census) are not committed or
redistributed. I could not find the registry's terms of use on its site on 8 October 2026, and each
definition is its server author's work under a licence I did not check. The manifests pin what was seen
(server names, flags, tool counts, the read time); a fresh `collect.mjs` will list a different registry, so
its numbers will have moved. The committed `results.json` and `heldout-results.json` were produced from the
cache read on 8 October 2026. A census pass takes one to five minutes.

## References

- Invariant Labs, "MCP Security Notification: Tool Poisoning Attacks", 1 April 2025, and its
  [experiments repository](https://github.com/invariantlabs-ai/mcp-injection-experiments).
- Johann Rehberger, "Hiding and Finding Text with Unicode Tags", Embrace The Red, 2024.
- Anthropic, [token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting);
  OpenAI, [function calling](https://developers.openai.com/api/docs/guides/function-calling).
