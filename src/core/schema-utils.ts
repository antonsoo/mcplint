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
