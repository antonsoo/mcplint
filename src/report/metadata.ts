import { visibleControls } from '../core/unicode.js';
import type { MetadataComparison, MetadataValue } from '../core/metadata.js';

export function metadataVerdict(result: MetadataComparison): string {
  if (!result.complete) return 'Comparison incomplete; unchanged metadata is not established';
  return result.changes.length ? 'Recorded metadata changed' : 'Recorded metadata unchanged';
}

function preview(value: MetadataValue): string {
  if (!value.present) return '(absent)';
  const text = visibleControls(JSON.stringify(value.value));
  return text.length > 320 ? `${text.slice(0, 320)}... [${text.length} characters; full value in JSON/HTML]` : text;
}

export function renderMetadataTerminal(result: MetadataComparison): string {
  const lines = [metadataVerdict(result),
    `${result.summary.added} added, ${result.summary.removed} removed, ${result.summary.changed} changed, ${result.summary.unchanged} unchanged, ${result.summary.unpaired} unpaired`,
    `Before: ${visibleControls(result.before.createdAt)} (${result.before.definitions} definitions)`,
    `After:  ${visibleControls(result.after.createdAt)} (${result.after.definitions} definitions)`, ''];
  for (const issue of result.issues) lines.push(`INCOMPLETE: ${visibleControls(issue)}`);
  for (const change of result.changes) {
    lines.push('', `${change.status.toUpperCase()} ${visibleControls(change.serverId)} | ${change.scope} | ${visibleControls(change.identity)}`);
    for (const field of change.fields) lines.push(`  ${visibleControls(field.pointer) || '(whole definition)'}`, `  - ${preview(field.before)}`, `  + ${preview(field.after)}`);
  }
  lines.push('', ...result.notes);
  return lines.join('\n') + '\n';
}
