# Contributing

## Setup

```sh
git clone https://github.com/antonsoo/mcplint.git
cd mcplint
npm install
```

## Workflow

```sh
npm run typecheck   # tsc --noEmit over src, tests, and examples
npm run lint         # eslint --max-warnings=0
npm test              # vitest, including the end-to-end fixture-server tests
npm run build        # tsc -p tsconfig.json -> dist/
```

All four must pass before a PR is merged; CI (`.github/workflows/ci.yml`) runs the same commands, plus a job
that dogfoods the built CLI against `examples/good-server` (must pass) and `examples/poisoned-server` (must
fail — that's the point).

## Adding a rule

1. Add the rule to the relevant file in `src/core/rules/` (`budget.ts`, `naming.ts`, `descriptions.ts`,
   `schema.ts`, or `safety.ts`). Every rule needs `id`, `category`, `defaultSeverity`, `summary`, `rationale`,
   and a `check(ctx)` function; export it from that file's `rules` array.
2. Add positive and negative unit tests in `tests/rules/<category>.test.ts`.
3. Add `docs/rules/<id-with-slash-replaced-by-dash>.md` documenting what triggers it, why it matters (cite a
   real source if you're referencing a spec or a security write-up), an example, and how to fix it.
4. If it's a safety rule that would meaningfully change what the poisoned fixture demonstrates, consider adding
   a case to `examples/poisoned-server/server.ts` and asserting on it in `tests/e2e/fixtures.test.ts`.

## Code style

Pure logic (rules, tokenizer, unicode detection, scoring) lives under `src/core/` with no I/O. Collectors
(`src/collectors/`) own everything that talks to a process or the network. Reporters (`src/report/`) are pure
functions from a `LintResult` to a string. Keep that separation — it's what makes the rule engine unit-testable
without spawning anything.

## Reporting a security issue

mcplint itself doesn't execute anything from the servers it lints beyond the standard MCP handshake and
`tools/list` (it never calls `tools/call`). If you find a way a malicious server could cause mcplint to execute
code or exfiltrate data purely by being linted, please open a GitHub issue.
