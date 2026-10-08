#!/usr/bin/env node
// Summarise two censuses into results.json and print the tables the README quotes.
//
//   node studies/registry-census/report.mjs [--before 0.3.3] [--after current]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const labels = { before: option('--before', '0.3.3'), after: option('--after', 'current') };
const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
const read = label =>
  readFileSync(join(HERE, 'cache', `census-${label}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));

/** Nearest-rank percentile of an ascending array. */
const at = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const percentiles = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: at(sorted, 50), p75: at(sorted, 75), p90: at(sorted, 90), p95: at(sorted, 95), p99: at(sorted, 99), max: sorted.at(-1) };
};
const share = (part, whole) => Math.round((1000 * part) / whole) / 10;
const ATTACK_RULES = new Set([
  'safety/prompt-injection', 'safety/secret-access', 'safety/cross-tool-reference', 'safety/encoded-blob',
  'safety/hidden-unicode', 'safety/control-characters',
]);

/** What one version of the rules said about the servers. */
function verdicts(label) {
  const linted = read(label).filter(row => !row.failed);
  const rules = {};
  for (const row of linted) {
    const seen = new Set();
    for (const finding of row.findings) {
      const rule = (rules[finding.rule] ??= { servers: 0, findings: 0, severities: {} });
      rule.findings += 1;
      rule.severities[finding.severity] = (rule.severities[finding.severity] ?? 0) + 1;
      seen.add(finding.rule);
    }
    for (const rule of seen) rules[rule].servers += 1;
  }
  for (const rule of Object.values(rules)) rule.share = share(rule.servers, linted.length);
  const withSeverity = severity => linted.filter(row => row.findings.some(f => f.severity === severity)).length;
  const attack = linted.flatMap(row => row.findings.filter(f => ATTACK_RULES.has(f.rule)));
  return {
    label,
    servers: linted.length,
    findingsPerServer: Math.round((10 * linted.reduce((sum, row) => sum + row.findings.length, 0)) / linted.length) / 10,
    serversWithAnError: share(withSeverity('error'), linted.length),
    serversWithAWarning: share(withSeverity('warning'), linted.length),
    attackFindings: {
      error: attack.filter(f => f.severity === 'error').length,
      warning: attack.filter(f => f.severity === 'warning').length,
      info: attack.filter(f => f.severity === 'info').length,
    },
    rules: Object.fromEntries(Object.entries(rules).sort((a, b) => b[1].servers - a[1].servers)),
    // The findings of the rules that look for attacks, in full: there are few enough to read.
    attack: attack.map(f => ({ rule: f.rule, severity: f.severity, subject: f.subject, message: f.message })),
  };
}

/** Tool definitions in the registry's own records, for what the lint rows do not carry. */
const recordOf = name =>
  JSON.parse(readFileSync(join(HERE, 'cache', 'servers', `${createHash('sha1').update(name).digest('hex')}.json`), 'utf8'));

const linted = read(labels.after).filter(row => !row.failed);
const toolTokens = linted.flatMap(row => row.toolTokens);
const serverTokens = linted.map(row => row.tokens);
const heaviestServer = [...linted].sort((a, b) => b.tokens - a.tokens)[0];
const withoutHeaviest = linted.filter(row => row !== heaviestServer);
const definitionKeys = new Map();
let definitions = 0;
const perOwner = new Map();
for (const row of linted) {
  const owner = row.name.includes('/') ? row.name.split('/')[0] : '(registry-owned)';
  perOwner.set(owner, (perOwner.get(owner) ?? 0) + 1);
  for (const tool of recordOf(row.name).tools) {
    const key = createHash('sha1').update(JSON.stringify([tool.name, tool.description ?? null, tool.inputSchema ?? null])).digest('hex');
    definitionKeys.set(key, (definitionKeys.get(key) ?? 0) + 1);
    definitions += 1;
  }
}
const noTools = manifest.servers.filter(s => !s.tools);
const results = {
  registry: manifest.registry,
  listingRead: manifest.listingRead,
  servers: {
    listed: manifest.servers.length,
    mostUsed: manifest.servers.filter(s => s.views.includes('most used')).length,
    verified: manifest.servers.filter(s => s.views.includes('verified')).length,
    withToolDefinitions: linted.length,
    registryTotal: JSON.parse(readFileSync(join(HERE, 'manifest-heldout.json'), 'utf8')).registryTotal,
    withoutToolDefinitions: {
      total: noTools.length,
      emptyList: noTools.filter(s => s.tools === 0).length,
      noList: noTools.filter(s => s.tools === null).length,
      verifiedFlag: noTools.filter(s => s.verified).length,
      notRemote: noTools.filter(s => !s.remote).length,
    },
    verifiedFlag: manifest.servers.filter(s => s.verified).length,
    zeroUse: manifest.servers.filter(s => s.useCount === 0).length,
    owners: perOwner.size,
    registryOwned: perOwner.get('(registry-owned)'),
    largestOwner: [...perOwner.entries()].filter(([owner]) => owner !== '(registry-owned)').sort((a, b) => b[1] - a[1])[0],
  },
  tools: toolTokens.length,
  heaviestServer: {
    name: heaviestServer.name,
    toolShare: share(heaviestServer.tools, toolTokens.length),
    tokenShare: share(heaviestServer.tokens, serverTokens.reduce((sum, n) => sum + n, 0)),
    tokensPerToolWithout: percentiles(withoutHeaviest.flatMap(row => row.toolTokens)),
  },
  duplicateDefinitions: { definitions, distinct: definitionKeys.size, repeats: definitions - definitionKeys.size },
  outputSchemas: {
    note: 'tokens an output schema adds, which the budget does not count',
    tokensPerServerWith: percentiles(linted.map(row => row.tokens + row.outputSchemaTokens)),
    over16kWith: linted.filter(row => row.tokens + row.outputSchemaTokens > 16_000).length,
    shareOfAllTokens: share(linted.reduce((s, r) => s + r.outputSchemaTokens, 0), linted.reduce((s, r) => s + r.tokens + r.outputSchemaTokens, 0)),
  },
  toolsPerServer: percentiles(linted.map(row => row.tools)),
  tokensPerTool: { ...percentiles(toolTokens), over550: share(toolTokens.filter(t => t > 550).length, toolTokens.length) },
  tokensPerServer: {
    ...percentiles(serverTokens),
    over10k: share(serverTokens.filter(t => t > 10_000).length, linted.length),
    over16k: share(serverTokens.filter(t => t > 16_000).length, linted.length),
    over16kCount: serverTokens.filter(t => t > 16_000).length,
    over25k: share(serverTokens.filter(t => t > 25_000).length, linted.length),
    over100k: serverTokens.filter(t => t > 100_000).length,
  },
  heaviest: [...linted].sort((a, b) => b.tokens - a.tokens).slice(0, 5)
    .map(row => ({ tools: row.tools, tokens: row.tokens, useCount: row.useCount })),
  before: verdicts(labels.before),
  after: verdicts(labels.after),
};
writeFileSync(join(HERE, 'results.json'), JSON.stringify(results, null, 1) + '\n');

const r = results;
console.log(`${r.servers.withToolDefinitions} servers, ${r.tools} tools`);
console.log('tokens per tool  ', JSON.stringify(r.tokensPerTool));
console.log('tokens per server', JSON.stringify(r.tokensPerServer));
console.log('tools per server ', JSON.stringify(r.toolsPerServer));
console.log('heaviest         ', JSON.stringify(r.heaviest));
for (const v of [r.before, r.after]) {
  console.log(`-- ${v.label}: ${v.findingsPerServer} findings per server; an error on ${v.serversWithAnError}%, a warning on ${v.serversWithAWarning}%; attack findings ${JSON.stringify(v.attackFindings)}`);
  for (const [rule, x] of Object.entries(v.rules)) {
    console.log(`  ${rule.padEnd(34)} ${String(x.servers).padStart(4)} servers ${String(x.share).padStart(5)}%  ${String(x.findings).padStart(5)} findings  ${JSON.stringify(x.severities)}`);
  }
}
