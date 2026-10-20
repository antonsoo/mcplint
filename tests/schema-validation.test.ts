import { describe, expect, it } from 'vitest';
import { checkSchema } from '../src/core/schema-validation.js';
import { lint, shouldFail } from '../src/core/lint.js';
import { portability, validSchema } from '../src/core/rules/schema.js';
import { baseConfig, ctxOf, targetOf, tool } from './helpers.js';

const identified = {
  $id: 'https://example.invalid/record', type: 'object',
  properties: { id: { type: 'string' } }, required: ['id']
};
const referring = { type: 'object', properties: { record: { $ref: identified.$id } } };

describe('independent schema resources', () => {
  it('keeps built-in meta-schema references available beyond compiler replacement boundaries', () => {
    for (const $schema of [
      'http://json-schema.org/draft-06/schema', 'http://json-schema.org/draft-07/schema',
      'https://json-schema.org/draft/2019-09/schema', 'https://json-schema.org/draft/2020-12/schema'
    ]) {
      for (let i = 0; i < 40; i++) {
        expect(checkSchema({ $schema, type: 'object', properties: { schema: { $ref: $schema } } }).status).toBe('valid');
        expect(checkSchema({ $schema, type: 'object', properties: { schema: 12 } }).status).toBe('invalid');
      }
    }
  });

  it('accepts the same $id in different tools, schema fields, and repeated audits', () => {
    const tools = ['read_record', 'write_record'].map(name => tool({
      name, inputSchema: structuredClone(identified), outputSchema: structuredClone(identified)
    }));
    // Cross several compiler-recycling boundaries in one long-lived caller.
    for (let run = 0; run < 40; run++) expect(validSchema.check(ctxOf(tools))).toEqual([]);
  });

  it('does not resolve a reference using a previous tool or audit', () => {
    expect(checkSchema(referring).status).toBe('unchecked');
    expect(checkSchema(identified).status).toBe('valid');
    expect(checkSchema(referring).status).toBe('unchecked');
    for (const tools of [[identified, referring], [referring, identified]]) {
      const result = validSchema.check(ctxOf(tools.map((inputSchema, i) => tool({ name: `read_${i}`, inputSchema }))));
      expect(result).toHaveLength(1);
      expect(result[0]?.ruleId).toBe('safety/unchecked');
      expect(result[0]?.message).toContain('Unresolved schema reference');
    }
  });

  it('cleans nested resources and anchors after both successful and failed compilations', () => {
    for (const fail of [false, true]) {
      const schema = {
        type: 'object',
        $defs: { record: { ...identified, $anchor: 'record' } },
        properties: { record: { $ref: fail ? 'https://example.invalid/missing' : `${identified.$id}#record` } }
      };
      expect(checkSchema(schema).status).toBe(fail ? 'unchecked' : 'valid');
      expect(checkSchema(referring).status).toBe('unchecked');
      expect(checkSchema({ ...referring, properties: { record: { $ref: `${identified.$id}#record` } } }).status).toBe('unchecked');
      expect(checkSchema(identified).status).toBe('valid');
    }
  });

  it('resolves bundled relative resources and recursive local references', () => {
    expect(checkSchema({
      $id: 'https://example.invalid/root', type: 'object',
      $defs: { record: { $id: 'record', type: 'string' } },
      properties: { record: { $ref: 'record' }, child: { $ref: '#' } }
    }).status).toBe('valid');
  });
});

describe('declared dialects', () => {
  const tuple = { type: 'object', properties: { pair: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] } } };
  it.each(['06', '07'])('supports actual draft-%s tuple syntax, including URI aliases and repeated checks', draft => {
    for (const scheme of ['http', 'https']) {
      for (const fragment of ['', '#']) {
        for (let repeat = 0; repeat < 2; repeat++) {
          expect(checkSchema({ ...tuple, $schema: `${scheme}://json-schema.org/draft-${draft}/schema${fragment}` }).status).toBe('valid');
        }
      }
    }
  });

  it('supports 2019-09 tuple syntax and rejects it under default/explicit 2020-12', () => {
    expect(checkSchema({ ...tuple, $schema: 'https://json-schema.org/draft/2019-09/schema' }).status).toBe('valid');
    expect(checkSchema(tuple).status).toBe('invalid');
    expect(checkSchema({ ...tuple, $schema: 'https://json-schema.org/draft/2020-12/schema' }).status).toBe('invalid');
  });

  it('accepts 2020-12 prefixItems and detects malformed dialect-specific keywords', () => {
    expect(checkSchema({ type: 'array', prefixItems: [{ type: 'string' }], items: false }).status).toBe('valid');
    expect(checkSchema({ type: 'array', prefixItems: { type: 'string' } }).status).toBe('invalid');
    expect(checkSchema({ type: 'object', unevaluatedProperties: 42 }).status).toBe('invalid');
    expect(checkSchema({ $schema: 'http://json-schema.org/draft-07/schema', exclusiveMinimum: true }).status).toBe('invalid');
  });

  it('distinguishes unsupported, mixed, and malformed dialect declarations', () => {
    for (const $schema of ['http://json-schema.org/draft-04/schema#', 'https://example.invalid/custom']) {
      expect(checkSchema({ type: 'object', $schema }).status).toBe('unchecked');
    }
    expect(checkSchema({ type: 'object', $schema: null }).status).toBe('invalid');
    expect(checkSchema({ type: 'object', $defs: { legacy: { $schema: 'http://json-schema.org/draft-07/schema#' } } }).status).toBe('unchecked');
    expect(checkSchema({ type: 'object', properties: { record: { $schema: false } } }).status).toBe('invalid');
  });

  it('does not interpret schema-like literal data as reference or dialect declarations', () => {
    const literal = { $ref: 'https://example.invalid/data', $schema: 'user text', $id: 'also data' };
    const schema = { type: 'object', properties: { record: { const: literal, default: literal, examples: [literal] } } };
    expect(checkSchema(schema).status).toBe('valid');
    expect(portability.check(ctxOf([tool({ name: 'read_record', inputSchema: schema })])).some(f => f.message.includes('external'))).toBe(false);
  });

  it('does not call a meta-schema-valid extension invalid because the compiler rejects it', () => {
    // nullable is an OpenAPI extension, not a JSON Schema validation keyword. Ajv's built-in
    // support rejects this without a type; the JSON Schema meta-schema accepts it.
    const result = checkSchema({ type: 'object', properties: { value: { nullable: true } } });
    expect(result.status).toBe('unchecked');
    if (result.status !== 'valid') expect(result.reason).toContain('compiler could not finish');
  });
});

