import { z } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { CollectionRecord, LintTarget, ListMethod, ServerInfo } from '../core/types.js';
import { appendItems } from './items.js';
import { listResultIssue } from './list-result.js';

// Validate the envelope ourselves, retaining usable items even when its cursor is malformed.
// SDK listTools() validates the entire list and would hide good tools next to a malformed one.
const LENIENT_LIST_SCHEMA = z.object({}).passthrough();
type ListKey = 'tools' | 'prompts' | 'resources' | 'resourceTemplates';
export const MAX_PAGES = 1000;
export const MAX_ITEMS = 100_000;
export const MAX_LIST_DURATION_MS = 60_000;
const PAGE_TIMEOUT_MS = 10_000;

export interface ListedItems {
  items: unknown[];
  status: 'complete' | 'incomplete' | 'unsupported';
  pages: number;
  received: number;
  detail?: string;
}

/** Partial results always carry their coverage; an exception must never mean an empty list. */
export async function listAll(client: Pick<Client, 'request'>, method: ListMethod, key: ListKey, allowUnsupported = false): Promise<ListedItems> {
  const items: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  let received = 0;
  const deadline = performance.now() + MAX_LIST_DURATION_MS;
  const finish = (status: ListedItems['status'], detail?: string): ListedItems =>
    ({ items, status, pages, received, ...(detail ? { detail } : {}) });
  for (let page = 0; page < MAX_PAGES; page++) {
    let result: z.infer<typeof LENIENT_LIST_SCHEMA>;
    try {
      const remaining = deadline - performance.now();
      if (remaining <= 0) return finish('incomplete', 'Stopped at the 60 second list collection deadline.');
      const timeout = Math.max(1, Math.min(PAGE_TIMEOUT_MS, remaining));
      result = await client.request({ method, params: cursor === undefined ? {} : { cursor } }, LENIENT_LIST_SCHEMA,
        { timeout, maxTotalTimeout: timeout });
    } catch (error) {
      if (page === 0 && allowUnsupported && typeof error === 'object' && error !== null && 'code' in error && error.code === ErrorCode.MethodNotFound) {
        return finish('unsupported', 'Server reports that this optional method is unsupported.');
      }
      // Do not echo server-controlled errors that can contain credentials or entire response bodies.
      return finish('incomplete', `Request for page ${page + 1} failed. Check server availability, authorization and response format, then retry.`);
    }
    pages++;
    const resultIssue = listResultIssue(result);
    const values = result[key];
    if (!Array.isArray(values)) return finish('incomplete', resultIssue ?? `Page ${page + 1} has no valid ${key} array.`);
    received += values.length;
    const remaining = MAX_ITEMS - items.length;
    for (let i = 0; i < Math.min(values.length, remaining); i++) items.push(values[i]);
    if (values.length > remaining) return finish('incomplete', [resultIssue,
      `Stopped at the ${MAX_ITEMS} item limit; remaining items were not inspected.`].filter(Boolean).join(' '));
    if (resultIssue) return finish('incomplete', `Page ${page + 1}: ${resultIssue}`);
    if (result.nextCursor === undefined) return finish('complete');
    if (typeof result.nextCursor !== 'string') return finish('incomplete', `Page ${page + 1} has a non-string nextCursor.`);
    cursor = result.nextCursor;
    if (seen.has(cursor)) return finish('incomplete', `Page ${page + 1} repeats a pagination cursor; remaining coverage is unknown.`);
    seen.add(cursor);
    if (items.length === MAX_ITEMS) return finish('incomplete', `Stopped at the ${MAX_ITEMS} item limit with more pages available.`);
  }
  return finish('incomplete', `Stopped at the ${MAX_PAGES} page limit with more pages available.`);
}

export async function collectFromClient(client: Client, serverId: string, label: string): Promise<LintTarget> {
  const version = client.getServerVersion();
  const instructions = client.getInstructions();
  const server: ServerInfo = {
    id: serverId, label,
    ...(version?.name !== undefined ? { name: version.name } : {}),
    ...(version?.version !== undefined ? { version: version.version } : {}),
    ...(instructions !== undefined ? { instructions } : {})
  };
  const collection: CollectionRecord[] = [];
  const capabilities = client.getServerCapabilities();
  const target: LintTarget = { servers: [server], tools: [], prompts: [], resources: [], collection,
    metadata: { servers: [{ id: serverId, ...(version !== undefined ? { serverInfo: version } : {}),
      ...(instructions !== undefined ? { instructions } : {}), ...(capabilities !== undefined ? { capabilities } : {}) }], definitions: [] } };
  const lists = [
    ['tools/list', 'tools', 'tools'], ['prompts/list', 'prompts', 'prompts'],
    ['resources/list', 'resources', 'resources'], ['resources/templates/list', 'resourceTemplates', 'resources']
  ] as const;
  for (const [method, key, capability] of lists) {
    if (capabilities?.[capability] === undefined) {
      collection.push({ serverId, scope: method, status: 'unsupported', pages: 0, received: 0, retained: 0, detail: `Server did not advertise ${capability}.` });
      continue;
    }
    const listed = await listAll(client, method, key, method === 'resources/templates/list');
    const record: CollectionRecord = { serverId, scope: method, status: listed.status, pages: listed.pages, received: listed.received, retained: 0,
      ...(listed.detail ? { detail: listed.detail } : {}) };
    appendItems(target, key, listed.items, record);
    collection.push(record);
  }
  return target;
}

export function mergeTargets(targets: LintTarget[]): LintTarget {
  return {
    servers: targets.flatMap(t => t.servers), tools: targets.flatMap(t => t.tools),
    prompts: targets.flatMap(t => t.prompts), resources: targets.flatMap(t => t.resources),
    collection: targets.flatMap(t => t.collection ?? []),
    ...(targets.every(t => t.metadata) ? { metadata: {
      servers: targets.flatMap(t => t.metadata!.servers), definitions: targets.flatMap(t => t.metadata!.definitions)
    } } : {})
  };
}
