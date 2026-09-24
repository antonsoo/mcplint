import { describe, expect, it } from 'vitest';
import { lint, shouldFail, topOffenders } from '../src/core/lint.js';
import { baseConfig, targetOf, tool } from './helpers.js';

describe('lint', () => {
  it('produces zero findings and a score of 100 for a clean target', () => {
    const t = tool({
      name: 'list_invoices',
      description: 'Lists invoices for the current account, optionally filtered by status and date.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true }
    });
    const result = lint(targetOf([t]), baseConfig());
    expect(result.findings).toHaveLength(0);
    expect(result.summary.score).toBe(100);
    expect(result.summary.toolCount).toBe(1);
  });

  it('respects a rule severity override from config', () => {
    const t = tool({ name: 't' }); // triggers description/missing (default: error)
    const result = lint(targetOf([t]), baseConfig({ severities: { 'description/missing': 'info' } }));
    expect(result.findings.find((f) => f.ruleId === 'description/missing')?.severity).toBe('info');
  });

  it('drops a finding entirely when its rule is turned off', () => {
    const t = tool({ name: 't' });
    const result = lint(targetOf([t]), baseConfig({ severities: { 'description/missing': 'off' } }));
    expect(result.findings.some((f) => f.ruleId === 'description/missing')).toBe(false);
  });

  it('respects a per-subject ignore entry', () => {
    const t = tool({ name: 't' });
    const result = lint(targetOf([t]), baseConfig({ ignore: new Set(['description/missing:t']) }));
    expect(result.findings.some((f) => f.ruleId === 'description/missing')).toBe(false);
  });

  it('aggregates bySeverity and byRule counts correctly', () => {
    const t = tool({ name: 't' }); // missing description -> at least one error
    const result = lint(targetOf([t]), baseConfig());
    const total = result.summary.bySeverity.error + result.summary.bySeverity.warning + result.summary.bySeverity.info;
    expect(total).toBe(result.summary.totalFindings);
    const byRuleTotal = Object.values(result.summary.byRule).reduce((a, b) => a + b, 0);
    expect(byRuleTotal).toBe(result.summary.totalFindings);
  });
});

describe('shouldFail', () => {
  it('is false when failOn is null regardless of findings', () => {
    const t = tool({ name: 't' });
    const result = lint(targetOf([t]), baseConfig({ failOn: null }));
    expect(shouldFail(result)).toBe(false);
  });

  it('fails on error-level findings when failOn is "error"', () => {
    const t = tool({ name: 't' }); // description/missing is an error
    const result = lint(targetOf([t]), baseConfig({ failOn: 'error' }));
    expect(shouldFail(result)).toBe(true);
  });

  it('does not fail on warning-only findings when failOn is "error"', () => {
    const t = tool({ name: 't', description: 'Gets data.' }); // too-short is a warning, not an error
    const result = lint(targetOf([t]), baseConfig({ failOn: 'error' }));
    expect(result.summary.bySeverity.error).toBe(0);
    expect(shouldFail(result)).toBe(false);
  });

  it('fails on warning-level findings when failOn is "warning"', () => {
    const t = tool({ name: 't', description: 'Gets data.' });
    const result = lint(targetOf([t]), baseConfig({ failOn: 'warning' }));
    expect(shouldFail(result)).toBe(true);
  });
});

describe('topOffenders', () => {
  it('sorts tools by estimated tokens descending', () => {
    const small = tool({ name: 'small', description: 'x' });
    const big = tool({ name: 'big', description: 'x'.repeat(2000) });
    const result = lint(targetOf([small, big]), baseConfig());
    const offenders = topOffenders(result, 2);
    expect(offenders[0]!.name).toBe('big');
    expect(offenders[0]!.tokens).toBeGreaterThan(offenders[1]!.tokens);
  });
});
