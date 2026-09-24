import { describe, expect, it } from 'vitest';
import { computeScore } from '../src/core/score.js';
import type { Finding } from '../src/core/types.js';

function finding(severity: Finding['severity']): Finding {
  return { ruleId: 'x', severity, serverId: 's', subject: { kind: 'tool', name: 't' }, message: 'm' };
}

describe('computeScore', () => {
  it('is 100 for no findings', () => {
    expect(computeScore([])).toBe(100);
  });

  it('weights error > warning > info', () => {
    const errorScore = computeScore([finding('error')]);
    const warningScore = computeScore([finding('warning')]);
    const infoScore = computeScore([finding('info')]);
    expect(errorScore).toBeLessThan(warningScore);
    expect(warningScore).toBeLessThan(infoScore);
  });

  it('floors at 0 and never goes negative', () => {
    const many = Array.from({ length: 50 }, () => finding('error'));
    expect(computeScore(many)).toBe(0);
  });
});
