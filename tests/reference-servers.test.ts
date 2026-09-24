import { describe, expect, it } from 'vitest';
import { collectFile } from '../src/collectors/file.js';
import { lint } from '../src/core/lint.js';
import { resolveConfig } from '../src/core/config.js';

/**
 * Regression guard against false positives on real, Anthropic-maintained
 * reference servers. tests/fixtures/reference-servers/*.json are raw,
 * unvalidated `tools/list` captures (see scripts/dump-reference-fixtures.mjs)
 * from `@modelcontextprotocol/server-everything`, `server-filesystem`, and
 * `server-memory` at package version 2026.8.31, manually audited finding by
 * finding against these exact files (see README "Real-world run"). If a rule
 * change makes one of these numbers go up, that's a new finding against a
 * real server that needs the same by-hand audit before it's accepted —
 * these assertions exist so that doesn't happen silently.
 */
const config = resolveConfig({ file: { budget: 400 } });

describe('reference server fixtures (regression guard against new false positives)', () => {
  it('server-everything: only the audited findings, zero errors', async () => {
    const target = await collectFile('tests/fixtures/reference-servers/server-everything.json', 'server-everything');
    const result = lint(target, config);
    expect(result.summary.toolCount).toBe(13);
    expect(result.summary.bySeverity.error).toBe(0);
    expect(result.summary.bySeverity.warning).toBe(1);
    expect(result.summary.bySeverity.info).toBe(9);
    expect(result.findings.map((f) => f.ruleId).sort()).toEqual(
      [
        'description/param-missing',
        'description/enum-unexplained',
        'description/enum-unexplained',
        'description/enum-unexplained',
        'schema/portability',
        'schema/portability',
        'schema/portability',
        'schema/portability',
        'schema/portability',
        'schema/portability'
      ].sort()
    );
  });

  it('server-filesystem: only the audited findings, zero errors, and every tool keeps its real annotations', async () => {
    const target = await collectFile('tests/fixtures/reference-servers/server-filesystem.json', 'server-filesystem');
    // This server ships correct readOnlyHint/destructiveHint annotations on every tool in 2026.8.31 —
    // confirm safety/missing-annotations never fires against it.
    for (const tool of target.tools) {
      expect(tool.annotations?.readOnlyHint !== undefined || tool.annotations?.destructiveHint !== undefined).toBe(true);
    }
    const result = lint(target, config);
    expect(result.summary.toolCount).toBe(14);
    expect(result.summary.bySeverity.error).toBe(0);
    expect(result.summary.bySeverity.warning).toBe(19);
    expect(result.summary.bySeverity.info).toBe(6);
    expect(result.findings.every((f) => f.ruleId !== 'safety/missing-annotations')).toBe(true);
  });

  it('server-memory: only four missing-parameter-description findings, otherwise clean', async () => {
    const target = await collectFile('tests/fixtures/reference-servers/server-memory.json', 'server-memory');
    const result = lint(target, config);
    expect(result.summary.toolCount).toBe(9);
    expect(result.summary.bySeverity.error).toBe(0);
    expect(result.summary.bySeverity.warning).toBe(4);
    expect(result.summary.bySeverity.info).toBe(0);
    expect(result.findings.every((f) => f.ruleId === 'description/param-missing')).toBe(true);
  });

  it('none of the three reference servers trip any safety rule (they are not poisoned)', async () => {
    for (const name of ['server-everything', 'server-filesystem', 'server-memory']) {
      const target = await collectFile(`tests/fixtures/reference-servers/${name}.json`, name);
      const result = lint(target, config);
      expect(result.findings.every((f) => !f.ruleId.startsWith('safety/'))).toBe(true);
    }
  });
});
