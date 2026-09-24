import type { CollectedTool, Finding, Rule, RuleContext } from '../types.js';

/**
 * Character/length rules per the MCP spec (2026-07-28), "Tool Names":
 * https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names
 *   - SHOULD be 1-128 characters
 *   - SHOULD be case-sensitive
 *   - SHOULD contain only A-Z a-z 0-9 _ - .
 *   - SHOULD be unique within a server
 * These are spec-level SHOULDs. Two real clients are stricter, and a tool
 * that violates their pattern will fail to register even though it is
 * spec-valid:
 *   - Anthropic Claude API: `^[a-zA-Z0-9_-]{1,128}$` (no dot) —
 *     https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
 *   - OpenAI function calling: `^[a-zA-Z0-9_-]{1,64}$` (no dot, 64 cap) —
 *     https://developers.openai.com/api/docs/guides/function-calling
 */
const SPEC_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const SPEC_MAX_LEN = 128;
const STRICT_CLIENT_PATTERN = /^[A-Za-z0-9_-]+$/; // Anthropic and OpenAI agree on this charset
const OPENAI_MAX_LEN = 64;

const GENERIC_NAMES = new Set([
  'run',
  'execute',
  'exec',
  'query',
  'do',
  'process',
  'handle',
  'call',
  'invoke',
  'action',
  'perform',
  'task',
  'go',
  'main',
  'operation',
  'op',
  'command',
  'cmd',
  'tool',
  'helper',
  'util',
  'misc',
  'generic',
  'request',
  'submit'
]);

function namesOf(ctx: RuleContext): CollectedTool[] {
  return ctx.target.tools;
}

export const invalidChars: Rule = {
  id: 'naming/invalid-chars',
  category: 'naming',
  defaultSeverity: 'error',
  summary: 'Tool name uses characters or a length outside the MCP spec\'s recommended tool-name charset.',
  rationale:
    'The spec is a SHOULD, not a MUST, but clients that reject or mangle non-conforming names are common enough ' +
    'that a portable server should stay inside A-Z a-z 0-9 _ - . and 1-128 characters.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const tool of namesOf(ctx)) {
      const problems: string[] = [];
      if (tool.name.length === 0 || tool.name.length > SPEC_MAX_LEN) {
        problems.push(`length ${tool.name.length} (spec allows 1-${SPEC_MAX_LEN})`);
      }
      if (!SPEC_NAME_PATTERN.test(tool.name)) {
        problems.push('contains characters outside A-Z a-z 0-9 _ - .');
      }
      if (problems.length > 0) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: tool.serverId,
          subject: { kind: 'tool', name: tool.name },
          message: `Invalid per MCP spec tool-name rules: ${problems.join('; ')}.`
        });
      }
    }
    return findings;
  }
};

export const strictClientCompat: Rule = {
  id: 'naming/strict-client-compat',
  category: 'naming',
  defaultSeverity: 'warning',
  summary: 'Tool name is spec-valid but would be rejected by Anthropic- or OpenAI-style strict tool-name validation.',
  rationale:
    'The MCP spec allows dots and names up to 128 characters, but the Anthropic Claude API restricts tool names to ' +
    '`^[a-zA-Z0-9_-]{1,128}$` and OpenAI function calling restricts them to `^[a-zA-Z0-9_-]{1,64}$`. A server meant ' +
    'to be portable across bridges into those APIs should not rely on dots or long names.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const tool of namesOf(ctx)) {
      if (!SPEC_NAME_PATTERN.test(tool.name)) continue; // already flagged by invalidChars
      const reasons: string[] = [];
      if (!STRICT_CLIENT_PATTERN.test(tool.name)) reasons.push('contains a dot');
      if (tool.name.length > OPENAI_MAX_LEN) reasons.push(`is ${tool.name.length} chars (OpenAI caps at ${OPENAI_MAX_LEN})`);
      if (reasons.length > 0) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: tool.serverId,
          subject: { kind: 'tool', name: tool.name },
          message: `Name ${reasons.join(' and ')}; some strict clients will reject it.`
        });
      }
    }
    return findings;
  }
};

function detectConvention(name: string): 'snake_case' | 'camelCase' | 'kebab-case' | 'dot.case' | 'other' {
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(name)) return 'snake_case';
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(name)) return 'kebab-case';
  if (/^[a-z0-9]+(\.[a-z0-9]+)+$/.test(name)) return 'dot.case';
  if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) return 'camelCase';
  return 'other';
}