describe('output schemas and incomplete audits', () => {
  it.each([null, true, [], { type: 'object', properties: { count: { type: 'not-a-type' } } }])(
    'reports a malformed supplied output schema: %j', outputSchema => {
      const findings = validSchema.check(ctxOf([tool({ name: 'read_record', outputSchema })]));
      expect(findings).toHaveLength(1);
      expect(findings[0]?.ruleId).toBe('schema/invalid');
      expect(findings[0]?.message).toContain('outputSchema');
    }
  );
  it.each([{}, { type: 'array', items: { type: 'string' } }, { type: 'string' }, { type: ['number', 'null'] }])(
    'accepts current MCP output schemas describing non-object values: %j', outputSchema => {
      expect(validSchema.check(ctxOf([tool({ name: 'read_record', outputSchema })]))).toEqual([]);
    }
  );

  it('checks output and sibling tools even when the first input is invalid', () => {
    const findings = validSchema.check(ctxOf([
      tool({ name: 'first', inputSchema: null, outputSchema: { type: 'bad' } }),
      tool({ name: 'second', outputSchema: { properties: { result: { type: 'bad' } } } })
    ]));
    expect(findings.map(f => f.subject.name)).toEqual(['first', 'first', 'second']);
  });

  it('leaves score unavailable and fails CI even when unresolved-reference errors are suppressed', () => {
    const config = baseConfig({ failOn: 'error', severities: { 'safety/unchecked': 'off' } });
    const result = lint(targetOf([tool({ name: 'read_record', outputSchema: { $ref: 'https://example.invalid/not-supplied' } })]), config);
    expect(result.findings.some(f => f.ruleId === 'safety/unchecked')).toBe(false);
    expect(result.summary.complete).toBe(false);
    expect(result.summary.score).toBeNull();
    expect(shouldFail(result)).toBe(true);
  });

  it('bounds cyclic and oversized schemas before compilation and continues with sibling tools', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic.properties = { again: cyclic };
    const oversized = { type: 'object', enum: Array.from({ length: 20_001 }, (_, i) => i) };
    for (const inputSchema of [cyclic, oversized]) {
      const findings = validSchema.check(ctxOf([tool({ name: 'read_record', inputSchema }), tool({ name: 'other', outputSchema: null })]));
      expect(findings.map(f => f.ruleId)).toEqual(['safety/unchecked', 'schema/invalid']);
      expect(() => portability.check(ctxOf([tool({ name: 'read_record', inputSchema })]))).not.toThrow();
    }
  });

  it('does not serialize a malformed cyclic type value when reporting it', () => {
    const type: Record<string, unknown> = {};
    type.again = type;
    const findings = validSchema.check(ctxOf([
      tool({ name: 'cyclic_type', inputSchema: { type } }),
      tool({ name: 'broken_output', outputSchema: null })
    ]));
    expect(findings.map(f => f.ruleId)).toEqual(['schema/invalid', 'schema/invalid']);
  });

  it('compiles a reference diamond without exponentially inlining its descendants', () => {
    const $defs: Record<string, unknown> = { leaf: { type: 'string' } };
    let previous = 'leaf';
    for (let depth = 0; depth < 24; depth++) {
      const name = `level${depth}`;
      $defs[name] = { type: 'object', properties: { left: { $ref: `#/$defs/${previous}` }, right: { $ref: `#/$defs/${previous}` } } };
      previous = name;
    }
    expect(checkSchema({ type: 'object', $defs, properties: { tree: { $ref: `#/$defs/${previous}` } } }).status).toBe('valid');
  });
});
