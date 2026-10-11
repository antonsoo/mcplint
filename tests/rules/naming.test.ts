import { describe, expect, it } from 'vitest';
import {
  collision,
  conventionConsistency,
  genericName,
  invalidChars,
  shadowing,
  strictClientCompat
} from '../../src/core/rules/naming.js';
import { ctxOf, tool } from '../helpers.js';

describe('naming/invalid-chars', () => {
  it('flags a space and disallowed punctuation', () => {
    const findings = invalidChars.check(ctxOf([tool({ name: 'run tool!' })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
  });

  it('flags an empty name', () => {
    expect(invalidChars.check(ctxOf([tool({ name: '' })]))).toHaveLength(1);
  });

  it('flags a name over 128 characters', () => {
    expect(invalidChars.check(ctxOf([tool({ name: 'a'.repeat(129) })]))).toHaveLength(1);
  });

  it('allows the spec example names', () => {
    const findings = invalidChars.check(ctxOf([tool({ name: 'getUser' }), tool({ name: 'DATA_EXPORT_v2' }), tool({ name: 'admin.tools.list' })]));
    expect(findings).toHaveLength(0);
  });
});

describe('naming/strict-client-compat', () => {
  it('flags a dotted name as incompatible with Anthropic/OpenAI strict validation', () => {
    const findings = strictClientCompat.check(ctxOf([tool({ name: 'admin.tools.list' })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/dot/);
  });

  it('flags a name over 64 characters (OpenAI cap) even without a dot', () => {
    const findings = strictClientCompat.check(ctxOf([tool({ name: 'a'.repeat(70) })]));
    expect(findings).toHaveLength(1);
  });

  it('does not flag a plain snake_case name', () => {
    expect(strictClientCompat.check(ctxOf([tool({ name: 'list_invoices' })]))).toHaveLength(0);
  });

  it('does not double up with invalid-chars (skips already-invalid names)', () => {
    expect(strictClientCompat.check(ctxOf([tool({ name: 'run tool!' })]))).toHaveLength(0);
  });
});

describe('naming/convention-consistency', () => {
  it('flags a server whose tool names mix snake_case and camelCase', () => {
    const tools = [tool({ name: 'list_items' }), tool({ name: 'getUser' }), tool({ name: 'delete_item' })];
    const findings = conventionConsistency.check(ctxOf(tools));
    expect(findings).toHaveLength(1);
  });

  it('does not flag a consistently snake_case server', () => {
    const tools = [tool({ name: 'list_items' }), tool({ name: 'get_item' }), tool({ name: 'delete_item' })];
    expect(conventionConsistency.check(ctxOf(tools))).toHaveLength(0);
  });

  it('skips servers with fewer than 3 tools', () => {
    const tools = [tool({ name: 'list_items' }), tool({ name: 'getUser' })];
    expect(conventionConsistency.check(ctxOf(tools))).toHaveLength(0);
  });
});

describe('naming/generic', () => {
  it.each(['run', 'execute', 'query', 'do'])('flags the generic name "%s"', (name) => {
    expect(genericName.check(ctxOf([tool({ name })]))).toHaveLength(1);
  });

  it('flags a name whose every word is generic', () => {
    for (const name of ['run_action', 'use_tool', 'execute.command']) {
      expect(genericName.check(ctxOf([tool({ name })]))).toHaveLength(1);
    }
  });

  it('does not flag a generic word beside a specific one', () => {
    // Names from widely used public servers that the two-word rule used to report.
    for (const name of ['create_task', 'overpass_query', 'distance_tool', 'admin.run', 'dry_run']) {
      expect(genericName.check(ctxOf([tool({ name })]))).toHaveLength(0);
    }
  });

  it('does not flag a specific, descriptive name', () => {
    expect(genericName.check(ctxOf([tool({ name: 'list_invoices' })]))).toHaveLength(0);
  });
});

describe('naming/collision', () => {
  it('flags identical tool names defined by two different servers', () => {
    const tools = [tool({ name: 'search', serverId: 'a' }), tool({ name: 'search', serverId: 'b' })];
    const findings = collision.check(ctxOf(tools, {}, ['a', 'b']));
    expect(findings).toHaveLength(1);
  });

  it('does not flag one definition on one server', () => {
    const tools = [tool({ name: 'search', serverId: 'a' })];
    expect(collision.check(ctxOf(tools, {}, ['a']))).toHaveLength(0);
  });

  it('flags repeated definitions on one server without removing metadata', () => {
    const tools = [tool({ name: 'read_record', description: 'Read an invoice.' }), tool({ name: 'read_record', description: 'Read a customer.' })];
    const before = structuredClone(tools);
    const findings = collision.check(ctxOf(tools));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', serverId: 's1', subject: { kind: 'tool', name: 'read_record' } });
    expect(findings[0]!.message).toContain('occurs 2 times');
    expect(tools).toEqual(before);
  });

  it('flags identical repeats once per server as well as the cross-server collision', () => {
    const tools = ['a', 'a', 'a', 'b', 'b', 'c'].map(serverId => tool({ name: 'read_record', serverId }));
    const findings = collision.check(ctxOf(tools, {}, ['a', 'b', 'c']));
    expect(findings.map(f => f.serverId)).toEqual(['a', 'b', 'a,b,c']);
    expect(findings[0]!.message).toContain('occurs 3 times');
    expect(findings[1]!.message).toContain('occurs 2 times');
  });

  it('compares exact, case-sensitive names without joining identity fields', () => {
    const tools = [tool({ name: 'read_record' }), tool({ name: 'READ_RECORD' }),
      tool({ name: 'b|c', serverId: 'a' }), tool({ name: 'c', serverId: 'a|b' })];
    expect(collision.check(ctxOf(tools, {}, ['s1', 'a', 'a|b']))).toEqual([]);
  });

  it('does not flag two different names on two servers', () => {
    const tools = [tool({ name: 'search', serverId: 'a' }), tool({ name: 'lookup', serverId: 'b' })];
    expect(collision.check(ctxOf(tools, {}, ['a', 'b']))).toHaveLength(0);
  });
});

describe('naming/shadowing', () => {
  it('flags near-identical names from two different servers', () => {
    const tools = [tool({ name: 'search_docs', serverId: 'a' }), tool({ name: 'search_doc', serverId: 'b' })];
    const findings = shadowing.check(ctxOf(tools, {}, ['a', 'b']));
    expect(findings).toHaveLength(1);
  });

  it('does not flag names from the same server', () => {
    const tools = [tool({ name: 'search_docs', serverId: 'a' }), tool({ name: 'search_doc', serverId: 'a' })];
    expect(shadowing.check(ctxOf(tools, {}, ['a']))).toHaveLength(0);
  });

  it('does not flag unrelated names', () => {
    const tools = [tool({ name: 'search_docs', serverId: 'a' }), tool({ name: 'delete_invoice', serverId: 'b' })];
    expect(shadowing.check(ctxOf(tools, {}, ['a', 'b']))).toHaveLength(0);
  });
});

it('preserves the shadowing length ratio, case-only exclusion, and two-edit cutoff', () => {
  for (const [a, b, count] of [
    ['abcde', 'abXYZ', 0], ['abcde', 'abcXY', 0],
    ['abcdefg', 'abcdeXY', 1], ['fetch_item', 'FETCH_ITEM', 0],
    ['fetch_items', 'fetch_item', 1], ['fetch_items', 'get_records', 0]
  ] as const) {
    expect(shadowing.check(ctxOf([tool({ name: a, serverId: 'a' }), tool({ name: b, serverId: 'b' })], {}, ['a', 'b']))).toHaveLength(count);
  }
});
