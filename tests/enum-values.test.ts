import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { lint } from '../src/core/lint.js';
import { renderHtml, renderJson, renderMarkdown, renderSarif, renderTerminal } from '../src/index.js';
import type { CollectedTool } from '../src/core/types.js';
import { baseConfig, targetOf } from './helpers.js';
const fixtures = JSON.parse(readFileSync('studies/enum-values/fixtures.json', 'utf8')) as {
  name: string; tools: Omit<CollectedTool, 'kind' | 'serverId'>[]; expectedEnumTools: string[]; expectedSafety: boolean;
}[];

describe('valid scalar and structured enum metadata', () => {
  for (const fixture of fixtures) it(fixture.name, () => {
    const tools = fixture.tools.map(tool => ({ ...tool, kind: 'tool' as const, serverId: 'enum-fixture' }));
    const result = lint(targetOf(tools, ['enum-fixture']), baseConfig());
    expect(result.summary.complete).toBe(true);
    expect(result.findings.some(f => f.ruleId === 'schema/invalid' || f.ruleId === 'safety/unchecked')).toBe(false);
    expect(result.findings.filter(f => f.ruleId === 'description/enum-unexplained').map(f => f.subject.name).sort())
      .toEqual([...fixture.expectedEnumTools].sort());
    expect(result.findings.some(f => f.ruleId === 'safety/secret-access')).toBe(fixture.expectedSafety);
    for (const render of [renderHtml, renderJson, renderMarkdown, renderSarif, renderTerminal]) {
      expect(render(result)).not.toContain('Cannot convert object to primitive value');
    }
    const sarif = JSON.parse(renderSarif(result)) as { runs: { invocations: { executionSuccessful: boolean }[] }[] };
    expect(sarif.runs[0]?.invocations[0]?.executionSuccessful).toBe(true);
  });
});
