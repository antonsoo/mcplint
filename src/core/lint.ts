import type { Finding, LintResult, LintSummary, LintTarget, ResolvedConfig, Severity } from './types.js';
import { allRules } from './rules/index.js';
import { effectiveSeverity, isIgnored } from './config.js';
import { computeScore } from './score.js';
import { TOKENIZER_NAME } from './tokenizer.js';
import { estimateToolTokens } from './tokenizer.js';

export function lint(target: LintTarget, config: ResolvedConfig): LintResult {
  const findings: Finding[] = [];

  for (const rule of allRules) {
    const raw = rule.check({ target, config });
    for (const finding of raw) {
      const severity = effectiveSeverity(config, finding.ruleId, finding.severity);
      if (severity === 'off') continue;
      if (isIgnored(config, finding.ruleId, finding.subject.name)) continue;
      findings.push({ ...finding, severity });
    }
  }

  const bySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const byRule: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
  }

  const summary: LintSummary = {
    totalFindings: findings.length,
    bySeverity,
    byRule,
    toolCount: target.tools.length,
    promptCount: target.prompts.length,
    resourceCount: target.resources.length,
    totalEstimatedTokens: target.tools.reduce((sum, t) => sum + estimateToolTokens(t), 0),
    score: computeScore(findings)
  };

  return {
    target,
    findings,
    summary,
    config,
    generatedAt: new Date().toISOString(),
    tokenizerName: TOKENIZER_NAME
  };
}

export function shouldFail(result: LintResult): boolean {
  const { failOn } = result.config;
  if (!failOn) return false;
  if (failOn === 'error') return result.summary.bySeverity.error > 0;
  if (failOn === 'warning') return result.summary.bySeverity.error > 0 || result.summary.bySeverity.warning > 0;
  return result.summary.totalFindings > 0;
}

export function topOffenders(result: LintResult, n = 5): { name: string; tokens: number }[] {
  return [...result.target.tools]
    .map((t) => ({ name: t.name, tokens: estimateToolTokens(t) }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, n);
}
