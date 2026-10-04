import type { LintResult } from '../core/types.js';

export function auditStatus(result: LintResult): string {
  if (!result.summary.complete) return 'Incomplete audit';
  if (result.summary.score === null) return 'No enabled servers';
  return result.summary.totalFindings ? 'Findings to review' : 'No findings';
}

export function coverageNote(result: LintResult): string {
  if (!result.summary.complete) return 'Some metadata or checks are missing. Retained data was checked; resolve the gaps and rerun before relying on a whole-target result.';
  if (result.summary.score === null) return 'All configured servers were disabled. No server metadata was inspected.';
  if (!result.target.collection?.length) return 'Scope: caller-supplied metadata. Live collection coverage was not recorded.';
  return 'Scope: collected metadata and configured rules. A completed audit and a high score do not certify that a server is safe.';
}
