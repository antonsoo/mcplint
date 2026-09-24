import type { Finding, LintTarget, Severity } from './types.js';

/**
 * A deliberately simple, documented heuristic — not a validated metric.
 *
 * Two components, computed separately and then combined, because "how well
 * documented is this server" and "does any tool try to do something
 * malicious" need opposite treatment when a server has many tools:
 *
 * Quality (budget/naming/description/schema findings): averaged per item.
 * Every collected tool/prompt/resource starts at 100 and loses points for
 * its own findings (error 10, warning 4, info 1), floored at 0; the quality
 * score is the average across every item, including clean ones (so a
 * 14-tool server with a handful of missing parameter descriptions isn't
 * scored as if it were one giant tool with all of them). Whole-server
 * findings (`naming/convention-consistency`, `budget/total-tokens`, a
 * `naming/collision`/`naming/shadowing` pair) are subtracted from that
 * average once.
 *
 * Safety (hidden Unicode, prompt injection, secret access, cross-tool
 * reference, encoded blobs, missing destructive annotations): summed
 * across every item, *not* averaged. A tool-poisoning attack targets one
 * tool, not the average tool — a 50-tool server with 49 clean tools and one
 * that tries to exfiltrate `~/.ssh` is not "98% safe," it's not safe to
 * install. The safety penalty is subtracted straight from the quality
 * score, so a single malicious tool can drag even a well-documented, many-
 * tool server's score to near zero, same as it would for a small one.
 *
 * The combined result is clamped to [0, 100]. A target with nothing
 * collected, or where nothing triggered a rule, scores 100.
 */
const WEIGHTS: Record<Severity, number> = { error: 10, warning: 4, info: 1 };

function categoryOf(ruleId: string): string {
  return ruleId.split('/')[0] ?? ruleId;
}

export function computeScore(findings: Finding[], target: LintTarget): number {
  const perItem = new Map<string, number>();
  for (const t of target.tools) perItem.set(`tool:${t.name}`, 100);
  for (const p of target.prompts) perItem.set(`prompt:${p.name}`, 100);
  for (const r of target.resources) perItem.set(`resource:${r.name}`, 100);

  let qualityServerPenalty = 0;
  let safetyPenalty = 0;

  for (const f of findings) {
    const weight = WEIGHTS[f.severity];
    if (categoryOf(f.ruleId) === 'safety') {
      safetyPenalty += weight;
      continue;
    }
    const key = `${f.subject.kind}:${f.subject.name}`;
    if (perItem.has(key)) {
      perItem.set(key, (perItem.get(key) ?? 100) - weight);
    } else {
      qualityServerPenalty += weight;
    }
  }

  const itemScores = [...perItem.values()].map((s) => Math.max(0, s));
  const qualityScore = itemScores.length > 0 ? itemScores.reduce((a, b) => a + b, 0) / itemScores.length : 100;

  return Math.max(0, Math.min(100, Math.round(qualityScore - qualityServerPenalty - safetyPenalty)));
}
