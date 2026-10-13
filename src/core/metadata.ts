import { createHash } from 'node:crypto';
import type { CollectionRecord, LintTarget, ListMethod, MetadataDefinition, MetadataServer } from './types.js';
import { isPlainObject } from './schema-utils.js';

export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_NODES = 1_000_000;
const MAX_DEPTH = 128;
const LISTS: ListMethod[] = ['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list'];
const SCOPES = [...LISTS, 'file', 'connection', 'config'];

export interface MetadataSnapshot {
  format: 'mcplint-metadata-snapshot';
  schemaVersion: 1;
  createdAt: string;
  servers: MetadataServer[];
  collection: CollectionRecord[];
  definitions: MetadataDefinition[];
}

/** Stable decoded JSON, not a wire-byte signature or JSON Schema equivalence test. */
export function canonicalMetadata(value: unknown): string {
  let nodes = 0;
  const encode = (item: unknown, depth: number): string => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('Metadata exceeds the 1,000,000-node or 128-level comparison limit.');
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'string') {
      if (item.length > MAX_SNAPSHOT_BYTES) throw new Error('Metadata exceeds the 50 MB snapshot limit.');
      return JSON.stringify(item);
    }
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) if (!Object.hasOwn(item, i)) throw new Error('Sparse arrays are not JSON metadata.');
      return `[${item.map(child => encode(child, depth + 1)).join(',')}]`;
    }
    if (isPlainObject(item) && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key], depth + 1)}`).join(',')}}`;
    }
    throw new Error('Metadata must contain only finite JSON values.');
  };
  const encoded = encode(value, 0);
  if (Buffer.byteLength(encoded) > MAX_SNAPSHOT_BYTES) throw new Error('Metadata exceeds the 50 MB snapshot limit.');
  return encoded;
}

function object(value: unknown, fields: string[], label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error(`Invalid ${label} shape in metadata snapshot.`);
}
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
const groupKey = (server: string, scope: string): string => JSON.stringify([server, scope]);

/** Validate the envelope and its accounting. Raw definition values remain intact, including malformed entries. */
export function validateMetadataSnapshot(value: unknown): asserts value is MetadataSnapshot {
  canonicalMetadata(value);
  object(value, ['format', 'schemaVersion', 'createdAt', 'servers', 'collection', 'definitions'], 'snapshot');
  if (value.format !== 'mcplint-metadata-snapshot' || value.schemaVersion !== 1) throw new Error('Expected a version 1 mcplint metadata snapshot. Capture one with --snapshot.');
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Snapshot createdAt must be a valid date string.');
  if (!Array.isArray(value.servers) || !value.servers.length || !Array.isArray(value.collection) || !Array.isArray(value.definitions)) throw new Error('Snapshot servers, collection and definitions must be arrays, with at least one server.');
  const servers = new Set<string>();
  for (const server of value.servers) {
    object(server, ['id', 'serverInfo', 'capabilities', 'instructions'], 'server');
    if (typeof server.id !== 'string' || servers.has(server.id)) throw new Error('Snapshot server IDs must be strings and unique.');
    servers.add(server.id);
  }
  const records = new Map<string, CollectionRecord>();
  const covered = new Set<string>();
  for (const record of value.collection) {
    object(record, ['serverId', 'scope', 'status', 'pages', 'received', 'retained', 'detail'], 'coverage');
    if (typeof record.serverId !== 'string' || !servers.has(record.serverId) || typeof record.scope !== 'string' || !SCOPES.includes(record.scope)
      || !['complete', 'incomplete', 'unsupported', 'disabled'].includes(String(record.status))
      || !integer(record.pages) || !integer(record.received) || !integer(record.retained) || record.retained > record.received
      || (record.detail !== undefined && typeof record.detail !== 'string')) throw new Error('Invalid metadata collection coverage.');
    const key = groupKey(record.serverId, record.scope);
    if (records.has(key)) throw new Error('Duplicate metadata collection scope.');
    records.set(key, record as unknown as CollectionRecord);
    covered.add(record.serverId);
  }
  if ([...servers].some(id => !covered.has(id))) throw new Error('Every snapshot server must have recorded collection coverage.');
  const counts = new Map<string, number>();
  for (const definition of value.definitions) {
    object(definition, ['serverId', 'scope', 'value'], 'definition');
    if (typeof definition.serverId !== 'string' || typeof definition.scope !== 'string' || !LISTS.includes(definition.scope as ListMethod)
      || !Object.hasOwn(definition, 'value')) throw new Error('Invalid snapshot definition identity or value.');
    const key = groupKey(definition.serverId, definition.scope);
    if (!records.has(key)) throw new Error('Snapshot definition has no matching collection record.');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, record] of records) {
    const count = counts.get(key) ?? 0;
    if (!LISTS.includes(record.scope as ListMethod)) continue;
    if (count > record.received || (record.status === 'complete' && (count !== record.received || record.retained !== count))
      || (record.status === 'unsupported' && (count !== 0 || record.received !== 0 || record.retained !== 0))) {
      throw new Error('Snapshot definition counts disagree with collection coverage.');
    }
  }
}

