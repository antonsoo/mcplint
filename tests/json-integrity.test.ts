import { expect, it } from 'vitest';
import { readJson, JsonIntegrityError } from '../src/core/read-json.js';
import { compareMetadata, parseMetadataSnapshot } from '../src/core/metadata.js';

it.each([
  ['9007199254740993', 'rounded'],
  ['-9007199254740993', 'rounded'],
  ['0.10000000000000001', 'rounded'],
  ['1000000000000000101', 'rounded'],
  ['1e-400', 'underflows'],
  ['-1e-400', 'underflows'],
  ['1e400', 'finite JavaScript'],
])('refuses %s before it can become different snapshot evidence', (literal, reason) => {
  expect(() => readJson(`{"maximum":${literal}}`)).toThrow(reason);
});

it.each([
  '{"a":1,"a":2}',
  '{"a":1,"\\u0061":2}',
  '{"x":[{"name":"first","name":"last"}]}',
  '{"__proto__":1,"__proto__":2}',
])('refuses duplicate decoded keys in %s', (text) => {
  expect(() => readJson(text)).toThrow(JsonIntegrityError);
});

it('does not confuse distinct objects, strings, escaped quotes or prototype keys with duplicates', () => {
  const text = '{"a":[{"name":1},{"name":2}],"text":"{\\\"a\\\":1e400,\\\"a\\\":2}","__proto__":{"x":1}}';
  expect(readJson(text)).toEqual(JSON.parse(text));
  expect(Object.prototype).not.toHaveProperty('x');
});

it.each(['0', '-0', '0e999999999', '1.0', '10e-1', '0.1', '1e-7', '5e-324', '1.7976931348623157e308', '9007199254740992', '1e20', '1000000000000000100'])('keeps stable decimal serialization %s', (text) => {
  expect(readJson(text)).toBe(JSON.parse(text));
});

it('retains native syntax checks and bounds deeply nested metadata without recursive scanning', () => {
  expect(() => readJson('{"a":1,}')).toThrow(SyntaxError);
  expect(() => readJson('['.repeat(10_000) + '0' + ']'.repeat(10_000))).toThrow('128 levels');
});

function snapshot(literal: string): string {
  return '{"format":"mcplint-metadata-snapshot","schemaVersion":1,"createdAt":"2026-10-13T00:00:00Z",' +
    '"servers":[{"id":"s"}],"collection":[{"serverId":"s","scope":"tools/list","status":"complete","pages":1,"received":1,"retained":1}],' +
    '"definitions":[{"serverId":"s","scope":"tools/list","value":{"name":"read_account","inputSchema":{"maximum":' + literal + '}}}]}';
}

it('never reports two distinct integer limits unchanged after snapshot import', () => {
  const before = parseMetadataSnapshot(snapshot('9007199254740992'));
  expect(() => parseMetadataSnapshot(snapshot('9007199254740993'))).toThrow('rounded');
  const after = parseMetadataSnapshot(snapshot('9007199254740994'));
  expect(compareMetadata(before, after).summary.changed).toBe(1);
});

it('rejects duplicate snapshot envelope and nested fields before accounting or pairing', () => {
  for (const text of [snapshot('1').replace('"schemaVersion":1', '"schemaVersion":99,"schemaVersion":1'),
    snapshot('1').replace('"maximum":1', '"maximum":2,"maximum":1')]) {
    expect(() => parseMetadataSnapshot(text)).toThrow('Duplicate JSON object field');
  }
});
