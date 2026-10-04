import { readTextFile } from '../core/read-text.js';
import type { CollectionRecord, LintTarget } from '../core/types.js';
import { isPlainObject, stripBom } from '../core/schema-utils.js';
import { appendItems } from './items.js';
import { MAX_ITEMS } from './collect.js';

/** A saved list describes only the supplied snapshot, never a live server's complete inventory. */
export async function collectFile(path: string, serverId = 'file'): Promise<LintTarget> {
  const raw = await readTextFile(path);
  let parsed: unknown;
  try { parsed = JSON.parse(stripBom(raw)); }
  catch (err) { throw new Error(`${path} is not valid JSON: ${(err as Error).message}`); }
  if (Array.isArray(parsed)) parsed = { tools: parsed };
  if (!isPlainObject(parsed)) throw new Error(`${path} must contain a tools array or a {tools, prompts, resources} object.`);
  const keys = ['tools', 'prompts', 'resources', 'resourceTemplates'] as const;
  if (!keys.some(key => Object.hasOwn(parsed, key)) && !Object.hasOwn(parsed, 'instructions')) {
    throw new Error(`${path} has no "tools", "prompts", "resources" or "resourceTemplates" array.`);
  }
  const collection: CollectionRecord[] = [];
  const target: LintTarget = {
    servers: [{ id: serverId, label: path, ...(typeof parsed.instructions === 'string' ? { instructions: parsed.instructions } : {}) }],
    tools: [], prompts: [], resources: [], collection
  };
  for (const key of keys) {
    if (!Object.hasOwn(parsed, key)) continue;
    const values = parsed[key];
    const record: CollectionRecord = { serverId, scope: key === 'resourceTemplates' ? 'resources/templates/list' : `${key}/list`,
      status: 'complete', pages: 1, received: Array.isArray(values) ? values.length : 0, retained: 0 };
    if (!Array.isArray(values)) {
      record.status = 'incomplete'; record.detail = `Saved ${key} must be an array.`;
    } else {
      appendItems(target, key, values.slice(0, MAX_ITEMS), record);
      if (values.length > MAX_ITEMS) {
        record.status = 'incomplete'; record.detail = [record.detail, `Stopped at the ${MAX_ITEMS} item limit.`].filter(Boolean).join(' ');
      }
    }
    collection.push(record);
  }
  const issues: string[] = [];
  if (parsed.nextCursor !== undefined) issues.push('Saved nextCursor indicates uncollected pages (or a malformed cursor). Supply the complete list to audit it.');
  if (Object.hasOwn(parsed, 'instructions') && typeof parsed.instructions !== 'string') issues.push('Saved instructions must be a string.');
  collection.push({ serverId, scope: 'file', status: issues.length ? 'incomplete' : 'complete', pages: 0, received: 0, retained: 0,
    detail: issues.join(' ') || 'Only the supplied snapshot was inspected; no server was contacted.' });
  return target;
}