export function createMetadataSnapshot(target: LintTarget, createdAt = new Date().toISOString()): MetadataSnapshot {
  if (!target.metadata || !target.collection) throw new Error('Raw metadata and coverage are required. Capture with a current mcplint collector.');
  const snapshot = { format: 'mcplint-metadata-snapshot', schemaVersion: 1, createdAt,
    servers: target.metadata.servers, definitions: target.metadata.definitions, collection: target.collection };
  validateMetadataSnapshot(snapshot);
  return JSON.parse(canonicalMetadata(snapshot)) as MetadataSnapshot;
}

export function parseMetadataSnapshot(text: string): MetadataSnapshot {
  if (Buffer.byteLength(text) > MAX_SNAPSHOT_BYTES) throw new Error('Metadata exceeds the 50 MB snapshot limit.');
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('Metadata snapshot is not valid JSON.'); }
  validateMetadataSnapshot(value);
  return value;
}

export type MetadataValue = { present: false } | { present: true; value: unknown };
export interface MetadataFieldChange { pointer: string; before: MetadataValue; after: MetadataValue }
export interface MetadataChange {
  serverId: string;
  scope: ListMethod | 'server';
  identity: string;
  status: 'added' | 'removed' | 'changed';
  fields: MetadataFieldChange[];
}
export interface MetadataComparison {
  format: 'mcplint-metadata-diff';
  schemaVersion: 1;
  before: { createdAt: string; sha256: string; definitions: number };
  after: { createdAt: string; sha256: string; definitions: number };
  complete: boolean;
  issues: string[];
  summary: { added: number; removed: number; changed: number; unchanged: number; unpaired: number };
  changes: MetadataChange[];
  coverage: { before: CollectionRecord[]; after: CollectionRecord[] };
  notes: string[];
}

const present = (value: unknown): MetadataValue => ({ present: true, value });
const missing: MetadataValue = { present: false };
const escapePointer = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** Objects have unordered keys. Arrays are compared as whole ordered values. */
function changedFields(before: unknown, after: unknown, pointer = ''): MetadataFieldChange[] {
  if (canonicalMetadata(before) === canonicalMetadata(after)) return [];
  if (!isPlainObject(before) || !isPlainObject(after)) return [{ pointer, before: present(before), after: present(after) }];
  const changes: MetadataFieldChange[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const path = `${pointer}/${escapePointer(key)}`;
    if (!Object.hasOwn(before, key)) changes.push({ pointer: path, before: missing, after: present(after[key]) });
    else if (!Object.hasOwn(after, key)) changes.push({ pointer: path, before: present(before[key]), after: missing });
    else for (const change of changedFields(before[key], after[key], path)) changes.push(change);
  }
  return changes;
}

function definitionIdentity(definition: MetadataDefinition): string | undefined {
  if (!isPlainObject(definition.value)) return undefined;
  const field = definition.scope === 'resources/list' ? 'uri' : definition.scope === 'resources/templates/list' ? 'uriTemplate' : 'name';
  const value = definition.value[field];
  return typeof value === 'string' ? value : undefined;
}

