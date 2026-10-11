import { describe, expect, it } from 'vitest';
import { nameDistance } from '../src/core/name-distance.js';

// Independent full Wagner-Fischer matrix: no band, cutoff or common-end trimming.
function reference(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i]![0] = i;
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1,
      rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return rows[a.length]![b.length]!;
}

describe('thresholded name distance', () => {
  it('agrees with the full matrix for every pair of three-letter-alphabet strings through length 5', () => {
    const words = [''];
    let layer = [''];
    for (let length = 1; length <= 5; length++) {
      layer = layer.flatMap(word => ['a', 'b', 'c'].map(char => word + char));
      words.push(...layer);
    }
    for (const a of words) for (const b of words) {
      const actual = nameDistance(a, b);
      const expected = Math.min(3, reference(a, b));
      if (actual !== expected) throw new Error(`${JSON.stringify([a, b])}: ${actual} != ${expected}`);
    }
  });

  it('keeps UTF-16 and lowercased-name semantics, including surrogate and combining units', () => {
    const names = ['İ', 'i', 'i\u0307', '\ud800', '\udc00', '🧪', '😀', 'fetch_🧪', 'fetch_İ'];
    for (const a of names) for (const b of names) {
      expect(nameDistance(a.toLowerCase(), b.toLowerCase())).toBe(Math.min(3, reference(a.toLowerCase(), b.toLowerCase())));
    }
  });

  it('handles long near names, unrelated names and wildly different lengths without a matrix', () => {
    const common = 'a'.repeat(100_000);
    expect(nameDistance(common + 'get', common + 'gets')).toBe(1);
    expect(nameDistance('b' + common, common + 'b')).toBe(2);
    expect(nameDistance(common, 'b'.repeat(100_000))).toBe(3);
    expect(nameDistance(common, 'a')).toBe(3);
    expect(nameDistance(common + 'ABC', common + 'XYZ')).toBe(3);
  });
});
