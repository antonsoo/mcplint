#!/usr/bin/env node
// Prepare, then score, the hand review of the held-out slice.
//
//   node studies/registry-census/heldout.mjs            # writes heldout-review.json: what to read
//   node studies/registry-census/heldout.mjs --score    # reads heldout-labels.json, writes heldout-results.json
//
// Input: cache/census-heldout.jsonl (the frozen rules on the servers in manifest-heldout.json) and
// cache/census-heldout-0.3.3.jsonl. To read: every finding of the attack rules, whatever its severity;
// every other error-level finding (checked here where a program can check it: a missing description
// is either missing or not); and a seeded sample of the other warnings, EACH_RULE per rule.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = label => readFileSync(join(HERE, 'cache', `census-${label}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const ATTACK = new Set([
  'safety/prompt-injection', 'safety/secret-access', 'safety/cross-tool-reference', 'safety/encoded-blob',
  'safety/hidden-unicode', 'safety/control-characters',
]);
const SAMPLED = ['description/param-missing', 'safety/missing-annotations', 'naming/strict-client-compat', 'description/near-duplicate', 'description/too-short', 'naming/generic'];
const EACH_RULE = 8;
const SEED = 20261009;

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const key = (row, f) => `${row.name} ${f.subject} ${f.rule} ${f.message.slice(0, 80)}`;
const record = name =>
  JSON.parse(readFileSync(join(HERE, 'cache', 'heldout', `${createHash('sha1').update(name).digest('hex')}.json`), 'utf8'));
const toolOf = (name, subject) => record(name).tools?.find(t => `tool:${t.name}` === subject);
const count = (items, by) => items.reduce((acc, x) => ((acc[by(x)] = (acc[by(x)] ?? 0) + 1), acc), {});

const rows = read('heldout');
const old = read('heldout-0.3.3');
const all = rows.flatMap(row => row.findings.map(f => ({ row, f })));
const attackOf = list => list.flatMap(row => row.findings.filter(f => ATTACK.has(f.rule)));

if (!process.argv.includes('--score')) {
  const attack = all.filter(({ f }) => ATTACK.has(f.rule));
  const others = all.filter(({ f }) => f.severity === 'error' && !ATTACK.has(f.rule));
  const missing = others.filter(({ f }) => f.rule === 'description/missing');
  const trulyMissing = missing.filter(({ row, f }) => {
    const tool = toolOf(row.name, f.subject);
    return tool && !(typeof tool.description === 'string' && tool.description.trim());
  }).length;
  const rand = random(SEED);
  const sample = [];
  for (const rule of SAMPLED) {
    const pool = all.filter(({ f }) => f.rule === rule && f.severity !== 'error').sort((a, b) => (key(a.row, a.f) < key(b.row, b.f) ? -1 : 1));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    sample.push(...pool.slice(0, EACH_RULE));
  }
  const excerpt = ({ row, f }) => {
    const tool = f.subject.startsWith('tool:') ? toolOf(row.name, f.subject) : null;
    return {
      id: createHash('sha1').update(key(row, f)).digest('hex').slice(0, 10),
      server: row.name, subject: f.subject, rule: f.rule, severity: f.severity, message: f.message.slice(0, 200),
      detail: f.detail?.slice(0, 200),
      description: tool?.description?.slice(0, 200),
      properties: tool?.inputSchema?.properties ? Object.keys(tool.inputSchema.properties).slice(0, 12) : undefined,
    };
  };
  writeFileSync(join(HERE, 'heldout-review.json'), JSON.stringify({
    attackRuleFindings: attack.map(excerpt),
    otherErrors: { byRule: count(others, ({ f }) => f.rule), descriptionMissingChecked: missing.length, descriptionMissingReallyMissing: trulyMissing,
      schemaInvalid: others.filter(({ f }) => f.rule === 'schema/invalid').map(({ row, f }) => ({ server: row.name, subject: f.subject, message: f.message.slice(0, 200) })) },
    warningPools: Object.fromEntries(SAMPLED.map(rule => [rule, all.filter(({ f }) => f.rule === rule && f.severity !== 'error').length])),
    warningSample: sample.map(excerpt),
  }, null, 1) + '\n');
  console.log(`read: ${attack.length} attack-rule findings, ${others.length} other errors (${trulyMissing} of ${missing.length} missing descriptions confirmed), ${sample.length} sampled warnings`);
} else {
  const labels = JSON.parse(readFileSync(join(HERE, 'heldout-labels.json'), 'utf8'));
  const review = JSON.parse(readFileSync(join(HERE, 'heldout-review.json'), 'utf8'));
  const byId = new Map(labels.labels.map(l => [l.id, l]));
  const missingLabel = [...review.attackRuleFindings, ...review.warningSample].filter(x => !byId.has(x.id));
  if (missingLabel.length) throw new Error(`${missingLabel.length} findings have no label`);
  const classes = list => count(list, x => byId.get(x.id).label);
  const attackErrors = review.attackRuleFindings.filter(x => x.severity === 'error');
  const attackWarnings = review.attackRuleFindings.filter(x => x.severity === 'warning');
  const sampleByRule = {};
  for (const rule of SAMPLED) {
    const items = review.warningSample.filter(x => x.rule === rule);
    sampleByRule[rule] = { pool: review.warningPools[rule], sampled: items.length, ...classes(items) };
  }
  const manifest = JSON.parse(readFileSync(join(HERE, 'manifest-heldout.json'), 'utf8'));
  const at = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  const perServer = rows.map(row => row.tokens).sort((a, b) => a - b);
  const perTool = rows.flatMap(row => row.toolTokens).sort((a, b) => a - b);
  const pct = (part, whole) => Math.round((1000 * part) / whole) / 10;
  writeFileSync(join(HERE, 'heldout-results.json'), JSON.stringify({
    slice: {
      listed: manifest.servers.length, withToolDefinitions: rows.length, registryTotal: manifest.registryTotal,
      distinctReachedBySearch: manifest.distinctFound, queries: manifest.queries.length,
      noUse: manifest.servers.filter(s => s.useCount === 0).length, verifiedFlag: manifest.servers.filter(s => s.verified).length,
    },
    tokensPerServer: { p50: at(perServer, 50), p90: at(perServer, 90), p99: at(perServer, 99), over16k: perServer.filter(t => t > 16_000).length, over16kShare: pct(perServer.filter(t => t > 16_000).length, perServer.length) },
    tokensPerTool: { tools: perTool.length, p50: at(perTool, 50), p90: at(perTool, 90), over400Share: pct(perTool.filter(t => t > 400).length, perTool.length) },
    servers: rows.length,
    registryRead: JSON.parse(readFileSync(join(HERE, 'manifest-heldout.json'), 'utf8')).read,
    findingsPerServer: { frozen: Math.round((10 * rows.reduce((s, r) => s + r.findings.length, 0)) / rows.length) / 10, released: Math.round((10 * old.reduce((s, r) => s + r.findings.length, 0)) / old.length) / 10 },
    attackRules: {
      released: count(attackOf(old), f => f.severity),
      frozen: count(attackOf(rows), f => f.severity),
      errors: { read: attackErrors.length, ...classes(attackErrors) },
      warnings: { read: attackWarnings.length, ...classes(attackWarnings) },
    },
    otherErrors: review.otherErrors.byRule,
    descriptionMissing: { reported: review.otherErrors.descriptionMissingChecked, confirmed: review.otherErrors.descriptionMissingReallyMissing },
    warningSample: sampleByRule,
  }, null, 1) + '\n');
  console.log(readFileSync(join(HERE, 'heldout-results.json'), 'utf8'));
}
