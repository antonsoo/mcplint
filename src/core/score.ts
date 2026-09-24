import type { Finding, Severity } from './types.js';

/**
 * A deliberately simple, documented heuristic — not a validated metric.
 * Errors cost the most, then warnings, then info. The score floors at 0 so a
 * heavily poisoned server reads as "0", not a large negative number.
 */
const WEIGHTS: Record<Severity, number> = { error: 10, warning: 4, info: 1 };

export function computeScore(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + WEIGHTS[f.severity], 0);
  return Math.max(0, Math.round(100 - penalty));
}
