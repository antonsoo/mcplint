import type { Finding, Rule, RuleContext } from '../types.js';
import { estimateToolTokens } from '../tokenizer.js';

export const toolTokens: Rule = {
  id: 'budget/tool-tokens',
  category: 'budget',
  defaultSeverity: 'warning',
  summary: 'A single tool definition exceeds the configured token budget.',
  rationale:
    'Every tool definition is re-sent to the model on every turn. A tool whose JSON serialization alone costs ' +
    'hundreds of tokens is usually over-described: trimmed prose, a flattened schema, or fewer redundant fields ' +
    'buy back context the model could spend on the conversation instead.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const tool of ctx.target.tools) {
      const tokens = estimateToolTokens(tool);
      if (tokens > ctx.config.budget) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: tool.serverId,
          subject: { kind: 'tool', name: tool.name },
          message: `~${tokens} estimated tokens (budget: ${ctx.config.budget}).`,
          suggestion: 'Shorten the description or simplify inputSchema (fewer nested objects, shorter enum lists).'
        });
      }
    }
    return findings;
  }
};

export const totalTokens: Rule = {
  id: 'budget/total-tokens',
  category: 'budget',
  defaultSeverity: 'warning',
  summary: 'The full tool list exceeds the configured total token budget.',
  rationale:
    'Clients typically inject the entire tool list on every request. A large combined budget compounds across ' +
    'every turn of a conversation and crowds out the context available for the actual task.',
  check(ctx: RuleContext): Finding[] {
    if (!ctx.config.totalBudget) return [];
    const total = ctx.target.tools.reduce((sum, tool) => sum + estimateToolTokens(tool), 0);
    if (total <= ctx.config.totalBudget) return [];
    return [
      {
        ruleId: this.id,
        severity: this.defaultSeverity,
        serverId: ctx.target.servers[0]?.id ?? 'unknown',
        subject: { kind: 'server', name: 'all tools' },
        message: `~${total} estimated tokens across ${ctx.target.tools.length} tools (budget: ${ctx.config.totalBudget}).`,
        suggestion: 'Split the server, gate rarely-used tools behind a discovery tool, or cut the top offenders.'
      }
    ];
  }
};

export const rules: Rule[] = [toolTokens, totalTokens];
