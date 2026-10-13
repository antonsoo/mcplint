import { expect, it } from 'vitest';
import { canonicalMetadata, compareMetadata, createMetadataSnapshot, parseMetadataSnapshot, validateMetadataSnapshot } from '../src/core/metadata.js';
import type { MetadataSnapshot } from '../src/core/metadata.js';
import type { ListMethod } from '../src/core/types.js';
import { renderMetadataHtml } from '../src/report/metadata-html.js';

function snapshot(values: unknown[], options: { scope?: ListMethod; status?: 'complete' | 'incomplete'; id?: string } = {}): MetadataSnapshot {
  const id = options.id ?? 's'; const scope = options.scope ?? 'tools/list';
  return { format: 'mcplint-metadata-snapshot', schemaVersion: 1, createdAt: '2026-10-12T00:00:00.000Z',
    servers: [{ id, serverInfo: { name: 'fixture', version: '1' } }],
    collection: [{ serverId: id, scope, status: options.status ?? 'complete', pages: 1, received: values.length, retained: values.length }],
    definitions: values.map(value => ({ serverId: id, scope, value })) };
}

it('compares complete identities while ignoring object and inventory order and capture time', () => {
  const before = snapshot([{ name: 'a', inputSchema: { type: 'object', properties: { b: {}, a: {} } } }, { name: 'b' }]);
  const after = snapshot([{ name: 'b' }, { inputSchema: { properties: { a: {}, b: {} }, type: 'object' }, name: 'a' }]);
  after.createdAt = '2026-10-13T00:00:00.000Z';
  const result = compareMetadata(before, after);
  expect(result.complete).toBe(true); expect(result.changes).toEqual([]); expect(result.summary.unchanged).toBe(3);
  expect(result.before.sha256).not.toBe(result.after.sha256);
});

it('retains unknown fields, missing versus null and ordered arrays with escaped JSON Pointers', () => {
  const before = snapshot([{ name: 'a', _meta: { 'a/~': 1 }, inputSchema: { enum: ['a', 'b'] } }]);
  const after = snapshot([{ name: 'a', description: null, _meta: { 'a/~': 2 }, inputSchema: { enum: ['b', 'a'] } }]);
  const fields = compareMetadata(before, after).changes[0]!.fields;
  expect(fields).toEqual([
    { pointer: '/_meta/a~1~0', before: { present: true, value: 1 }, after: { present: true, value: 2 } },
    { pointer: '/description', before: { present: false }, after: { present: true, value: null } },
    { pointer: '/inputSchema/enum', before: { present: true, value: ['a', 'b'] }, after: { present: true, value: ['b', 'a'] } },
  ]);
});

it('does not report a missing record as removed when the corresponding page failed', () => {
  const before = snapshot([{ name: 'a', description: 'old' }, { name: 'b' }]);
  const after = snapshot([{ name: 'a', description: 'new' }], { status: 'incomplete' });
  const result = compareMetadata(before, after);
  expect(result.complete).toBe(false); expect(result.summary.removed).toBe(0); expect(result.summary.unpaired).toBe(1);
  expect(result.changes[0]!.fields[0]!.after).toEqual({ present: true, value: 'new' });
});

it('refuses to pair duplicate identities even when both records are identical', () => {
  const result = compareMetadata(snapshot([{ name: 'a' }]), snapshot([{ name: 'a' }, { name: 'a' }]));
  expect(result.complete).toBe(false); expect(result.changes).toEqual([]);
  expect(result.summary.unpaired).toBe(3); expect(result.issues.join()).toContain('duplicate identity');
});

it('resources with equal names are matched by URI and templates use uriTemplate', () => {
  for (const [scope, field] of [['resources/list', 'uri'], ['resources/templates/list', 'uriTemplate']] as const) {
    const before = snapshot([{ name: 'same', [field]: 'urn:a', description: 'old' }, { name: 'same', [field]: 'urn:b' }], { scope });
    const after = snapshot([{ name: 'same', [field]: 'urn:b' }, { name: 'renamed', [field]: 'urn:a', description: 'new' }], { scope });
    const result = compareMetadata(before, after);
    expect(result.complete).toBe(true); expect(result.changes).toHaveLength(1); expect(result.changes[0]!.identity).toBe('urn:a');
  }
});

it('scope disappearance and global connection gaps never certify unchanged or invent removals', () => {
  const before = snapshot([{ name: 'a' }]);
  const after = snapshot([]);
  after.collection = [{ serverId: 's', scope: 'file', status: 'complete', pages: 0, received: 0, retained: 0 }];
  expect(compareMetadata(before, after).complete).toBe(false);
  expect(compareMetadata(before, after).summary.removed).toBe(0);
  after.collection = [{ serverId: 's', scope: 'connection', status: 'incomplete', pages: 0, received: 0, retained: 0 }];
  after.servers = [{ id: 's' }];
  const result = compareMetadata(before, after);
  expect(result.complete).toBe(false); expect(result.changes).toEqual([]);
});

