// Compare fixture expectations and mcplint with VS Code's pinned implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const [collector, output] = process.argv.slice(2);
if (!collector || !output) throw new Error('Usage: node oracle.mjs path/to/dist/collectors/config.js output.json');
const url = 'https://raw.githubusercontent.com/microsoft/vscode/3b486b1ff92ac032974c6f589e7d5a46fe486067/src/vs/base/common/envfile.ts';
const expectedHash = 'd1a3cbd96984e7bfa1e6db8795df96194a1c829dd66ed7401ad48fb6371de2da';
const response = await fetch(url);
assert(response.ok, `Reference fetch failed: ${response.status}`);
const source = await response.text();
const sha256 = createHash('sha256').update(source).digest('hex');
assert.equal(sha256, expectedHash);
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const reference = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const actual = await import(pathToFileURL(resolve(collector)).href);
const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const records = cases.map(fixture => {
  const expected = { MCPLINT_ENVFILE_TOKEN: fixture.token, ...(fixture.note === undefined ? {} : { MCPLINT_ENVFILE_NOTE: fixture.note }) };
  const oracle = Object.fromEntries(reference.parseEnvFile(fixture.text));
  assert.deepEqual(oracle, expected, `Fixture expectation disagrees with VS Code: ${fixture.id}`);
  const observed = actual.parseEnvFile(fixture.text);
  return { case: fixture.id, oracle, observed, matchesReference: JSON.stringify(observed) === JSON.stringify(oracle) };
});
const result = { reference: { url, bytes: Buffer.byteLength(source), sha256 }, node: process.version,
  cases: records.length, expectationsMatchReference: true, matched: records.filter(record => record.matchesReference).length, records };
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(`${result.matched}/${result.cases} parsed maps match the pinned VS Code parser; all fixture expectations agree with it`);
