#!/usr/bin/env node
// Collect a held-out slice: servers that are not in manifest.json.
//
//   node studies/registry-census/collect-heldout.mjs
//
// The registry's listing returns at most 500 rows for any one query, so the servers beyond
// the census's two views are reached through search: each query in QUERIES is read to its
// last page, the servers already in manifest.json are dropped, the rest are shuffled with a
// fixed seed, and the first LIMIT have their tool definitions fetched. The slice is therefore
// a seeded random sample of the servers these queries reach, not of the registry. Writes
// manifest-heldout.json; definitions go to cache/heldout/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'https://registry.smithery.ai';
const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache', 'heldout');
const AGENT = 'mcplint-registry-census (+https://github.com/antonsoo/mcplint)';
const LIMIT = 900;
const SEED = 20261008;
const QUERIES = [
  'weather', 'github', 'database', 'sql', 'search', 'email', 'calendar', 'slack', 'notion', 'finance',
  'crypto', 'blockchain', 'maps', 'travel', 'news', 'file', 'browser', 'scraper', 'image', 'video',
  'audio', 'music', 'translate', 'docs', 'pdf', 'jira', 'aws', 'docker', 'kubernetes', 'security',
  'health', 'medical', 'legal', 'education', 'game', 'sports', 'shopping', 'ecommerce', 'payment', 'crm',
  'analytics', 'seo', 'social', 'twitter', 'reddit', 'youtube', 'linkedin', 'memory', 'agent', 'workflow',
  'automation', 'api', 'python', 'typescript', 'rust', 'data', 'research', 'paper', 'science', 'math',
  'time', 'timezone', 'ai', 'llm', 'rag', 'vector', 'code', 'test', 'monitor', 'log',
  'cloud', 'storage', 'chat', 'sms', 'voice', 'real estate', 'jobs', 'recipe', 'food', 'government',
];

async function getJson(url, attempts = 5) {
  let delay = 1500;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' } });
      if (response.ok) return await response.json();
      if ([401, 403, 404, 410].includes(response.status)) return { unavailable: response.status };
      if (attempt >= attempts) return { unavailable: response.status };
    } catch (error) {
      if (attempt >= attempts) return { unavailable: String(error.cause?.code ?? error.message) };
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    delay *= 2;
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** mulberry32, so the shuffle is the same on every run. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const census = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
  const known = new Set(census.servers.map(s => s.name));
  const found = new Map();
  // Servers the registry lists in all, before any search.
  const totalCount = (await getJson(`${REGISTRY}/servers?pageSize=1&page=1&q=`)).pagination?.totalCount ?? null;
  for (const query of QUERIES) {
    for (let page = 1; ; page++) {
      const body = await getJson(`${REGISTRY}/servers?pageSize=100&page=${page}&q=${encodeURIComponent(query)}`);
      if (!body.servers?.length) break;
      for (const s of body.servers) if (!known.has(s.qualifiedName) && !found.has(s.qualifiedName)) found.set(s.qualifiedName, { ...s, query });
      if (page >= body.pagination.totalPages) break;
      await pause(200);
    }
  }
  const candidates = [...found.values()].sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  const rand = random(SEED);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const chosen = candidates.slice(0, LIMIT);
  const fileOf = name => join(CACHE, `${createHash('sha1').update(name).digest('hex')}.json`);
  const queue = [...chosen];
  async function worker() {
    for (let s = queue.shift(); s; s = queue.shift()) {
      if (existsSync(fileOf(s.qualifiedName))) continue;
      const path = s.qualifiedName.split('/').map(encodeURIComponent).join('/');
      writeFileSync(fileOf(s.qualifiedName), JSON.stringify(await getJson(`${REGISTRY}/servers/${path}`)));
      await pause(150);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const rows = chosen.map(s => {
    const detail = JSON.parse(readFileSync(fileOf(s.qualifiedName), 'utf8'));
    return {
      name: s.qualifiedName, useCount: s.useCount ?? 0, verified: Boolean(s.verified), remote: Boolean(s.remote),
      created: s.createdAt ?? null, query: s.query,
      tools: Array.isArray(detail.tools) ? detail.tools.length : null, unavailable: detail.unavailable ?? null,
    };
  });
  writeFileSync(join(HERE, 'manifest-heldout.json'), JSON.stringify({
    registry: REGISTRY, read: new Date().toISOString(), seed: SEED, queries: QUERIES,
    registryTotal: totalCount, distinctFound: candidates.length, servers: rows,
  }, null, 1) + '\n');
  console.log(`${candidates.length} distinct servers outside the census; ${rows.length} read, ${rows.filter(r => r.tools).length} with tool definitions`);
}
await main();
