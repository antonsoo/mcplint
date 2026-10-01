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

// A run of more than this many characters that is all whitespace, or has none in it, is cut
// into pieces of this size before it is counted. Longer than any run in the tool lists of the
// reference servers (933 characters), so their counts are the tokenizer's own.
const LONG_RUN = 2048;
const LONG_RUN_RE = new RegExp(`\\S{${LONG_RUN + 1},}|\\s{${LONG_RUN + 1},}`, 'g');

/**
 * Byte-pair encoding merges within a "word", and the cost of merging grows with the square
 * of the word's length. Ordinary text never notices; a description that is 40,000 zero-width
 * spaces (or 40,000 plain ones) took seconds to count, and tool metadata comes from a server
 * that may want exactly that. Counting such a run in fixed-size pieces is linear and off by
 * at most one token per piece, which an estimate can afford. Text with no such run is
 * counted exactly as before.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  LONG_RUN_RE.lastIndex = 0;
  let run = LONG_RUN_RE.exec(text);
  if (run === null) return countTokens(text);

  let total = 0;
  let cursor = 0;
  for (; run !== null; run = LONG_RUN_RE.exec(text)) {
    if (run.index > cursor) total += countTokens(text.slice(cursor, run.index));
    const end = run.index + run[0].length;
    for (let at = run.index; at < end; ) {
      let next = Math.min(at + LONG_RUN, end);
      // Don't cut a surrogate pair in half.
      if (next < end && isHighSurrogate(text.charCodeAt(next - 1))) next += 1;
      total += countTokens(text.slice(at, next));
      at = next;
    }
    cursor = end;
  }
  if (cursor < text.length) total += countTokens(text.slice(cursor));
  return total;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
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
