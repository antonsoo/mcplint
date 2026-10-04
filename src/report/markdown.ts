import type { Finding, LintResult, Severity } from '../core/types.js';
import { topOffenders } from '../core/lint.js';
import { ruleSlug } from '../core/rule-slug.js';
import { auditStatus, coverageNote } from './coverage.js';
import { visibleControls } from '../core/unicode.js';

// Character references render as literal text; they cannot open HTML, links, images,
// code spans or table cells. Encode punctuation even inside a malicious field name.
function v(text: string): string {
  return visibleControls(text).replace(/[&<>\\`*_{}[\]()#+.!|~:\r\n]/g, ch => `&#${ch.codePointAt(0)!};`);
}

const BADGE: Record<Severity, string> = { error: '🔴 error', warning: '🟡 warning', info: '🔵 info' };

function groupBySubject(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = JSON.stringify([f.serverId, f.subject.kind, f.subject.name]);
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
  lines.push(`**${auditStatus(result)}**`, '', coverageNote(result), '');
  lines.push(summary.score === null ? '**Score: unavailable**' : `**Score: ${summary.score} / 100**`);
  if (result.target.collection?.length) {
    lines.push('', '## Collection coverage', '', '| Server | Scope | Status | Pages | Received | Retained | Detail |', '| --- | --- | --- | ---: | ---: | ---: | --- |');
    for (const record of result.target.collection) {
      lines.push(`| ${v(record.serverId)} | ${record.scope} | ${record.status} | ${record.pages} | ${record.received} | ${record.retained} | ${v(record.detail ?? '')} |`);
    }
  }
  lines.push('');
  lines.push(
    `| Servers | Tools | Prompts | Resources | Est. tokens | Errors | Warnings | Info |`
  );
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
  lines.push(
    `| ${result.target.servers.length} | ${summary.toolCount} | ${summary.promptCount} | ${summary.resourceCount} | ${summary.totalEstimatedTokens === null ? 'unknown' : `~${summary.totalEstimatedTokens}`}  | ${summary.bySeverity.error} | ${summary.bySeverity.warning} | ${summary.bySeverity.info} |`
  );

  const offenders = topOffenders(result, 5).filter((o) => o.tokens > 0);
  if (offenders.length > 0) {
    lines.push('');
    lines.push('## Top token offenders');
    lines.push('');
    lines.push('| Tool | Est. tokens |');
    lines.push('| --- | --- |');
    for (const o of offenders) lines.push(`| ${v(o.name)} | ${o.tokens} |`);
  }

  const bySubject = groupBySubject(result.findings);
  if (bySubject.size > 0) {
    lines.push('');
    lines.push('## Findings');
    for (const [key, findings] of [...bySubject.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const first = findings[0]!;
      lines.push('');
      lines.push(`### ${v(first.subject.name)} (${first.subject.kind}, ${v(first.serverId)})`);
      lines.push('');
      for (const f of findings) {
        lines.push(`- ${BADGE[f.severity]} [\`${f.ruleId}\`](docs/rules/${ruleSlug(f.ruleId)}.md) — ${v(f.message)}`);
        if (f.suggestion) lines.push(`  - *Suggestion:* ${v(f.suggestion)}`);
      }
      void key;
    }
  } else {
    lines.push('');
    lines.push(result.summary.complete ? 'No findings against configured rules.' : 'No findings in retained data; audit gaps remain.');
  }

  lines.push('');
  return lines.join('\n');
}