export function compareMetadata(before: MetadataSnapshot, after: MetadataSnapshot): MetadataComparison {
  validateMetadataSnapshot(before); validateMetadataSnapshot(after);
  const changes: MetadataChange[] = [];
  const issues = new Set<string>();
  const summary = { added: 0, removed: 0, changed: 0, unchanged: 0, unpaired: 0 };
  const stamp = (snapshot: MetadataSnapshot) => ({ createdAt: snapshot.createdAt,
    sha256: createHash('sha256').update(canonicalMetadata(snapshot)).digest('hex'), definitions: snapshot.definitions.length });
  const sides = [before, after].map((snapshot, side) => {
    const servers = new Map(snapshot.servers.map(server => [server.id, server]));
    const records = new Map(snapshot.collection.map(record => [groupKey(record.serverId, record.scope), record]));
    const globalGaps = new Set<string>();
    for (const record of snapshot.collection) if (record.status !== 'complete' && record.status !== 'unsupported') {
      issues.add(`${side === 0 ? 'Before' : 'After'}: ${record.serverId} ${record.scope} is ${record.status}.`);
      if (!LISTS.includes(record.scope as ListMethod)) globalGaps.add(record.serverId);
    }
    const definitions = new Map<string, Map<string, MetadataDefinition[]>>();
    for (const definition of snapshot.definitions) {
      const key = groupKey(definition.serverId, definition.scope);
      let group = definitions.get(key);
      if (!group) { group = new Map(); definitions.set(key, group); }
      const id = definitionIdentity(definition);
      if (id === undefined) { issues.add(`${side === 0 ? 'Before' : 'After'}: ${definition.serverId} ${definition.scope} has an entry without a usable identity.`); summary.unpaired++; continue; }
      const same = group.get(id) ?? [];
      same.push(definition); group.set(id, same);
    }
    return { servers, records, definitions, globalGaps };
  });
  const a = sides[0]!, b = sides[1]!;
  const add = (serverId: string, scope: MetadataChange['scope'], identity: string, left: MetadataValue, right: MetadataValue): void => {
    const fields = !left.present || !right.present ? [{ pointer: '', before: left, after: right }] : changedFields(left.value, right.value);
    if (!fields.length) { summary.unchanged++; return; }
    const status = !left.present ? 'added' : !right.present ? 'removed' : 'changed';
    changes.push({ serverId, scope, identity, status, fields }); summary[status]++;
  };
  for (const id of [...new Set([...a.servers.keys(), ...b.servers.keys()])].sort()) {
    const left = a.servers.get(id), right = b.servers.get(id);
    if (a.globalGaps.has(id) || b.globalGaps.has(id)) summary.unpaired++;
    else add(id, 'server', id, left ? present(left) : missing, right ? present(right) : missing);
    for (const scope of LISTS) {
      const key = groupKey(id, scope);
      const leftRecord = a.records.get(key), rightRecord = b.records.get(key);
      const leftDefinitions = a.definitions.get(key) ?? new Map<string, MetadataDefinition[]>();
      const rightDefinitions = b.definitions.get(key) ?? new Map<string, MetadataDefinition[]>();
      if (!leftRecord && !rightRecord) continue;
      const absentServer = !left || !right;
      const comparable = !a.globalGaps.has(id) && !b.globalGaps.has(id)
        && (leftRecord?.status === 'complete' || leftRecord?.status === 'unsupported' || !left)
        && (rightRecord?.status === 'complete' || rightRecord?.status === 'unsupported' || !right);
      const bothUnsupported = leftRecord?.status === 'unsupported' && rightRecord?.status === 'unsupported';
      if (!comparable && !bothUnsupported && !(absentServer && (leftRecord ?? rightRecord)?.status === 'unsupported')) {
        issues.add(`${id} ${scope}: coverage is ${leftRecord?.status ?? 'not recorded'} before and ${rightRecord?.status ?? 'not recorded'} after; absent definitions cannot be classified as added or removed.`);
      }
      for (const identity of [...new Set([...leftDefinitions.keys(), ...rightDefinitions.keys()])].sort()) {
        const l = leftDefinitions.get(identity) ?? [], r = rightDefinitions.get(identity) ?? [];
        if (l.length > 1 || r.length > 1) {
          issues.add(`${id} ${scope}: duplicate identity ${JSON.stringify(identity)} (${l.length} before, ${r.length} after); no records were paired for this identity.`);
          summary.unpaired += l.length + r.length; continue;
        }
        if ((!l.length || !r.length) && !comparable) { summary.unpaired += l.length + r.length; continue; }
        add(id, scope, identity, l.length ? present(l[0]!.value) : missing, r.length ? present(r[0]!.value) : missing);
      }
    }
  }
  return { format: 'mcplint-metadata-diff', schemaVersion: 1, before: stamp(before), after: stamp(after),
    complete: !issues.size, issues: [...issues], summary, changes, coverage: { before: before.collection, after: after.collection },
    notes: [
      'This compares recorded metadata, not server code, tool behavior, returned content or safety.',
      'Server IDs are matched exactly. They are labels, not authenticated identities. Renames appear as additions and removals.',
      'Object key order and list order are ignored. Array order and string contents are preserved. No JSON Schema compatibility is inferred.',
      'Hashes identify canonical decoded snapshots, including capture times; they do not authenticate their author or the server.',
      'Incomplete collection and ambiguous identities cannot establish an unchanged inventory. Missing scopes in both saved files are outside the comparison.',
    ] };
}
