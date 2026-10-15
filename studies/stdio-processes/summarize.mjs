import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = async name => JSON.parse(await readFile(new URL(`./results/${name}.json`, import.meta.url), 'utf8'));
const before = await read('before');
const after = await read('after');
const alive = row => row.serverStateAfterReturn === 'running' || row.helperStateAfterReturn === 'running';
assert.equal(before.results.length, after.results.length);
console.log('Native MCP SDK + actual npm; synthetic local servers, 40 ms heartbeats.');
console.log('A working server/helper after collection or interruption is a leak.\n');
console.log('Case                                  Before    After     Exit');
for (const [index, row] of after.results.entries()) {
  const old = before.results[index];
  const name = `${row.launcher}/${row.mode}`;
  assert.equal(`${old.launcher}/${old.mode}`, name);
  console.log(`${name.padEnd(38)}${(alive(old) ? 'LEAK' : 'clean').padEnd(10)}${(alive(row) ? 'LEAK' : 'clean').padEnd(10)}${row.code}`);
}
console.log(`\nWorking servers/helpers after return: ${before.results.filter(alive).length}/${before.results.length} -> ${after.results.filter(alive).length}/${after.results.length}`);
console.log(`Unrelated controls survived: ${after.results.filter(row => row.unrelatedProcessSurvived).length}/${after.results.length}`);
console.log(`External teardown needed after fix: ${after.results.filter(row => row.timedOut).length}/${after.results.length}`);
