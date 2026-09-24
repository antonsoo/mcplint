import { describe, expect, it } from 'vitest';
import { toolTokens, totalTokens } from '../../src/core/rules/budget.js';
import { estimateToolTokens } from '../../src/core/tokenizer.js';
import { ctxOf, tool } from '../helpers.js';

describe('budget/tool-tokens', () => {
  it('does not flag a tool under budget', () => {
    const t = tool({ name: 'small', description: 'Short.' });
    const ctx = ctxOf([t], { budget: 1000 });
    expect(toolTokens.check(ctx)).toHaveLength(0);
  });

  it('flags a tool whose serialized definition exceeds the budget', () => {
    const t = tool({ name: 'big', description: 'x'.repeat(2000) });
    const ctx = ctxOf([t], { budget: 50 });
    const findings = toolTokens.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'budget/tool-tokens', severity: 'warning', subject: { name: 'big' } });
    expect(estimateToolTokens(t)).toBeGreaterThan(50);
  });
});

describe('budget/total-tokens', () => {
  it('is a no-op when no totalBudget is configured', () => {
    const t = tool({ name: 'a', description: 'x'.repeat(5000) });
    const ctx = ctxOf([t], { totalBudget: undefined });
    expect(totalTokens.check(ctx)).toHaveLength(0);
  });

  it('flags when the sum across tools exceeds totalBudget', () => {
    const tools = [tool({ name: 'a', description: 'x'.repeat(500) }), tool({ name: 'b', description: 'y'.repeat(500) })];
    const ctx = ctxOf(tools, { totalBudget: 50 });
    const findings = totalTokens.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/2 tools/);
  });

  it('does not flag when the sum is within totalBudget', () => {
    const tools = [tool({ name: 'a', description: 'short' })];
    const ctx = ctxOf(tools, { totalBudget: 10_000 });
    expect(totalTokens.check(ctx)).toHaveLength(0);
  });
});
