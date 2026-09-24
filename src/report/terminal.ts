import chalk from 'chalk';
import type { Finding, LintResult, Severity } from '../core/types.js';
import { topOffenders } from '../core/lint.js';

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  error: chalk.bold.red,
  warning: chalk.bold.yellow,
  info: chalk.bold.cyan
};

const SEVERITY_ICON: Record<Severity, string> = { error: '✖', warning: '⚠', info: 'ℹ' };

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

function scoreColor(score: number): (s: string) => string {
  if (score >= 85) return chalk.bold.green;
  if (score >= 60) return chalk.bold.yellow;
  return chalk.bold.red;
}

export function renderTerminal(result: LintResult): string {
  const lines: string[] = [];
  const { summary } = result;

  lines.push('');
  lines.push(chalk.bold.white(' mcplint ') + chalk.dim(`— ${result.tokenizerName} token estimates, ${result.generatedAt}`));
  lines.push(chalk.dim('─'.repeat(70)));

  const bySubject = groupBySubject(result.findings);
  const sortedKeys = [...bySubject.keys()].sort();

  if (sortedKeys.length === 0) {
    lines.push(chalk.green('  No findings. Clean run against configured rules and budget.'));
  }

  for (const key of sortedKeys) {
    const findings = bySubject.get(key)!;
    const first = findings[0]!;
    const worst: Severity = findings.some((f) => f.severity === 'error')
      ? 'error'
      : findings.some((f) => f.severity === 'warning')
        ? 'warning'
        : 'info';
    lines.push('');
    lines.push(
      `  ${SEVERITY_COLOR[worst](SEVERITY_ICON[worst])} ${chalk.bold(first.subject.name)} ${chalk.dim(`(${first.subject.kind}, ${first.serverId})`)}`
    );
    for (const f of findings) {
      lines.push(`      ${SEVERITY_COLOR[f.severity](f.severity.padEnd(7))} ${chalk.dim(f.ruleId)}  ${f.message}`);
      if (f.suggestion) lines.push(`              ${chalk.dim('->')} ${chalk.italic(f.suggestion)}`);
    }
  }

  lines.push('');
  lines.push(chalk.dim('─'.repeat(70)));
  lines.push(
    `  ${chalk.bold('Servers')}: ${result.target.servers.length}   ` +
      `${chalk.bold('Tools')}: ${summary.toolCount}   ` +
      `${chalk.bold('Prompts')}: ${summary.promptCount}   ` +
      `${chalk.bold('Resources')}: ${summary.resourceCount}`
  );
  lines.push(`  ${chalk.bold('Estimated tokens')}: ~${summary.totalEstimatedTokens} across all tools`);
  lines.push(
    `  ${chalk.bold('Findings')}: ${chalk.red(`${summary.bySeverity.error} error`)}, ` +
      `${chalk.yellow(`${summary.bySeverity.warning} warning`)}, ` +
      `${chalk.cyan(`${summary.bySeverity.info} info`)}`
  );

  const offenders = topOffenders(result, 5).filter((o) => o.tokens > 0);
  if (offenders.length > 0) {
    lines.push('');
    lines.push(`  ${chalk.bold('Top token offenders')}:`);
    for (const o of offenders) {
      lines.push(`    ${String(o.tokens).padStart(5)} tok  ${o.name}`);
    }
  }

  lines.push('');
  const color = scoreColor(summary.score);
  lines.push(`  ${chalk.bold('Score')}: ${color(String(summary.score))} / 100`);
  lines.push('');

  return lines.join('\n');
}
