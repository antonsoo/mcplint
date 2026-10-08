import type { Finding, Rule, RuleContext } from '../types.js';
import { estimateToolTokens } from '../tokenizer.js';
import { DEFAULT_TOTAL_BUDGET } from '../config.js';
import { percentileExceeded, SERVER_TOKEN_PERCENTILES, TOOL_TOKEN_PERCENTILES } from '../census.js';

/** " Heavier than 95% of ..." when the cost is at or beyond the 90th percentile of real ones. */
function inContext(tokens: number, table: typeof TOOL_TOKEN_PERCENTILES, what: string): string {
  const percentile = percentileExceeded(tokens, table);
  return percentile !== null && percentile >= 90 ? ` Heavier than ${percentile}% of ${what} in the registry census.` : '';
}

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
          message: `~${tokens} estimated tokens (budget: ${ctx.config.budget}).${inContext(tokens, TOOL_TOKEN_PERCENTILES, 'tool definitions')}`,
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
    'A client that loads the whole tool list sends it on every request. A large combined cost compounds across ' +
    'every turn of a conversation and crowds out the context available for the actual task. Without a configured ' +
    'budget the limit is 16,000 tokens, 8% of a 200,000-token window, which 93% of the servers in the registry census stay under.',
  check(ctx: RuleContext): Finding[] {
    const budget = ctx.config.totalBudget ?? DEFAULT_TOTAL_BUDGET;
    const total = ctx.target.tools.reduce((sum, tool) => sum + estimateToolTokens(tool), 0);
    if (total <= budget) return [];
    return [
      {
        ruleId: this.id,
        severity: this.defaultSeverity,
        serverId: ctx.target.servers[0]?.id ?? 'unknown',
        subject: { kind: 'server', name: 'all tools' },
        message:
          `~${total} estimated tokens across ${ctx.target.tools.length} tools (budget: ${budget}).` +
          (ctx.target.servers.length <= 1 ? inContext(total, SERVER_TOKEN_PERCENTILES, 'whole tool lists') : ''),
        suggestion: 'Split the server, gate rarely-used tools behind a discovery tool, or cut the top offenders.'
      }
    ];
  }
};

export const rules: Rule[] = [toolTokens, totalTokens];
