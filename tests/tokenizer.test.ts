import { describe, expect, it } from 'vitest';
import { encode } from 'gpt-tokenizer';
import { estimateTokens, estimateToolTokens, serializeToolForBudget } from '../src/core/tokenizer.js';
import { tool } from './helpers.js';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('matches the underlying o200k_base encoder as an independent oracle', () => {
    const text = 'The quick brown fox jumps over the lazy dog. Tool: list_invoices(status, since, limit).';
    expect(estimateTokens(text)).toBe(encode(text).length);
  });

  it('grows with input length', () => {
    expect(estimateTokens('a'.repeat(1000))).toBeGreaterThan(estimateTokens('a'.repeat(10)));
  });
});

describe('serializeToolForBudget / estimateToolTokens', () => {
  it('omits absent optional fields from the serialized payload', () => {
    const t = tool({ name: 't', inputSchema: { type: 'object', properties: {} } });
    const json = serializeToolForBudget(t);
    expect(json).not.toContain('description');
    expect(json).not.toContain('annotations');
  });

  it('counts more tokens for a tool with a longer description', () => {
    const short = tool({ name: 't', description: 'Short.' });
    const long = tool({ name: 't', description: 'A '.repeat(300) + 'much longer description.' });
    expect(estimateToolTokens(long)).toBeGreaterThan(estimateToolTokens(short));
  });

  it('cross-checks against directly encoding the same JSON', () => {
    const t = tool({ name: 't', description: 'Does a thing.' });
    expect(estimateToolTokens(t)).toBe(encode(serializeToolForBudget(t)).length);
  });
});
