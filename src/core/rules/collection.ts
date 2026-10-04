import type { Rule } from '../types.js';

export const incompleteCollection: Rule = {
  id: 'collection/incomplete', category: 'collection', defaultSeverity: 'error',
  summary: 'Some requested metadata could not be collected or decoded completely.',
  rationale: 'A missing page, malformed entry or unavailable server is an audit gap, not an empty clean list. Retained metadata is still linted.',
  check: ({ target }) => (target.collection ?? []).filter(record => record.status === 'incomplete').map(record => ({
    ruleId: 'collection/incomplete', severity: 'error', serverId: record.serverId,
    subject: { kind: 'server', name: record.serverId },
    message: `${record.scope}: ${record.detail ?? 'Collection did not finish.'}`,
    detail: `${record.pages} pages received; ${record.received} entries received; ${record.retained} entries retained for linting.`,
    suggestion: 'Resolve this collection gap and rerun before relying on the report for the whole target.'
  }))
};
