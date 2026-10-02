import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lint } from '../src/core/lint.js';
import { renderTerminal } from '../src/report/terminal.js';
import { renderJson } from '../src/report/json.js';
import { renderSarif } from '../src/report/sarif.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { renderHtml } from '../src/report/html.js';
import { baseConfig, targetOf, tool } from './helpers.js';

const t = tool({ name: 'run', description: undefined });
const result = lint(targetOf([t]), baseConfig());

describe('report renderers', () => {
  it('renderTerminal includes the rule id and score', () => {
    const out = renderTerminal(result);
    expect(out).toContain('description/missing');
    expect(out).toMatch(/Score:/);
  });

  it('renderJson produces valid, round-trippable JSON', () => {
    const out = renderJson(result);
    const parsed = JSON.parse(out) as { summary: { score: number }; findings: unknown[] };
    expect(parsed.summary.score).toBe(result.summary.score);
    expect(parsed.findings).toHaveLength(result.findings.length);
  });

  interface SarifLog {
    version: string;
    runs: [{ tool: { driver: { name: string } }; results: { ruleId: string }[] }];
  }

  it('renderSarif produces a schema-shaped SARIF 2.1.0 log', () => {
    const out = renderSarif(result);
    const parsed = JSON.parse(out) as SarifLog;
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0].tool.driver.name).toBe('mcplint');
    expect(parsed.runs[0].results.length).toBe(result.findings.length);
    expect(parsed.runs[0].results[0]!.ruleId).toBe(result.findings[0]!.ruleId);
  });

  it('renderMarkdown includes a findings section and the rule id', () => {
    const out = renderMarkdown(result);
    expect(out).toContain('# mcplint report');
    expect(out).toContain('description/missing');
  });

  it('renderHtml produces a self-contained document with no external requests', () => {
    const out = renderHtml(result);
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('description/missing');
    expect(out).not.toContain('http://');
    expect(out).not.toMatch(/<link[^>]+href="https?:/);
    expect(out).not.toMatch(/<script[^>]+src=/);
  });

  it("renderHtml's policy allows the one script in the report, by its hash, and nothing else", () => {
    const out = renderHtml(result);
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(out)?.[1] ?? '';
    const scripts = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
    expect(scripts).toHaveLength(1);
    const hash = createHash('sha256').update(scripts[0]!).digest('base64');
    expect(policy.split('; ')).toEqual([
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'sha256-${hash}'`,
      'img-src data:',
      "base-uri 'none'",
      "form-action 'none'",
    ]);
    // The policy governs what follows it: it has to come before the style and the script.
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<style'));
  });

  it('renderHtml produces a clean report with no findings section collapsed correctly', () => {
    const cleanTool = tool({
      name: 'clean',
      description: 'A perfectly fine description with plenty of words in it.',
      annotations: { readOnlyHint: true }
    });
    const cleanResult = lint(targetOf([cleanTool]), baseConfig());
    const out = renderHtml(cleanResult);
    expect(out).toContain('No findings');
  });
});

describe('names that are not well-formed text', () => {
  it('renders every report for a tool name holding half of a surrogate pair', () => {
    // "\ud83d" is valid JSON, and encodeURIComponent throws URIError on it.
    const odd = lint(targetOf([tool({ name: 'emoji\ud83d', description: undefined })]), baseConfig());
    const sarif = JSON.parse(renderSarif(odd)) as { runs: { results: { locations: { physicalLocation: { artifactLocation: { uri: string } } }[] }[] }[] };
    expect(sarif.runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri).toBe('mcp://s1/tool/emoji%EF%BF%BD');
    for (const render of [renderTerminal, renderMarkdown, renderHtml]) expect(() => render(odd)).not.toThrow();
  });
});

