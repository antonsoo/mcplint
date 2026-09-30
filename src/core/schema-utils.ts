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

export function asSchema(value: unknown): JsonSchemaLike | undefined {
  return isPlainObject(value) ? value : undefined;
}

export function schemaProperties(schema: JsonSchemaLike | undefined): [string, JsonSchemaLike][] {
  if (!schema || !isPlainObject(schema.properties)) return [];
  return Object.entries(schema.properties).map(([k, v]) => [k, asSchema(v) ?? {}]);
}

export function requiredNames(schema: JsonSchemaLike | undefined): string[] {
  if (!schema || !Array.isArray(schema.required)) return [];
  return schema.required.filter((r): r is string => typeof r === 'string');
}

// Keywords whose string value is prose or a literal the model reads.
const TEXT_KEYWORDS = ['description', 'title', 'default', 'const', '$comment'];
// Keywords holding a list of literals the model reads.
const LIST_KEYWORDS = ['enum', 'examples'];
// Keywords mapping names to subschemas (the names are part of what the model reads, too).
const MAP_KEYWORDS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
// Keywords holding one subschema or a list of them.
const SUBSCHEMA_KEYWORDS = ['items', 'prefixItems', 'additionalProperties', 'unevaluatedProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'anyOf', 'oneOf', 'allOf'];
const MAX_SCHEMA_DEPTH = 64;

/**
 * Every string in a JSON Schema that ends up in the model's context: descriptions and titles at
 * any depth, enum/example/default/const literals, and property names. A client serializes the whole
 * schema into the prompt, so an instruction hidden in a nested property's description is just as
 * readable to the model as one in the tool's own description - and a linter that only reads the
 * top level misses it entirely.
 */
export function schemaStrings(schema: unknown, path: string, depth = 0): { field: string; text: string }[] {
  if (!isPlainObject(schema) || depth > MAX_SCHEMA_DEPTH) return [];
  const out: { field: string; text: string }[] = [];
  for (const key of TEXT_KEYWORDS) {
    const value = schema[key];
    if (typeof value === 'string' && value.length > 0) out.push({ field: `${path}.${key}`, text: value });
  }
  for (const key of LIST_KEYWORDS) {
    const value = schema[key];
    if (!Array.isArray(value)) continue;
    value.forEach((item, i) => {
      if (typeof item === 'string' && item.length > 0) out.push({ field: `${path}.${key}[${i}]`, text: item });
    });
  }
  for (const key of MAP_KEYWORDS) {
    const value = schema[key];
    if (!isPlainObject(value)) continue;
    for (const [name, sub] of Object.entries(value)) {
      out.push({ field: `${path}.${key}.${name} (name)`, text: name });
      out.push(...schemaStrings(sub, `${path}.${key}.${name}`, depth + 1));
    }
  }
  for (const key of SUBSCHEMA_KEYWORDS) {
    const value = schema[key];
    if (Array.isArray(value)) value.forEach((sub, i) => out.push(...schemaStrings(sub, `${path}.${key}[${i}]`, depth + 1)));
    else out.push(...schemaStrings(value, `${path}.${key}`, depth + 1));
  }
  return out;
}
