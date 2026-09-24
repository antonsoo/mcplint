import { describe, expect, it } from 'vitest';
import { computeScore } from '../src/core/score.js';
import type { Finding } from '../src/core/types.js';
import { targetOf, tool } from './helpers.js';

function qualityFinding(severity: Finding['severity'], name = 't1'): Finding {
  return { ruleId: 'description/too-short', severity, serverId: 's', subject: { kind: 'tool', name }, message: 'm' };
}

function serverFinding(severity: Finding['severity']): Finding {
  return { ruleId: 'naming/convention-consistency', severity, serverId: 's', subject: { kind: 'server', name: 's' }, message: 'm' };
}

function safetyFinding(severity: Finding['severity'], name = 't1'): Finding {
  return { ruleId: 'safety/prompt-injection', severity, serverId: 's', subject: { kind: 'tool', name }, message: 'm' };
}

describe('computeScore — quality component (averaged per item)', () => {
  it('is 100 for a target with no tools and no findings', () => {
    expect(computeScore([], targetOf([]))).toBe(100);
  });

  it('is 100 for tools with zero findings', () => {
    const target = targetOf([tool({ name: 't1' }), tool({ name: 't2' })]);
    expect(computeScore([], target)).toBe(100);
  });

  it('weights error > warning > info on an otherwise-identical single tool', () => {
    const target = targetOf([tool({ name: 't1' })]);
    const errorScore = computeScore([qualityFinding('error')], target);
    const warningScore = computeScore([qualityFinding('warning')], target);
    const infoScore = computeScore([qualityFinding('info')], target);
    expect(errorScore).toBeLessThan(warningScore);
    expect(warningScore).toBeLessThan(infoScore);
  });

  it('floors a single tool at 0 and never goes negative', () => {
    const target = targetOf([tool({ name: 't1' })]);
    const many = Array.from({ length: 50 }, () => qualityFinding('error'));
    expect(computeScore(many, target)).toBe(0);
  });

  it('averages across tools instead of summing, so more tools is not automatically a worse score', () => {
    // One bad tool out of three: the other two are clean and pull the average up.
    const target = targetOf([tool({ name: 'bad' }), tool({ name: 'clean1' }), tool({ name: 'clean2' })]);
    const findings = [qualityFinding('error', 'bad'), qualityFinding('error', 'bad'), qualityFinding('error', 'bad')]; // -30 on "bad" only
    const score = computeScore(findings, target);
    // "bad" scores 70, the other two score 100 each -> average (70+100+100)/3 = 90.
    expect(score).toBe(90);
  });

  it('a server with many tools and a low per-tool problem rate scores better than a small server with the same total penalty concentrated on one tool', () => {
    const bigTarget = targetOf(Array.from({ length: 14 }, (_, i) => tool({ name: `t${i}` })));
    const bigFindings = Array.from({ length: 14 }, (_, i) => qualityFinding('warning', `t${i}`)); // one warning per tool
    const bigScore = computeScore(bigFindings, bigTarget);

    const smallTarget = targetOf([tool({ name: 'only' })]);
    const smallFindings = Array.from({ length: 14 }, () => qualityFinding('warning', 'only')); // all 14 warnings on one tool
    const smallScore = computeScore(smallFindings, smallTarget);

    expect(bigScore).toBeGreaterThan(smallScore);
    expect(bigScore).toBe(96); // 100 - 4, same on every tool -> average is 96
    expect(smallScore).toBe(44); // 100 - 14*4 = 44
  });

  it('subtracts whole-server quality findings from the averaged score once', () => {
    const target = targetOf([tool({ name: 't1' }), tool({ name: 't2' })]);
    const score = computeScore([serverFinding('info')], target);
    expect(score).toBe(99); // avg(100,100) - 1
  });

  it('counts prompts and resources in the quality average alongside tools', () => {
    const target = {
      ...targetOf([tool({ name: 't1' })]),
      prompts: [{ kind: 'prompt' as const, name: 'p1', serverId: 's1' }],
      resources: [{ kind: 'resource' as const, name: 'r1', serverId: 's1' }]
    };
    const findings: Finding[] = [
      { ruleId: 'description/missing', severity: 'error', serverId: 's1', subject: { kind: 'prompt', name: 'p1' }, message: 'm' }
    ];
    // t1=100, p1=90, r1=100 -> average 96.67 -> rounds to 97
    expect(computeScore(findings, target)).toBe(97);
  });
});

describe('computeScore — safety component (summed, not averaged)', () => {
  it('a single safety finding on one tool is not diluted by how many other tools are clean', () => {
    // Same single safety finding, attached to one tool, on a 1-tool server and a 50-tool server:
    // the penalty subtracted from the final score should be identical either way.
    const oneTool = targetOf([tool({ name: 't0' })]);
    const manyTools = targetOf(Array.from({ length: 50 }, (_, i) => tool({ name: `t${i}` })));
    const oneScore = computeScore([safetyFinding('error', 't0')], oneTool);
    const manyScore = computeScore([safetyFinding('error', 't0')], manyTools);
    expect(oneScore).toBe(90); // 100 (quality avg) - 10 (safety)
    expect(manyScore).toBe(90); // 100 (quality avg, 49 other clean tools included) - 10 (safety), NOT ~99.8
  });

  it('a handful of safety findings on one tool craters the score even on an otherwise large, clean server', () => {
    const target = targetOf(Array.from({ length: 12 }, (_, i) => tool({ name: `t${i}` })));
    const findings = [
      safetyFinding('error', 't0'),
      safetyFinding('error', 't0'),
      safetyFinding('error', 't0'),
      safetyFinding('error', 't0'),
      safetyFinding('error', 't0')
    ]; // 5 * 10 = 50
    expect(computeScore(findings, target)).toBe(50); // 100 - 50, eleven clean tools don't dilute it
  });

  it('safety findings still respect severity weight', () => {
    const target = targetOf([tool({ name: 't1' })]);
    expect(computeScore([safetyFinding('error')], target)).toBeLessThan(computeScore([safetyFinding('warning')], target));
  });

  it('clamps the final result to [0, 100] even with heavy combined penalties', () => {
    const target = targetOf([tool({ name: 't1' })]);
    const findings = [...Array.from({ length: 5 }, () => safetyFinding('error')), ...Array.from({ length: 10 }, () => serverFinding('error'))];
    expect(computeScore(findings, target)).toBe(0);
  });
});
