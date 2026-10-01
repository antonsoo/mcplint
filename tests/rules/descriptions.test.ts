import { describe, expect, it } from 'vitest';
import {
  enumUnexplained,
  missing,
  nearDuplicate,
  paramMissingDescription,
  requiredUndeclared,
  tooLong,
  tooShort
} from '../../src/core/rules/descriptions.js';
import { ctxOf, tool } from '../helpers.js';

describe('description/missing', () => {
  it('flags an absent description', () => {
    expect(missing.check(ctxOf([tool({ name: 't' })]))).toHaveLength(1);
  });
  it('flags an empty/whitespace description', () => {
    expect(missing.check(ctxOf([tool({ name: 't', description: '   ' })]))).toHaveLength(1);
  });
  it('does not flag a present description', () => {
    expect(missing.check(ctxOf([tool({ name: 't', description: 'Does a thing with enough words.' })]))).toHaveLength(0);
  });
});

describe('description/too-short', () => {
  it('flags a description under the minimum word/char count', () => {
    const findings = tooShort.check(ctxOf([tool({ name: 't', description: 'Gets data.' })]));
    expect(findings).toHaveLength(1);
  });
  it('does not flag a reasonably detailed description', () => {
    const d = 'Lists invoices for the current account, optionally filtered by status and creation date.';
    expect(tooShort.check(ctxOf([tool({ name: 't', description: d })]))).toHaveLength(0);
  });
  it('does not double-flag a missing description (handled by description/missing)', () => {
    expect(tooShort.check(ctxOf([tool({ name: 't' })]))).toHaveLength(0);
  });
});

describe('description/too-long', () => {
  it('flags a description over 1200 characters', () => {
    expect(tooLong.check(ctxOf([tool({ name: 't', description: 'x'.repeat(1201) })]))).toHaveLength(1);
  });
  it('does not flag a normal-length description', () => {
    expect(tooLong.check(ctxOf([tool({ name: 't', description: 'A reasonably sized description.' })]))).toHaveLength(0);
  });
});

describe('description/param-missing', () => {
  it('flags a parameter with no description', () => {
    const t = tool({
      name: 't',
      description: 'Does a thing with enough words to pass.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } }
    });
    expect(paramMissingDescription.check(ctxOf([t]))).toHaveLength(1);
  });
  it('does not flag a fully-described parameter', () => {
    const t = tool({
      name: 't',
      description: 'Does a thing with enough words to pass.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The id.' } } }
    });
    expect(paramMissingDescription.check(ctxOf([t]))).toHaveLength(0);
  });
});

describe('description/enum-unexplained', () => {
  it('flags an enum whose values are never mentioned in the description', () => {
    const t = tool({
      name: 't',
      description: 'Sets the priority level for a ticket.',
      inputSchema: { type: 'object', properties: { level: { type: 'string', enum: ['p0', 'p1', 'p2'] } } }
    });
    expect(enumUnexplained.check(ctxOf([t]))).toHaveLength(1);
  });
  it('does not flag when the parameter description explains at least one value', () => {
    const t = tool({
      name: 't',
      description: 'Sets the priority level for a ticket.',
      inputSchema: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['p0', 'p1', 'p2'], description: '"p0" is highest priority, "p1" and "p2" are lower.' }
        }
      }
    });
    expect(enumUnexplained.check(ctxOf([t]))).toHaveLength(0);
  });
});

describe('description/required-undeclared', () => {
  it('flags a required parameter missing from properties', () => {
    const t = tool({
      name: 't',
      inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'b'] }
    });
    expect(requiredUndeclared.check(ctxOf([t]))).toHaveLength(1);
  });
  it('does not flag when every required name is declared', () => {
    const t = tool({
      name: 't',
      inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }
    });
    expect(requiredUndeclared.check(ctxOf([t]))).toHaveLength(0);
  });
});

describe('description/near-duplicate', () => {
  it('flags two differently-named tools with near-identical descriptions', () => {
    const tools = [
      tool({ name: 'delete_customer', description: 'Permanently deletes a customer account and all associated billing records from the system.' }),
      tool({ name: 'delete_customer_record', description: 'Permanently deletes a customer record and all associated billing records from the system.' })
    ];
    expect(nearDuplicate.check(ctxOf(tools))).toHaveLength(1);
  });
  it('reports a family of similar tools once, not once per pair', () => {
    // 250 tools stamped from one template used to be 31,125 findings.
    const tools = Array.from({ length: 250 }, (_, i) =>
      tool({ name: `get_item_${i}`, description: `Fetches item number ${i} from the store and returns its fields as JSON.` })
    );
    const findings = nearDuplicate.check(ctxOf(tools));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.subject.name).toBe('get_item_0');
    expect(findings[0]!.message).toBe(
      '"get_item_0" and 249 other tools ("get_item_1", "get_item_2", "get_item_3" and 246 more) have near-identical ' +
        'descriptions: each has at least 75% word overlap with another in the group.'
    );
  });
  it('keeps unrelated groups apart and names the overlap of a pair', () => {
    const tools = [
      tool({ name: 'delete_customer', description: 'Permanently deletes a customer account and all associated billing records from the system.' }),
      tool({ name: 'list_invoices', description: 'Lists invoices for the current account by status and date range.' }),
      tool({ name: 'delete_customer_record', description: 'Permanently deletes a customer record and all associated billing records from the system.' }),
      tool({ name: 'list_all_invoices', description: 'Lists invoices for the current account by status and date range, all pages.' })
    ];
    const findings = nearDuplicate.check(ctxOf(tools));
    expect(findings.map((f) => f.subject.name)).toEqual(['delete_customer', 'list_invoices']);
    expect(findings[0]!.message).toBe('"delete_customer" and "delete_customer_record" (s1) have 85% word overlap in their descriptions.');
  });
  it('does not flag unrelated descriptions', () => {
    const tools = [
      tool({ name: 'a', description: 'Lists invoices for the current account by status and date range.' }),
      tool({ name: 'b', description: 'Translates text between languages using a machine translation model.' })
    ];
    expect(nearDuplicate.check(ctxOf(tools))).toHaveLength(0);
  });
});
