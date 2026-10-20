import { dialectOf } from './schema-validation.js';
import { isPlainObject, scanSchemaStrings } from './schema-utils.js';

const TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
type Dialect = NonNullable<ReturnType<typeof dialectOf>>;
type Position = { schema: Record<string, unknown>; path: string[]; dialect: Dialect };

export interface EnumTypeConflict {
  /** JSON Pointer into the supplied schema. Long names are explicitly shortened. */
  pointer: string;
  declaredTypes: string[];
  valueTypes: string[];
  choices: number;
}

function valueType(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return typeof value;
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? 'integer' : 'number';
  if (Array.isArray(value)) return 'array';
  if (isPlainObject(value) && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype)
    && typeof value.toJSON !== 'function') return 'object';
  // A decoded library object is not necessarily JSON data (e.g. Date or undefined).
  return undefined;
}

function pointer(path: string[]): string {
  let result = '#';
  for (const part of path) {
    result += '/' + part.replaceAll('~', '~0').replaceAll('/', '~1');
    if (result.length > 500) return result.slice(0, 480) + '...[path shortened]';
  }
  return result;
}

/** A finite enum supplies the complete candidate set. If type excludes every
 * member, no JSON value can satisfy this subschema. This is deliberately not
 * a satisfiability solver: optional properties may be omitted, and other union
 * branches may remain usable. Never execute patterns, resolve refs or coerce data.
 */
export function enumTypeConflicts(schema: Record<string, unknown>): EnumTypeConflict[] {
  // Bound literal/extension data too, and reject cycles before traversing schemas.
  if (scanSchemaStrings(schema, 'schema').issue) return [];
  const rootDialect = schema.$schema === undefined ? '2020-12'
    : typeof schema.$schema === 'string' ? dialectOf(schema.$schema) : undefined;
  if (!rootDialect) return [];
  const pending: Position[] = [{ schema, path: [], dialect: rootDialect }];
  const result: EnumTypeConflict[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    const node = current.schema;
    const dialect = node.$schema === undefined ? current.dialect
      : typeof node.$schema === 'string' ? dialectOf(node.$schema) : undefined;
    if (!dialect) continue;
    // In draft-06/07 a $ref object ignores ALL sibling keywords, including
    // properties. Inspecting those children would invent active constraints.
    if ((dialect === '06' || dialect === '07') && typeof node.$ref === 'string') continue;
    const types = typeof node.type === 'string' ? [node.type] : Array.isArray(node.type) ? node.type : [];
    if (Object.hasOwn(node, 'type') && Object.hasOwn(node, 'enum')
      && types.length && types.every((type): type is string => typeof type === 'string' && TYPES.has(type))
      && Array.isArray(node.enum) && node.enum.length && node.nullable === undefined) {
      const values = node.enum.map(valueType);
      if (values.every((type): type is string => type !== undefined)
        && !values.some(value => types.includes(value) || value === 'integer' && types.includes('number'))) {
        result.push({ pointer: pointer(current.path), declaredTypes: types,
          valueTypes: [...new Set(values)], choices: values.length });
      }
    }
    const add = (value: unknown, ...parts: string[]): void => {
      if (isPlainObject(value)) pending.push({ schema: value, path: [...current.path, ...parts], dialect });
    };
    const modern = dialect === '2019-09' || dialect === '2020-12';
    const maps = ['properties', 'patternProperties', 'definitions', 'dependencies',
      ...(modern ? ['$defs', 'dependentSchemas'] : [])];
    for (const key of maps) {
      const map = node[key];
      if (isPlainObject(map)) for (const [name, child] of Object.entries(map)) add(child, key, name);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', ...(dialect === '2020-12' ? ['prefixItems'] : []), 'items']) {
      const value = node[key];
      if (Array.isArray(value) && !(key === 'items' && dialect === '2020-12')) value.forEach((child, index) => add(child, key, String(index)));
      else if (key === 'items') add(value, key);
    }
    for (const key of ['additionalProperties', 'contains', 'propertyNames',
      ...(dialect !== '2020-12' ? ['additionalItems'] : []),
      ...(modern ? ['unevaluatedProperties', 'unevaluatedItems'] : [])]) add(node[key], key);
    if (dialect !== '06' && (isPlainObject(node.if) || typeof node.if === 'boolean')) {
      for (const key of ['then', 'else']) add(node[key], key);
    }
    // not/if are conditions, not advertised value choices. Literal objects in
    // const/enum/default/examples and extension data are never schema positions.
  }
  return result;
}
