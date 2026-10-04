/** Narrow, defensive helpers for reading JSON Schema shapes out of `unknown`. */

export interface JsonSchemaLike {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: unknown;
  enum?: unknown[];
  items?: unknown;
  description?: string;
  additionalProperties?: unknown;
  [key: string]: unknown;
}

/** Strips a leading UTF-8 BOM (common in Windows-authored JSON files), which otherwise breaks JSON.parse. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A schema as the rules read it. `description` is used as text by several rules, so one that
 * isn't a string (a number, an object) is dropped here and the rules see "no description";
 * `schema/invalid` is what reports the malformed schema itself. Server metadata is untrusted:
 * a field of the wrong type must never crash a rule.
 */
export function asSchema(value: unknown): JsonSchemaLike | undefined {
  if (!isPlainObject(value)) return undefined;
  if ('description' in value && typeof value.description !== 'string') {
    const rest = { ...value };
    delete rest.description;
    return rest;
  }
  return value;
}

/**
 * A prompt's `arguments` as the rules read them: only the entries that are objects with a string
 * name, and a `description` only when it is a string.
 */
export function promptArguments(value: unknown): { name: string; description?: string; required?: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).flatMap((arg) =>
    typeof arg.name === 'string'
      ? [
          {
            name: arg.name,
            ...(typeof arg.description === 'string' ? { description: arg.description } : {}),
            ...(typeof arg.required === 'boolean' ? { required: arg.required } : {})
          }
        ]
      : []
  );
}

export function schemaProperties(schema: JsonSchemaLike | undefined): [string, JsonSchemaLike][] {
  if (!schema || !isPlainObject(schema.properties)) return [];
  return Object.entries(schema.properties).map(([k, v]) => [k, asSchema(v) ?? {}]);
}

export function requiredNames(schema: JsonSchemaLike | undefined): string[] {
  if (!schema || !Array.isArray(schema.required)) return [];
  return schema.required.filter((r): r is string => typeof r === 'string');
}

export const MAX_SCHEMA_DEPTH = 128;
export const MAX_SCHEMA_NODES = 20_000;
export const MAX_SCHEMA_TEXT = 2_000_000;
export interface SchemaTextScan {
  fields: { field: string; text: string }[];
  issue?: string;
}

/** Walk actual JSON strings and keys, including structured literals and extension keywords.
 * Iterators bound traversal memory. Limits are evidence, never silent successful checks.
 * References are inspected as text; no URLs are fetched and no $refs are expanded.
 */
export function scanSchemaStrings(schema: unknown, path: string): SchemaTextScan {
  const result: SchemaTextScan = { fields: [] };
  let visited = 0;
  let textSize = 0;
  const ancestors = new Set<object>();
  const shortPath = (value: string): string => value.length > 500 ? `${value.slice(0, 480)}...[path shortened]` : value;
  type Entry = { value: unknown; path: string; depth: number; key?: string };
  type Frame = { entries: Generator<Entry>; owner?: object };
  function* entries(value: unknown, parent: string, depth: number): Generator<Entry> {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) yield { value: value[i], path: shortPath(`${parent}[${i}]`), depth };
    } else if (isPlainObject(value)) {
      for (const key in value) {
        if (Object.hasOwn(value, key)) yield { value: value[key], path: shortPath(`${parent}.${key}`), depth, key };
      }
    }
  }
  const add = (field: string, text: string): void => {
    if (!text) return;
    const remaining = MAX_SCHEMA_TEXT - textSize;
    if (text.length > remaining) result.issue ??= `Schema text exceeds the ${MAX_SCHEMA_TEXT} character inspection limit.`;
    if (remaining > 0) result.fields.push({ field, text: text.slice(0, remaining) });
    textSize += Math.min(text.length, remaining);
  };
  function* root(): Generator<Entry> { yield { value: schema, path, depth: 0 }; }
  const stack: Frame[] = [{ entries: root() }];
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    const next = frame.entries.next();
    if (next.done) {
      if (frame.owner) ancestors.delete(frame.owner);
      stack.pop(); continue;
    }
    if (++visited > MAX_SCHEMA_NODES) { result.issue ??= `Schema exceeds the ${MAX_SCHEMA_NODES} value inspection limit.`; break; }
    const entry = next.value;
    if (entry.key !== undefined) add(`${entry.path} (name)`, entry.key);
    if (entry.depth > MAX_SCHEMA_DEPTH) { result.issue ??= `Schema exceeds the ${MAX_SCHEMA_DEPTH} level inspection limit.`; continue; }
    if (typeof entry.value === 'string') add(entry.path, entry.value);
    else if (entry.value !== null && typeof entry.value === 'object') {
      if (ancestors.has(entry.value)) { result.issue ??= 'Schema contains a cycle and is not JSON data.'; continue; }
      ancestors.add(entry.value);
      stack.push({ entries: entries(entry.value, entry.path, entry.depth + 1), owner: entry.value });
    }
  }
  return result;
}

/** Convenience API: callers must not mistake a truncated scan for a complete one. */
export function schemaStrings(schema: unknown, path: string): { field: string; text: string }[] {
  const scan = scanSchemaStrings(schema, path);
  if (scan.issue) throw new Error(scan.issue);
  return scan.fields;
}
