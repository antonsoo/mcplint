import chalk from 'chalk';
import type { Finding, LintResult, Severity } from '../core/types.js';
import { topOffenders } from '../core/lint.js';

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  error: chalk.bold.red,
  warning: chalk.bold.yellow,
  info: chalk.bold.cyan
};

const SEVERITY_ICON: Record<Severity, string> = { error: '✖', warning: '⚠', info: 'ℹ' };

const MIN_WRAP_WIDTH = 60;
const FALLBACK_COLUMNS = 100;

function terminalWidth(): number {
  return process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : FALLBACK_COLUMNS;
}

/**
 * Wraps plain text (no ANSI codes — color the already-wrapped lines
 * afterward) to `width`, indenting every line after the first by `indent`
 * spaces so continuation text lines up under where the message started,
 * instead of wrapping back to column 0.
 */
function wrapIndented(text: string, indent: number, width: number): string[] {
  const avail = Math.max(MIN_WRAP_WIDTH - indent, width - indent);
  const words = text.split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= avail) {
      current += ` ${word}`;
    } else {
      rows.push(current);
      current = word;
    }
  }
  if (current.length > 0) rows.push(current);
  if (rows.length === 0) return [''];
  const pad = ' '.repeat(indent);
  return rows.map((row, i) => (i === 0 ? row : pad + row));
}

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
  const width = terminalWidth();

  lines.push('');
  lines.push(chalk.bold.white(' mcplint ') + chalk.dim(`— ${result.tokenizerName} token estimates, ${result.generatedAt}`));
  lines.push(chalk.dim('─'.repeat(Math.min(70, width))));

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
      const prefix = `      ${f.severity.padEnd(7)} ${f.ruleId}  `;
      const [firstLine, ...rest] = wrapIndented(f.message, prefix.length, width);
      lines.push(`      ${SEVERITY_COLOR[f.severity](f.severity.padEnd(7))} ${chalk.dim(f.ruleId)}  ${firstLine}`);
      for (const row of rest) lines.push(row);
      if (f.suggestion) {
        const suggestionPrefix = '              -> ';
        const [sFirst, ...sRest] = wrapIndented(f.suggestion, suggestionPrefix.length, width);
        lines.push(`              ${chalk.dim('->')} ${chalk.italic(sFirst)}`);
        for (const row of sRest) lines.push(chalk.italic(row));
      }
    }
  }

  lines.push('');
  lines.push(chalk.dim('─'.repeat(Math.min(70, width))));
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
