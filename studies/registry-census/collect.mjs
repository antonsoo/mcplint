#!/usr/bin/env node
// Collect tool definitions for the most-used and the verified servers in a public MCP registry.
//
//   node studies/registry-census/collect.mjs
//
// The Smithery registry publishes, for each server it lists, the tool definitions the
// server returned when the registry connected to it: names, descriptions and input
// schemas, exactly what a client would put in a model's context. Without a key the
// listing returns its first 500 rows, ranked by use; this reads those, adds every
// server the registry marks as verified, and saves each one's definitions.
//
// No server is started or contacted: every request goes to the registry's own API. The
// manifest records which servers were read and when, so the census can be re-run on the
// same inputs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'https://registry.smithery.ai';
const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const AGENT = 'mcplint-registry-census (+https://github.com/antonsoo/mcplint)';
// Two views of the listing: its default ranking (by use), and the verified servers.
const VIEWS = { 'most used': '', verified: 'is:verified' };

async function getJson(url, attempts = 5) {
  let delay = 1500;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' } });
      if (response.ok) return await response.json();
      // Gone or private since the listing was read: nothing to retry.
      if ([401, 403, 404, 410].includes(response.status)) return { unavailable: response.status };
      if (attempt >= attempts) return { unavailable: response.status };
    } catch (error) {
      if (attempt >= attempts) return { unavailable: String(error.cause?.code ?? error.message) };
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    delay *= 2;
  }
}

async function listing() {
  const file = join(CACHE, 'listing.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const servers = new Map();
  for (const [view, query] of Object.entries(VIEWS)) {
    for (let page = 1; ; page++) {
      const body = await getJson(`${REGISTRY}/servers?pageSize=100&page=${page}&q=${encodeURIComponent(query)}`);
      if (!body.servers?.length) break;
      for (const server of body.servers) {
        const known = servers.get(server.qualifiedName) ?? { ...server, views: [] };
        if (!known.views.includes(view)) known.views.push(view);
        servers.set(server.qualifiedName, known);
      }
      if (page >= body.pagination.totalPages) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  const result = { read: new Date().toISOString(), servers: [...servers.values()] };
  writeFileSync(file, JSON.stringify(result));
  return result;
}

const detailFile = name => join(CACHE, 'servers', `${createHash('sha1').update(name).digest('hex')}.json`);

async function main() {
  mkdirSync(join(CACHE, 'servers'), { recursive: true });
  const all = await listing();
  // The most used first, ties in name order.
  const chosen = [...all.servers].sort(
    (a, b) => (b.useCount ?? 0) - (a.useCount ?? 0) || a.qualifiedName.localeCompare(b.qualifiedName),
  );
  let done = 0;
  const queue = [...chosen];
  async function worker() {
    for (let server = queue.shift(); server; server = queue.shift()) {
      const file = detailFile(server.qualifiedName);
      if (!existsSync(file)) {
        const path = server.qualifiedName.split('/').map(encodeURIComponent).join('/');
        writeFileSync(file, JSON.stringify(await getJson(`${REGISTRY}/servers/${path}`)));
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      if (++done % 250 === 0) console.log(`details: ${done} of ${chosen.length}`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  const rows = chosen.map(server => {
    const detail = JSON.parse(readFileSync(detailFile(server.qualifiedName), 'utf8'));
    return {
      name: server.qualifiedName,
      useCount: server.useCount ?? 0,
      views: server.views,
      verified: Boolean(server.verified),
      remote: Boolean(server.remote),
      created: server.createdAt ?? null,
      tools: Array.isArray(detail.tools) ? detail.tools.length : null,
      unavailable: detail.unavailable ?? null,
    };
  });
  writeFileSync(
    join(HERE, 'manifest.json'),
    JSON.stringify({ registry: REGISTRY, listingRead: all.read, servers: rows }, null, 1) + '\n',
  );
  const withTools = rows.filter(r => r.tools).length;
  console.log(`${rows.length} servers read, ${withTools} with tool definitions; wrote manifest.json`);
}

await main();
