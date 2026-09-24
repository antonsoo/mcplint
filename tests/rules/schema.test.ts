import { describe, expect, it } from 'vitest';
import { portability, validSchema } from '../../src/core/rules/schema.js';
import { ctxOf, tool } from '../helpers.js';

describe('schema/invalid', () => {
  it('flags a missing inputSchema', () => {
    const t = tool({ name: 't', inputSchema: undefined });
    expect(validSchema.check(ctxOf([t]))).toHaveLength(1);
  });
  it('flags a non-object inputSchema', () => {
    const t = tool({ name: 't', inputSchema: 'nope' });
    expect(validSchema.check(ctxOf([t]))).toHaveLength(1);
  });
  it('flags inputSchema.type !== "object"', () => {
    const t = tool({ name: 't', inputSchema: { type: 'array', items: { type: 'string' } } });
    expect(validSchema.check(ctxOf([t]))).toHaveLength(1);
  });
  it('flags a schema that fails to compile', () => {
    const t = tool({ name: 't', inputSchema: { type: 'object', properties: { a: { type: 'not-a-real-type' } } } });
    expect(validSchema.check(ctxOf([t]))).toHaveLength(1);
  });
  it('does not flag a valid schema', () => {
    const t = tool({
      name: 't',
      inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }
    });
    expect(validSchema.check(ctxOf([t]))).toHaveLength(0);
  });
});

describe('schema/portability', () => {
  it('flags optional properties without additionalProperties: false', () => {
    const t = tool({
      name: 't',
      inputSchema: { type: 'object', properties: { a: { type: 'string' } } }
    });
    const findings = portability.check(ctxOf([t]));
    expect(findings.some((f) => f.message.includes('Structured Outputs'))).toBe(true);
  });

  it('flags an external $ref', () => {
    const t = tool({
      name: 't',
      inputSchema: {
        type: 'object',
        properties: { a: { $ref: 'https://example.com/schema.json#/def' } },
        required: ['a'],
        additionalProperties: false
      }
    });
    const findings = portability.check(ctxOf([t]));
    expect(findings.some((f) => f.message.includes('external'))).toBe(true);
  });

  it('does not flag a fully-required, closed schema with only local refs', () => {
    const t = tool({
      name: 't',
      inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }
    });
    expect(portability.check(ctxOf([t]))).toHaveLength(0);
  });
});