it('an explicit file-level gap also prevents disappearance claims despite a complete saved array', () => {
  const before = snapshot([{ name: 'a' }, { name: 'b' }]);
  const after = snapshot([{ name: 'a' }]);
  after.collection.push({ serverId: 's', scope: 'file', status: 'incomplete', pages: 0, received: 0, retained: 0 });
  const result = compareMetadata(before, after);
  expect(result.complete).toBe(false); expect(result.summary.removed).toBe(0);
});

it('server IDs and separator-bearing names remain separate, and server changes are observable', () => {
  const a = snapshot([{ name: 'x|tools/list' }], { id: 's|x' });
  const b = snapshot([{ name: 'x' }], { id: 's' });
  const combined = { ...a, servers: [...a.servers, ...b.servers], collection: [...a.collection, ...b.collection], definitions: [...a.definitions, ...b.definitions] };
  const after = structuredClone(combined); after.servers[1]!.instructions = 'New instruction';
  const result = compareMetadata(combined, after);
  expect(result.complete).toBe(true); expect(result.changes).toHaveLength(1); expect(result.changes[0]!.serverId).toBe('s');
  expect(compareMetadata(a, b).summary).toMatchObject({ added: 2, removed: 2 });
});

it('snapshot accounting is checked independently of its status fields', () => {
  const data = snapshot([{ name: 'a' }]);
  expect(() => validateMetadataSnapshot({ ...data, definitions: [] })).toThrow('counts disagree');
  expect(() => validateMetadataSnapshot({ ...data, collection: [] })).toThrow('coverage');
  expect(() => validateMetadataSnapshot({ ...data, servers: [...data.servers, ...data.servers] })).toThrow('unique');
  expect(() => validateMetadataSnapshot({ ...data, schemaVersion: 2 })).toThrow('version 1');
  expect(() => parseMetadataSnapshot('{bad')).toThrow('not valid JSON');
  expect(() => parseMetadataSnapshot(JSON.stringify({ ...data, ignored: 1 }))).toThrow('shape');
});

it('an explicitly unsupported scope is a known empty inventory when a capability is added', () => {
  const before = snapshot([]); before.collection[0]!.status = 'unsupported';
  const after = snapshot([{ name: 'new_tool' }]);
  const result = compareMetadata(before, after);
  expect(result.complete).toBe(true); expect(result.summary.added).toBe(1);
  expect(compareMetadata(after, before).summary.removed).toBe(1);
  expect(() => compareMetadata(after, { ...before, definitions: after.definitions })).toThrow('counts disagree');
});

it('non-JSON, excessive depth and sparse arrays cannot be silently canonicalized', () => {
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), Array(2)]) expect(() => canonicalMetadata(value)).toThrow();
  let value: unknown = null;
  for (let i = 0; i < 130; i++) value = { nested: value };
  expect(() => canonicalMetadata(value)).toThrow('128-level');
  const object = JSON.parse('{"__proto__":{"x":1},"constructor":null}') as unknown;
  expect(canonicalMetadata(object)).toBe('{"__proto__":{"x":1},"constructor":null}');
  expect(Object.prototype).not.toHaveProperty('x');
});

it('snapshot creation omits launch labels and independently retains raw definitions', () => {
  const data = snapshot([{ name: 'a', icons: [{ src: 'https://example.invalid/icon' }], execution: { taskSupport: 'required' } }]);
  const target = { servers: [{ id: 's', label: 'command --token SECRET' }], tools: [], prompts: [], resources: [], collection: data.collection,
    metadata: { servers: data.servers, definitions: data.definitions } };
  const saved = createMetadataSnapshot(target);
  expect(JSON.stringify(saved)).not.toContain('SECRET');
  expect(saved.definitions).toEqual(data.definitions);
  (data.definitions[0]!.value as Record<string, unknown>).name = 'changed later';
  expect((saved.definitions[0]!.value as Record<string, unknown>).name).toBe('a');
});

it('HTML embeds hostile metadata as inert data and escapes snapshot date text', () => {
  const result = compareMetadata(snapshot([{ name: 'a' }]), snapshot([{ name: 'a', description: '</script><img src=x onerror=alert(1)>' }]));
  result.before.createdAt = '<img src=x onerror=alert(1)>';
  const html = renderMetadataHtml(result);
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('\\u003c/script>');
  expect(html).toContain('&lt;img');
  expect(html).toContain("default-src 'none'");
});
