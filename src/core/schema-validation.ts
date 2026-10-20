import { createRequire } from 'node:module';
import { Ajv } from 'ajv';
import { Ajv2019 } from 'ajv/dist/2019.js';
import { Ajv2020, MissingRefError } from 'ajv/dist/2020.js';
import { isPlainObject, scanSchemaStrings } from './schema-utils.js';

type Dialect = '06' | '07' | '2019-09' | '2020-12';
type Validator = Ajv | Ajv2019 | Ajv2020;
export type SchemaCheck = { status: 'valid' } | { status: 'invalid' | 'unchecked'; reason: string };

const dialectUris: Record<Dialect, string> = {
  '06': 'http://json-schema.org/draft-06/schema',
  '07': 'http://json-schema.org/draft-07/schema',
  '2019-09': 'https://json-schema.org/draft/2019-09/schema',
  '2020-12': 'https://json-schema.org/draft/2020-12/schema'
};

export function dialectOf(uri: string): Dialect | undefined {
  const normalized = uri.replace(/^https?:/, '').replace(/#$/, '');
  return (Object.keys(dialectUris) as Dialect[]).find(key =>
    dialectUris[key].replace(/^https?:/, '') === normalized);
}

// Clear every user resource after each check, including nested IDs registered by failed compiles.
// Ajv's code-generation scope also retains compiled functions after removeSchema(), so periodically
// replace the entire instance. Amortize meta-schema compilation without an unbounded process cache.
const VALIDATOR_BATCH_SIZE = 32;
const validators = new Map<Dialect, { validator: Validator; uses: number }>();
function validatorFor(dialect: Dialect): Validator {
  let entry = validators.get(dialect);
  if (!entry || entry.uses >= VALIDATOR_BATCH_SIZE) {
    // Validate the meta-schema explicitly, so compiler restrictions (e.g. OpenAPI nullable)
    // are distinguishable from demonstrably malformed JSON Schema.
    const options = { strict: false, allErrors: false, logger: false as const, inlineRefs: false, validateSchema: false };
    const validator = dialect === '2020-12' ? new Ajv2020(options)
      : dialect === '2019-09' ? new Ajv2019(options) : new Ajv(options);
    if (dialect === '06') {
      const require = createRequire(import.meta.url);
      validator.addMetaSchema(require('ajv/dist/refs/json-schema-draft-06.json') as Record<string, unknown>);
    }
    entry = { validator, uses: 0 };
    validators.set(dialect, entry);
  }
  entry.uses++;
  return entry.validator;
}

const singleSchemas = ['additionalProperties', 'additionalItems', 'unevaluatedProperties',
  'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema'];
const schemaMaps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'];
const schemaArrays = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

/** Inspect schema positions, not objects inside const/enum/default/examples. Preflight also bounds
 * arbitrary extension/literal data and rejects cycles before the compiler or this walker sees it.
 */
export function schemaNodes(schema: Record<string, unknown>): {
  nodes: Record<string, unknown>[]; issue?: string;
} {
  const scan = scanSchemaStrings(schema, 'schema');
  if (scan.issue) return { nodes: [], issue: scan.issue };
  const nodes: Record<string, unknown>[] = [];
  const pending = [schema];
  const add = (value: unknown): void => { if (isPlainObject(value)) pending.push(value); };
  while (pending.length) {
    const node = pending.pop()!;
    nodes.push(node);
    for (const key of singleSchemas) add(node[key]);
    for (const key of schemaMaps) {
      const map = node[key];
      if (isPlainObject(map)) for (const value of Object.values(map)) add(value);
    }
    for (const key of [...schemaArrays, 'items']) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(add);
      else if (key === 'items') add(value);
    }
  }
  return { nodes };
}

/** Synchronous, offline compilation of one self-contained schema. Never resolves another tool's
 * resources, fetches a URL, or treats a compiler/inspection limit as a successful validation.
 */
export function checkSchema(schema: Record<string, unknown>): SchemaCheck {
  const { nodes, issue } = schemaNodes(schema);
  if (issue) return { status: 'unchecked', reason: issue };
  if (schema.$schema !== undefined && typeof schema.$schema !== 'string') {
    return { status: 'invalid', reason: '$schema must be a URI string.' };
  }
  const dialect = schema.$schema === undefined ? '2020-12' : dialectOf(schema.$schema);
  if (!dialect) return { status: 'unchecked', reason: `Unsupported JSON Schema dialect ${JSON.stringify(schema.$schema)}.` };
  for (const node of nodes) {
    if (node === schema || node.$schema === undefined) continue;
    if (typeof node.$schema !== 'string') return { status: 'invalid', reason: 'A nested $schema must be a URI string.' };
    if (dialectOf(node.$schema) !== dialect) {
      return { status: 'unchecked', reason: `Nested dialect ${JSON.stringify(node.$schema)} differs from the root dialect; mixed dialect resources are not supported.` };
    }
  }
  const validator = validatorFor(dialect);
  try {
    // Normalize known URI aliases without discarding the declared dialect or mutating the input.
    const declared = { ...schema, $schema: dialectUris[dialect] };
    if (!validator.validateSchema(declared)) {
      return { status: 'invalid', reason: `schema is invalid: ${validator.errorsText()}` };
    }
    validator.compile(declared);
    return { status: 'valid' };
  } catch (error) {
    if (error instanceof MissingRefError) {
      return { status: 'unchecked', reason: `Unresolved schema reference ${JSON.stringify(error.missingRef)}. Only resources supplied within this schema and built-in meta-schemas are available; external schemas are not fetched.` };
    }
    if (error instanceof RangeError) {
      return { status: 'unchecked', reason: `JSON Schema compiler limit reached: ${error.message}` };
    }
    return { status: 'unchecked', reason: `JSON Schema compiler could not finish: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    validator.removeSchema();
  }
}
