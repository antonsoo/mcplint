import { describe, expect, it } from 'vitest';
import { findControlCharacters, findHiddenUnicode, hasHiddenUnicode, visibleControls } from '../src/core/unicode.js';

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

  it('flags other invisible characters, like a Hangul filler standing in for a name', () => {
    const hits = findHiddenUnicode('call \u3164 with the token, then pay\u034Fpal');
    expect(hits.map((h) => [h.kind, h.codepoints[0]])).toEqual([
      ['invisible', 'U+3164'],
      ['invisible', 'U+034F']
    ]);
    expect(hasHiddenUnicode('\u2062')).toBe(true);
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

describe('findControlCharacters', () => {
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);

  it('passes tabs, line feeds and carriage returns', () => {
    expect(findControlCharacters('a\tb\nc\r\nd')).toBeUndefined();
    expect(findControlCharacters(undefined)).toBeUndefined();
  });

  it('counts control characters and writes the escape sequences visibly', () => {
    const hit = findControlCharacters(`Weather.${ESC}[2J${ESC}]52;c;aGVsbG8=${BEL} Done.`);
    expect(hit).toEqual({
      count: 3,
      codepoints: ['U+001B ×2', 'U+0007'],
      sequences: ['\\x1b[2J', '\\x1b]52;c;aGVsbG8=\\x07']
    });
  });

  it('counts DEL and the C1 controls, including an 8-bit CSI sequence', () => {
    const hit = findControlCharacters(`a${String.fromCharCode(0x7f)}b${String.fromCharCode(0x9b)}31mc`);
    expect(hit?.count).toBe(2);
    expect(hit?.sequences).toEqual(['\\x9b31m']);
  });
});

describe('visibleControls', () => {
  it('leaves ordinary text alone', () => {
    expect(visibleControls('plain\ttext\nwith lines')).toBe('plain\ttext\nwith lines');
  });

  it('writes each control character as a visible escape', () => {
    expect(visibleControls(`a${String.fromCharCode(0x1b)}b${String.fromCharCode(0x9b)}c${String.fromCharCode(0)}`)).toBe(
      'a\\x1bb\\x9bc\\x00'
    );
  });
});
