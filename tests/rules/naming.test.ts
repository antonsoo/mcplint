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

  it('flags a generic suffix after a namespace separator', () => {
    expect(genericName.check(ctxOf([tool({ name: 'admin.run' })]))).toHaveLength(1);
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

  it('does not flag when only one server is in scope', () => {
    const tools = [tool({ name: 'search', serverId: 'a' })];
    expect(collision.check(ctxOf(tools, {}, ['a']))).toHaveLength(0);
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
