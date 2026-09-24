import type { Finding, LintResult, Severity } from '../core/types.js';
import { topOffenders } from '../core/lint.js';
import { ruleSlug } from '../core/rule-slug.js';

const BADGE: Record<Severity, string> = { error: '🔴 error', warning: '🟡 warning', info: '🔵 info' };

function groupBySubject(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.subject.kind}:${f.subject.name}:${f.serverId}`;
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  return map;
}

export function renderMarkdown(result: LintResult): string {
  const { summary } = result;
  const lines: string[] = [];

  lines.push(`# mcplint report`);
  lines.push('');
  lines.push(`Generated ${result.generatedAt} · tokenizer: ${result.tokenizerName}`);
  lines.push('');
  lines.push(`**Score: ${summary.score} / 100**`);
  lines.push('');
  lines.push(
    `| Servers | Tools | Prompts | Resources | Est. tokens | Errors | Warnings | Info |`
  );
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
  lines.push(
    `| ${result.target.servers.length} | ${summary.toolCount} | ${summary.promptCount} | ${summary.resourceCount} | ~${summary.totalEstimatedTokens} | ${summary.bySeverity.error} | ${summary.bySeverity.warning} | ${summary.bySeverity.info} |`
  );

  const offenders = topOffenders(result, 5).filter((o) => o.tokens > 0);
  if (offenders.length > 0) {
    lines.push('');
    lines.push('## Top token offenders');
    lines.push('');
    lines.push('| Tool | Est. tokens |');
    lines.push('| --- | --- |');
    for (const o of offenders) lines.push(`| ${o.name} | ${o.tokens} |`);
  }

  const bySubject = groupBySubject(result.findings);
  if (bySubject.size > 0) {
    lines.push('');
    lines.push('## Findings');
    for (const [key, findings] of [...bySubject.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const first = findings[0]!;
      lines.push('');
      lines.push(`### ${first.subject.name} \`(${first.subject.kind}, ${first.serverId})\``);
      lines.push('');
      for (const f of findings) {
        lines.push(`- ${BADGE[f.severity]} [\`${f.ruleId}\`](docs/rules/${ruleSlug(f.ruleId)}.md) — ${f.message}`);
        if (f.suggestion) lines.push(`  - *Suggestion:* ${f.suggestion}`);
      }
      void key;
    }
  } else {
    lines.push('');
    lines.push('No findings.');
  }

  lines.push('');
  return lines.join('\n');
}
