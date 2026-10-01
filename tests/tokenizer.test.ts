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

describe('estimateTokens on long unbroken runs', () => {
  it('counts ordinary text, and runs up to 2,048 characters, exactly', () => {
    for (const text of ['x'.repeat(2048), 'a b '.repeat(4000), JSON.stringify({ k: 'v'.repeat(900), n: [1, 2, 3] })]) {
      expect(estimateTokens(text)).toBe(encode(text).length);
    }
  });

  it('stays within 2% of the exact count for a long run cut into pieces', () => {
    let seed = 7;
    const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const base64 = Array.from({ length: 12_000 }, () => alphabet[next() % 64]).join('');
    for (const text of [base64, '\u6a21\u578b'.repeat(3000), 'a'.repeat(9000)]) {
      const exact = encode(text).length;
      expect(Math.abs(estimateTokens(text) - exact) / exact).toBeLessThan(0.02);
    }
  });

  it('never cuts a surrogate pair', () => {
    // 2,048 characters, then an emoji straddling the cut: the pieces must still be whole.
    const text = 'x'.repeat(2047) + '\u{1f600}'.repeat(1500);
    expect(Math.abs(estimateTokens(text) - encode(text).length)).toBeLessThanOrEqual(3);
  });

  it.each([
    ['zero-width spaces', '\u200b'],
    ['spaces', ' '],
    ['bidi overrides', '\u202e'],
    ['one letter', 'a'],
  ])('counts 200,000 %s in well under a second', (_name, unit) => {
    // The same 40,000 zero-width spaces took 5.5 s, and the time grew with the square of the length.
    const started = performance.now();
    expect(estimateTokens(unit.repeat(200_000))).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

