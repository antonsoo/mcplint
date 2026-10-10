import { describe, expect, it } from 'vitest';
import { appendItems } from '../../src/collectors/items.js';
import { lint, shouldFail } from '../../src/core/lint.js';
import type { CollectionRecord } from '../../src/core/types.js';
import { baseConfig, targetOf } from '../helpers.js';

describe('resource list identity', () => {
  for (const [key, field, other] of [['resources', 'uri', 'uriTemplate'], ['resourceTemplates', 'uriTemplate', 'uri']] as const) {
    it.each([{}, { [other]: 'report://today' }, { [field]: null }, { [field]: 42 }])(`${key} retains but does not certify %j`, fields => {
      const target = targetOf([]);
      const record: CollectionRecord = { serverId: 's1', scope: key === 'resources' ? 'resources/list' : 'resources/templates/list', status: 'complete', pages: 1, received: 2, retained: 0 };
      target.collection = [record];
      appendItems(target, key, [{ name: 'good', [field]: 'report://today' },
        { name: 'bad', description: 'A hidden\u200b marker.', ...fields }], record);
      expect(record).toMatchObject({ status: 'incomplete', retained: 2 });
      expect(record.detail).toContain(`1 entry lacks a string ${field}`);
      expect(record.detail).toContain('first at index 1');
      expect(target.resources.map(r => r.name)).toEqual(['good', 'bad']);
      const report = lint(target, baseConfig({ failOn: 'error' }));
      expect(report.summary.complete).toBe(false);
      expect(report.summary.score).toBeNull();
      expect(report.findings.some(f => f.ruleId === 'safety/hidden-unicode')).toBe(true);
      // Even with all diagnostics suppressed, missing identity is still incomplete.
      const suppressed = lint(target, baseConfig({ failOn: 'error', ignore: new Set(['collection/incomplete', 'safety/hidden-unicode']) }));
      expect(shouldFail(suppressed)).toBe(true);
    });

    it(`${key} accepts the required field and an empty list`, () => {
      for (const items of [[], [{ name: 'daily', [field]: 'report://today' }]]) {
        const target = targetOf([]);
        const record: CollectionRecord = { serverId: 's1', scope: 'resources/list', status: 'complete', pages: 1, received: items.length, retained: 0 };
        appendItems(target, key, items, record);
        expect(record.status).toBe('complete');
        expect(record.retained).toBe(items.length);
      }
    });
  }
});
