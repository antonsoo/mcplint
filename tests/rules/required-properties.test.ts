import { describe, expect, it } from 'vitest';
import { requiredUndeclared } from '../../src/core/rules/descriptions.js';
import { lint, shouldFail } from '../../src/core/lint.js';
import { baseConfig, ctxOf, targetOf, tool } from '../helpers.js';

const property = { type: 'string', description: 'The region to search.' };
const check = (extra: Record<string, unknown>) => requiredUndeclared.check(ctxOf([
  tool({ name: 'lookup_region', inputSchema: { type: 'object', required: ['region'], ...extra } })
]));

describe('required-property documentation is not schema validity', () => {
  it.each([
    { allOf: [{ properties: { region: property } }] },
    { anyOf: [{ properties: { region: property } }, { properties: { region: { type: 'number' } } }] },
    { oneOf: [{ properties: { region: property } }] },
    { $defs: { address: { properties: { region: property } } }, $ref: '#/$defs/address' },
    { $dynamicRef: '#address' },
    { $recursiveRef: '#' },
    { patternProperties: { '^region$': property } },
    { additionalProperties: property },
    { unevaluatedProperties: property },
    { if: { required: ['address'] }, then: { properties: { region: property } } },
    { dependentSchemas: { address: { properties: { region: property } } } },
    { dependencies: { address: { properties: { region: property } } } }
  ])('declines a local-name inference when other schemas can define the parameter: %j', extra => {
    expect(check(extra)).toEqual([]);
  });

  it('keeps a warning for a simple open schema and an error for a closed contradiction', () => {
    expect(check({})[0]?.severity).toBe('warning');
    expect(check({ additionalProperties: true })[0]?.severity).toBe('warning');
    expect(check({ properties: {}, additionalProperties: false })[0]?.severity).toBe('error');
    expect(check({ properties: { region: property }, additionalProperties: false })).toEqual([]);
  });

  it('does not borrow property documentation from an unrelated definition or nested object', () => {
    expect(check({ $defs: { unused: { properties: { region: property } } } })).toHaveLength(1);
    expect(check({ properties: { address: { type: 'object', properties: { region: property } } } })).toHaveLength(1);
  });

  it('retains the warning threshold and explicit severity overrides', () => {
    const target = targetOf([tool({ name: 'lookup_region', description: 'Find the storage location for the supplied account region.',
      inputSchema: { type: 'object', required: ['region'] } })]);
    expect(shouldFail(lint(target, baseConfig({ failOn: 'error' })))).toBe(false);
    expect(shouldFail(lint(target, baseConfig({ failOn: 'warning' })))).toBe(true);
    expect(shouldFail(lint(target, baseConfig({ failOn: 'error', severities: { 'description/required-undeclared': 'error' } })))).toBe(true);
  });
});
