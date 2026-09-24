import type { CollectedTool, LintTarget, ResolvedConfig, RuleContext } from '../src/core/types.js';
import { DEFAULT_BUDGET } from '../src/core/config.js';

export function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    budget: DEFAULT_BUDGET,
    totalBudget: undefined,
    severities: {},
    ignore: new Set(),
    failOn: null,
    ...overrides
  };
}

export function tool(partial: Partial<CollectedTool> & { name: string }): CollectedTool {
  return {
    kind: 'tool',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    serverId: 's1',
    ...partial
  };
}

export function targetOf(tools: CollectedTool[], serverIds: string[] = ['s1']): LintTarget {
  return {
    servers: serverIds.map((id) => ({ id, label: id })),
    tools,
    prompts: [],
    resources: []
  };
}

export function ctxOf(tools: CollectedTool[], configOverrides: Partial<ResolvedConfig> = {}, serverIds?: string[]): RuleContext {
  return { target: targetOf(tools, serverIds), config: baseConfig(configOverrides) };
}
