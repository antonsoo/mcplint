import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { enumTypeConflicts } from '../src/core/schema-enum-types.js';
import { enumTypes } from '../src/core/rules/enum-types.js';
import { ctxOf, tool } from './helpers.js';

describe('unusable enum choices', () => {
  it('finds native number/string and boolean/string contradictions without calling them invalid syntax', () => {
    const schema = {
      type: 'object', properties: {
        duration: { type: 'number', enum: ['5', '10'] },
        isPrivate: { type: 'boolean', enum: ['true', 'false'] }
      }
    };
    const result = enumTypes.check(ctxOf([tool({ name: 'generate_video', inputSchema: schema })]));
    expect(result).toHaveLength(2);
    expect(result.every(row => row.severity === 'warning' && row.ruleId === 'schema/enum-type')).toBe(true);
    expect(result.map(row => row.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('inputSchema#/properties/duration'),
      expect.stringContaining('inputSchema#/properties/isPrivate')
    ]));
    expect(result.every(row => row.detail?.includes('optional properties may be omitted'))).toBe(true);
    const validate = new Ajv2020({ strict: false, coerceTypes: false }).compile(schema);
    expect(validate({})).toBe(true);
    for (const value of ['5', '10', 5, 10]) expect(validate({ duration: value })).toBe(false);
    for (const value of ['true', 'false', true, false]) expect(validate({ isPrivate: value })).toBe(false);
  });

  it('agrees with an independent instance validator across JSON types and type unions', () => {
    const ajv = new Ajv2020({ strict: false, coerceTypes: false, allowUnionTypes: true });
    const values = [null, false, true, 0, -1, 1.5, '', '5', [], [1], {}, { x: 1 }];
    const types: (string | string[])[] = ['null', 'boolean', 'number', 'integer', 'string', 'array', 'object',
      ['string', 'null'], ['integer', 'boolean'], ['object', 'array']];
    for (const type of types) for (const value of values) {
      const schema = { type, enum: [value] };
      const validate = ajv.compile(schema);
      expect(enumTypeConflicts(schema).length, JSON.stringify(schema)).toBe(validate(value) ? 0 : 1);
    }
    expect(enumTypeConflicts({ type: 'number', enum: [1, 'sentinel'] })).toEqual([]);
    expect(enumTypeConflicts({ enum: ['true', 'false'] })).toEqual([]);
  });

  it('checks output schemas, nested arrays and positive branches, preserving escaped pointers', () => {
    const bad = { type: 'boolean', enum: ['false'] };
    const inputSchema = { type: 'object', properties: { 'a/~b': { type: 'array', items: bad } } };
    const outputSchema = { anyOf: [{ type: 'string', enum: [3] }, { type: 'null' }] };
    const findings = enumTypes.check(ctxOf([tool({ name: 'example', inputSchema, outputSchema })]));
    expect(findings).toHaveLength(2);
    expect(findings[0]?.message).toContain('inputSchema#/properties/a~1~0b/items');
    expect(findings[1]?.message).toContain('outputSchema#/anyOf/0');
  });

  it('does not turn literals, negation or if conditions into advertised value constraints', () => {
    const bad = { type: 'boolean', enum: ['false'] };
    expect(enumTypeConflicts({ type: 'object', const: bad, default: bad, examples: [bad], extension: bad })).toEqual([]);
    expect(enumTypeConflicts({ not: bad, if: bad })).toEqual([]);
    expect(enumTypeConflicts({ then: bad, else: bad })).toEqual([]);
    expect(enumTypeConflicts({ if: {}, then: bad })).toHaveLength(1);
    expect(enumTypeConflicts({ properties: { not: bad, if: bad } })).toHaveLength(2);
  });

  it('respects ignored legacy ref siblings and dialect-specific schema positions', () => {
    const bad = { type: 'boolean', enum: ['false'] };
    for (const draft of ['06', '07']) {
      const $schema = `http://json-schema.org/draft-${draft}/schema#`;
      expect(enumTypeConflicts({ $schema, $ref: '#/definitions/x', ...bad, properties: { x: bad } })).toEqual([]);
      expect(enumTypeConflicts({ $schema, $defs: { x: bad }, prefixItems: [bad] })).toEqual([]);
      expect(enumTypeConflicts({ $schema, definitions: { x: bad }, items: [bad] })).toHaveLength(2);
    }
    expect(enumTypeConflicts({ $ref: '#', ...bad })).toHaveLength(1);
    expect(enumTypeConflicts({ prefixItems: [bad], items: [bad] })).toHaveLength(1);
    expect(enumTypeConflicts({ $schema: 'https://example.invalid/custom', ...bad })).toEqual([]);
    expect(enumTypeConflicts({ properties: { x: { $schema: 'https://example.invalid/custom', ...bad } } })).toEqual([]);
    expect(enumTypeConflicts({ ...bad, nullable: true })).toEqual([]);
  });

  it('retains limits and does not manufacture evidence from malformed library values', () => {
    const cyclic: Record<string, unknown> = { type: 'boolean', enum: ['false'] };
    cyclic.properties = { child: cyclic };
    expect(enumTypeConflicts(cyclic)).toEqual([]);
    expect(enumTypeConflicts({ type: 'boolean', enum: [undefined] })).toEqual([]);
    expect(enumTypeConflicts({ type: 'string', enum: [new Date(0)] })).toEqual([]);
    expect(enumTypeConflicts({ type: [], enum: ['false'] })).toEqual([]);
    const key = 'x'.repeat(20_000);
    const result = enumTypeConflicts({ properties: { [key]: { type: 'boolean', enum: ['false'] } } });
    expect(result).toHaveLength(1);
    expect(result[0]?.pointer.length).toBeLessThan(510);
    expect(result[0]?.pointer).toContain('[path shortened]');
  });
});