export const conventionConsistency: Rule = {
  id: 'naming/convention-consistency',
  category: 'naming',
  defaultSeverity: 'info',
  summary: 'Tool names within a server mix naming conventions (snake_case, camelCase, kebab-case, dot.case).',
  rationale:
    'A model has to remember which convention each tool uses; a server that is consistently snake_case (as most ' +
    'MCP servers are) is easier to predict names for than one that mixes styles.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const byServer = new Map<string, CollectedTool[]>();
    for (const tool of namesOf(ctx)) {
      const list = byServer.get(tool.serverId) ?? [];
      list.push(tool);
      byServer.set(tool.serverId, list);
    }
    for (const [serverId, tools] of byServer) {
      if (tools.length < 3) continue;
      const conventions = new Map<string, number>();
      for (const tool of tools) {
        const conv = detectConvention(tool.name);
        if (conv === 'other') continue;
        conventions.set(conv, (conventions.get(conv) ?? 0) + 1);
      }
      if (conventions.size > 1) {
        const summary = [...conventions.entries()].map(([c, n]) => `${c} (${n})`).join(', ');
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId,
          subject: { kind: 'server', name: serverId },
          message: `Mixed naming conventions across ${tools.length} tools: ${summary}.`
        });
      }
    }
    return findings;
  }
};

export const genericName: Rule = {
  id: 'naming/generic',
  category: 'naming',
  defaultSeverity: 'warning',
  summary: 'Tool name is a generic verb that gives the model no signal about what the tool does.',
  rationale:
    'Names like `run`, `execute`, or `query` collide semantically with tools from other servers and force the ' +
    'model to rely entirely on the description (which it may truncate or under-weight) to disambiguate.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const tool of namesOf(ctx)) {
      const segments = tool.name.split(/[_.\-]/).filter(Boolean);
      const last = segments[segments.length - 1]?.toLowerCase();
      // The whole name being generic ("run") is always a problem. A generic *last*
      // segment ("query" in "db_query") only is when the name has just 1-2 segments —
      // a longer compound name like "simulate-research-query" or
      // "trigger-long-running-operation" already says something specific even though
      // its last word, in isolation, is on the generic list.
      const flagged =
        GENERIC_NAMES.has(tool.name.toLowerCase()) || (segments.length <= 2 && last !== undefined && GENERIC_NAMES.has(last));
      if (flagged) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: tool.serverId,
          subject: { kind: 'tool', name: tool.name },
          message: `"${tool.name}" is a generic action name; prefer one that names the resource or effect, e.g. "list_widgets" or "delete_widget" instead of a bare verb like "${tool.name}".`
        });
      }
    }
    return findings;
  }
};

export const collision: Rule = {
  id: 'naming/collision',
  category: 'naming',
  defaultSeverity: 'error',
  summary: 'Two or more servers in this run expose a tool with the identical name.',
  rationale:
    'Most MCP clients namespace or flatten tool lists from multiple servers; an exact name collision means one ' +
    'tool silently shadows the other, and the model (and the user approving calls) cannot tell them apart.',
  check(ctx: RuleContext): Finding[] {
    if (ctx.target.servers.length < 2) return [];
    const byName = new Map<string, CollectedTool[]>();
    for (const tool of namesOf(ctx)) {
      const list = byName.get(tool.name) ?? [];
      list.push(tool);
      byName.set(tool.name, list);
    }
    const findings: Finding[] = [];
    for (const [name, tools] of byName) {
      if (tools.length < 2) continue;
      const servers = [...new Set(tools.map((t) => t.serverId))];
      if (servers.length < 2) continue;
      findings.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        serverId: servers.join(','),
        subject: { kind: 'tool', name },
        message: `"${name}" is defined identically by ${servers.length} servers: ${servers.join(', ')}.`
      });
    }
    return findings;
  }
};

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let j = 0; j <= b.length; j += 1) dp[0]![j] = j;
  for (let i = 0; i <= a.length; i += 1) dp[i]![0] = i;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}

export const shadowing: Rule = {
  id: 'naming/shadowing',
  category: 'naming',
  defaultSeverity: 'warning',
  summary: 'Two tools across different servers have near-identical names, risking accidental shadowing.',
  rationale:
    'A one- or two-character difference between tool names from different servers (e.g. "search" vs "search_") ' +
    'is easy for a human reviewer to miss and easy for a model to call the wrong one, especially under token ' +
    'pressure that truncates descriptions.',
  check(ctx: RuleContext): Finding[] {
    if (ctx.target.servers.length < 2) return [];
    const findings: Finding[] = [];
    const tools = namesOf(ctx);
    const seen = new Set<string>();
    for (let i = 0; i < tools.length; i += 1) {
      for (let j = i + 1; j < tools.length; j += 1) {
        const a = tools[i]!;
        const b = tools[j]!;
        if (a.serverId === b.serverId || a.name === b.name) continue;
        const dist = levenshtein(a.name.toLowerCase(), b.name.toLowerCase());
        const maxLen = Math.max(a.name.length, b.name.length);
        if (maxLen < 5) continue;
        if (dist > 0 && dist <= 2 && dist / maxLen <= 0.3) {
          const key = [a.name, b.name].sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: `${a.serverId},${b.serverId}`,
            subject: { kind: 'tool', name: a.name },
            message: `"${a.name}" (${a.serverId}) is ${dist} edit(s) from "${b.name}" (${b.serverId}).`
          });
        }
      }
    }
    return findings;
  }
};

export const rules: Rule[] = [invalidChars, strictClientCompat, conventionConsistency, genericName, collision, shadowing];
