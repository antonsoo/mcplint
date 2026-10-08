#!/usr/bin/env node
// Lint every collected server and record what was found.
//
//   npm run build && node studies/registry-census/census.mjs
//   node studies/registry-census/census.mjs --label 0.3.3 --lib /path/to/node_modules/@antonsoloviev/mcplint/dist/index.js
//   node studies/registry-census/census.mjs --label heldout --manifest manifest-heldout.json --servers heldout
//
// Each server's tool definitions (cache/servers/*.json, from collect.mjs) go through the
// same `lint` the CLI runs. One row per server is written to cache/census-<label>.jsonl
// (label "current" by default): its token footprint, its score, and each finding's rule,
// severity and subject. `--lib` lints with another build of mcplint, such as a released
// one installed from npm, so two versions can be compared on the same inputs. `report.mjs`
// summarises them.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const label = option('--label', 'current');
const library = option('--lib', fileURLToPath(new URL('../../dist/index.js', import.meta.url)));
const manifestName = option('--manifest', 'manifest.json');
const serversDir = option('--servers', 'servers');
const { collectFile, computeScore, estimateToolTokens, estimateOutputSchemaTokens, lint, resolveConfig } = await import(pathToFileURL(library).href);

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const manifest = JSON.parse(readFileSync(join(HERE, manifestName), 'utf8'));
// `file: {}` rather than no argument: releases up to 0.3.3 require it.
const config = resolveConfig({ file: {} });
const rows = [];
const scratch = mkdtempSync(join(tmpdir(), 'mcplint-census-'));

for (const server of manifest.servers) {
  if (!server.tools) continue;
  const file = join(CACHE, serversDir, `${createHash('sha1').update(server.name).digest('hex')}.json`);
  const row = { name: server.name, useCount: server.useCount, views: server.views };
  try {
    // The registry's record carries other fields, and null where a server has no prompts
    // or resources. Hand the linter what a client would have received: the lists.
    const detail = JSON.parse(readFileSync(file, 'utf8'));
    const saved = join(scratch, 'server.json');
    writeFileSync(
      saved,
      JSON.stringify({
        tools: detail.tools,
        ...(Array.isArray(detail.prompts) ? { prompts: detail.prompts } : {}),
        ...(Array.isArray(detail.resources) ? { resources: detail.resources } : {}),
      }),
    );
    const target = await collectFile(saved, server.name);
    const result = lint(target, config);
    const tokens = target.tools.map(tool => estimateToolTokens(tool));
    Object.assign(row, {
      tools: target.tools.length,
      tokens: tokens.reduce((sum, n) => sum + n, 0),
      toolTokens: tokens,
      // What the budget leaves out: output schemas (0.3.3 counted them in `tokens`).
      outputSchemaTokens: target.tools.reduce((sum, tool) => sum + (estimateOutputSchemaTokens?.(tool) ?? 0), 0),
      score: computeScore(result.findings, target),
      findings: result.findings.map(f => ({
        rule: f.ruleId,
        severity: f.severity,
        subject: `${f.subject.kind}:${f.subject.name}`,
        message: f.message,
        detail: f.detail?.slice(0, 600),
      })),
    });
  } catch (error) {
    row.failed = String(error.message ?? error).slice(0, 300);
  }
  rows.push(row);
}

rmSync(scratch, { recursive: true, force: true });
writeFileSync(join(CACHE, `census-${label}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
const failed = rows.filter(row => row.failed).length;
console.log(`${rows.length} servers linted, ${failed} could not be read; wrote cache/census-${label}.jsonl`);
