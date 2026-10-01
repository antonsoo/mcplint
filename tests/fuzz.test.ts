// Server metadata is untrusted input. The three reference servers' tool lists are mutated (fields
// dropped, duplicated, renamed, replaced by values of the wrong type) and linted: nothing may
// throw, and no rule may fail to run. `safety/unchecked` is the runner's backstop for a rule that
// throws, so here it counts as a failure: a rule crash it would otherwise turn into a finding.
import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectFile, lint, renderHtml, renderJson, renderMarkdown, renderSarif, renderTerminal, topOffenders } from '../src/index.js';
import { baseConfig } from './helpers.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), s | 1) + 0x6d2b79f5) >>> 0) / 4294967296);
}
const JUNK = [null, 0, -1, 1e308, '', 'x', [], {}, [1], { a: 1 }, true, false, 'object', 'string', { type: 5 }, { properties: null }, { properties: [1, 2] }, { required: 'name' }, { enum: 7 }, { items: [null] }, { anyOf: {} }, { $ref: '#/x' }, [[[]]], '​‮', { description: 12 }, { readOnlyHint: 'yes' }];

function mutate(node: unknown, r: () => number, rate: number): unknown {
  if (r() < rate) return JUNK[Math.floor(r() * JUNK.length)];
  if (Array.isArray(node)) {
    let out = node.map((v) => mutate(v, r, rate));
    if (r() < 0.04 && out.length) out.splice(Math.floor(r() * out.length), 1);
    if (r() < 0.04 && out.length) out = out.concat([out[Math.floor(r() * out.length)]]);
    return out;
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (r() < 0.02) continue;
      out[r() < 0.006 ? k + 'X' : k] = mutate(v, r, rate);
    }
    return out;
  }
  return node;
}

it('fuzz: mutated tool lists never crash the linter or a report', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcplint-fuzz-'));
  const sources = ['server-everything.json', 'server-filesystem.json', 'server-memory.json'].map((n) => JSON.parse(readFileSync(new URL(`./fixtures/reference-servers/${n}`, import.meta.url), 'utf8')) as unknown);
  let linted = 0, rejected = 0;
  const bad: string[] = [];
  for (let seed = 1; seed <= 600 && bad.length < 8; seed++) {
    const r = rng(seed);
    const file = join(dir, 'tools.json');
    writeFileSync(file, JSON.stringify(mutate(sources[seed % sources.length], r, seed % 3 === 0 ? 0.08 : 0.02)) ?? 'null');
    let target;
    try {
      target = await collectFile(file);
    } catch (err) {
      // collectFile's own, worded rejections: not JSON, or nothing to lint.
      if (/is not valid JSON|has no "tools"|must contain a tools array/.test((err as Error).message)) { rejected++; continue; }
      bad.push(`seed ${seed} [collect]: ${(err as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
      continue;
    }
    try {
      const result = lint(target, baseConfig({ totalBudget: r() < 0.3 ? 500 : undefined }));
      topOffenders(result);
      renderTerminal(result); renderJson(result); renderSarif(result); renderMarkdown(result); renderHtml(result);
      for (const f of result.findings) if (f.ruleId === 'safety/unchecked') bad.push(`seed ${seed}: ${f.message} ${f.detail ?? ''}`);
      linted++;
    } catch (err) {
      bad.push(`seed ${seed}: ${(err as Error).stack?.split('\n').slice(0, 4).join(' | ')}`);
    }
  }
  expect(bad).toEqual([]);
  expect(linted).toBeGreaterThan(500);
  expect(linted + rejected).toBe(600);
});
