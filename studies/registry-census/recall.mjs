#!/usr/bin/env node
// Run the attack rules on the poisoned tool descriptions Invariant Labs published, as published.
//
//   node studies/registry-census/recall.mjs
//
// The three files are fetched from github.com/invariantlabs-ai/mcp-injection-experiments at a
// pinned commit and are not copied into this repository (the repository carries no licence). The
// docstring that holds the <IMPORTANT> block is cut out of each and made the description of a
// tool of that name; the rest of the tool is a plain integer or empty schema. Writes
// recall-results.json: for each file, the attack-rule findings of this checkout and of --lib.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const HERE = dirname(fileURLToPath(import.meta.url));
const COMMIT = '7382a5e64d825b2c7c2bace11f8fb9f2f16e01e2';
const FILES = [
  ['direct-poisoning.py', 'add'],
  ['shadowing.py', 'add'],
  ['whatsapp-takeover.py', 'get_fact_of_the_day'],
];
const ATTACK = /^safety\/(prompt-injection|secret-access|cross-tool-reference|encoded-blob|hidden-unicode|control-characters)$/;
const libs = { 'this checkout': fileURLToPath(new URL('../../dist/index.js', import.meta.url)) };
if (option('--lib')) libs[option('--label', 'other build')] = option('--lib');

const scratch = mkdtempSync(join(tmpdir(), 'mcplint-recall-'));
const out = { source: `https://github.com/invariantlabs-ai/mcp-injection-experiments @ ${COMMIT}`, files: [] };
for (const [file, name] of FILES) {
  const url = `https://raw.githubusercontent.com/invariantlabs-ai/mcp-injection-experiments/${COMMIT}/${file}`;
  const source = await (await fetch(url, { headers: { 'User-Agent': 'mcplint-registry-census (+https://github.com/antonsoo/mcplint)' } })).text();
  const block = [...source.matchAll(/"""([\s\S]*?)"""/g)].map(m => m[1]).find(text => text.includes('<IMPORTANT>'));
  if (!block) throw new Error(`no <IMPORTANT> docstring in ${file}`);
  const description = block.replace(/^\n?\s*/, '').replace(/\s+$/, '').replace(/\n {4}/g, '\n');
  const saved = join(scratch, 'server.json');
  writeFileSync(saved, JSON.stringify({ tools: [{ name, description, inputSchema: { type: 'object', properties: {} } }] }));
  const row = { file, characters: description.length };
  for (const [label, lib] of Object.entries(libs)) {
    const { collectFile, lint, resolveConfig } = await import(pathToFileURL(lib).href);
    const result = lint(await collectFile(saved, name), resolveConfig({ file: {} }));
    row[label] = result.findings.filter(f => ATTACK.test(f.ruleId)).map(f => ({ rule: f.ruleId, severity: f.severity, message: f.message.slice(0, 160) }));
  }
  out.files.push(row);
}
rmSync(scratch, { recursive: true, force: true });
writeFileSync(join(HERE, 'recall-results.json'), JSON.stringify(out, null, 1) + '\n');
for (const row of out.files) console.log(row.file, Object.fromEntries(Object.keys(libs).map(k => [k, row[k].map(f => `${f.severity}:${f.rule}`)])));
