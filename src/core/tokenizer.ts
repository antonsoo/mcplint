import { countTokens } from 'gpt-tokenizer';
import type { CollectedTool } from './types.js';

/**
 * mcplint estimates cost with the o200k_base byte-pair encoding (the same
 * vocabulary OpenAI's GPT-4o family uses), via the pure-JS `gpt-tokenizer`
 * package. No vendor publishes Claude's tokenizer, and Claude/Gemini/Llama
 * models all use different BPE vocabularies, so any single count is an
 * estimate, not an exact figure for a particular model. o200k_base is a
 * reasonable proxy: it is a modern, large-vocabulary BPE broadly similar in
 * granularity to other current-generation tokenizers, and it is the one
 * tokenizer with a mature, dependency-free JS implementation.
 */
export const TOKENIZER_NAME = 'o200k_base';
export const TOKENIZER_DESCRIPTION =
  "o200k_base BPE (GPT-4o's vocabulary), via the pure-JS `gpt-tokenizer` package — an estimate, not an exact count for any particular model";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return countTokens(text);
}

/**
 * Approximates what a client actually injects into context for one tool:
 * the JSON-serialized {name, description, inputSchema, outputSchema,
 * annotations}. This matches how every MCP client we've inspected renders
 * the tool list into the system/tool prompt, modulo whitespace.
 */
export function serializeToolForBudget(tool: CollectedTool): string {
  const payload: Record<string, unknown> = { name: tool.name };
  if (tool.description) payload.description = tool.description;
  payload.inputSchema = tool.inputSchema;
  if (tool.outputSchema) payload.outputSchema = tool.outputSchema;
  if (tool.annotations) payload.annotations = tool.annotations;
  return JSON.stringify(payload);
}

export function estimateToolTokens(tool: CollectedTool): number {
  return estimateTokens(serializeToolForBudget(tool));
}
