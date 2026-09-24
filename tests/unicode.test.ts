import { describe, expect, it } from 'vitest';
import { findHiddenUnicode, hasHiddenUnicode } from '../src/core/unicode.js';

function tagEncode(ascii: string): string {
  return Array.from(ascii, (ch) => String.fromCodePoint(0xe0000 + ch.charCodeAt(0))).join('');
}

describe('findHiddenUnicode', () => {
  it('returns nothing for plain text', () => {
    expect(findHiddenUnicode('nothing to see here')).toHaveLength(0);
  });

  it('decodes a run of tag characters back to ASCII', () => {
    const hits = findHiddenUnicode(tagEncode('hello world'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'tag-characters', decoded: 'hello world', benign: false });
  });

  it('marks the England flag tag sequence as benign', () => {
    const flag = '\u{1F3F4}' + tagEncode('gbeng') + String.fromCodePoint(0xe007f);
    const hits = findHiddenUnicode(flag);
    const tagHit = hits.find((h) => h.kind === 'tag-characters');
    expect(tagHit?.benign).toBe(true);
  });

  it('groups adjacent zero-width characters as separate single-char findings', () => {
    const hits = findHiddenUnicode('a​b‌c');
    expect(hits.filter((h) => h.kind === 'zero-width')).toHaveLength(2);
  });

  it('decodes a variation-selector run when the bytes form valid UTF-8', () => {
    // Encode "hi" as two low variation selectors (VS1=U+FE00 -> byte 0, so use VS 'h'.charCodeAt(0) offset).
    const bytes = [104, 105]; // "h", "i"
    const run = bytes.map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + (b - 16)));
    const hits = findHiddenUnicode(`marker❤${run.join('')}`);
    const vsHit = hits.find((h) => h.kind === 'variation-selectors');
    expect(vsHit?.decoded).toBe('hi');
  });

  it('ignores a single trailing variation selector after a base character', () => {
    expect(findHiddenUnicode('❤️')).toHaveLength(0);
  });
});

describe('hasHiddenUnicode', () => {
  it('is false for undefined/empty text', () => {
    expect(hasHiddenUnicode(undefined)).toBe(false);
    expect(hasHiddenUnicode('')).toBe(false);
  });

  it('is true when a non-benign hidden run is present', () => {
    expect(hasHiddenUnicode(`hi${tagEncode('secret')}`)).toBe(true);
  });

  it('is false when only the benign flag sequence is present', () => {
    const flag = '\u{1F3F4}' + tagEncode('gbeng') + String.fromCodePoint(0xe007f);
    expect(hasHiddenUnicode(flag)).toBe(false);
  });
});
