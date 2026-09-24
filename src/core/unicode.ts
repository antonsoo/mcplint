/**
 * Detection and decoding for Unicode characters that render invisibly (or
 * near-invisibly) but are still tokenized and read by a language model.
 * Three families matter for tool-poisoning:
 *
 *  - Zero-width / formatting characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM,
 *    soft hyphen): legitimate in complex-script shaping, essentially never
 *    legitimate in a plain-English tool description.
 *  - Bidi control characters (LRE/RLE/PDF/LRO/RLO, LRI/RLI/FSI/PDI, LRM/RLM,
 *    ALM): can reorder how a string *displays* without changing what a model
 *    reads, letting an attacker hide text visually.
 *  - Unicode Tag characters, U+E0000-U+E007F (Supplementary Special-purpose
 *    Plane): originally for defunct language-tagging, now with exactly one
 *    legitimate remaining use (regional flag emoji, e.g. the England flag,
 *    which follows U+1F3F4 with tag characters spelling "gbeng"). Any other
 *    occurrence smuggles literal ASCII text that is invisible in most UIs but
 *    readable by an LLM byte-for-byte — the "ASCII smuggling" technique
 *    documented in Johann Rehberger, "Hiding and Finding Text with Unicode
 *    Tags," Embrace The Red, 2024
 *    (https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/).
 *  - Variation selectors, U+FE00-U+FE0F and U+E0100-U+E01EF: legitimately a
 *    single selector after one base character (emoji presentation, or CJK
 *    ideographic variation). A *run* of several in sequence is the
 *    variation-selector byte-smuggling scheme used by tools such as
 *    paulgb/emoji-encoder, where each selector encodes one arbitrary byte
 *    (VS1-16 -> 0x00-0x0F, VS17-256 -> 0x10-0xFF) hidden after a visible
 *    anchor character.
 */

export type HiddenUnicodeKind = 'zero-width' | 'bidi-control' | 'tag-characters' | 'variation-selectors';

export interface HiddenUnicodeFinding {
  kind: HiddenUnicodeKind;
  /** Codepoints involved, as `U+XXXX`. */
  codepoints: string[];
  count: number;
  /** Decoded payload, when the scheme is fully reversible (tags, variation selectors). */
  decoded?: string;
  /** True for the one legitimate tag-character use case: a regional flag emoji. */
  benign?: boolean;
}

const ZERO_WIDTH = new Set([0x00ad, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const BIDI_CONTROL = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069
]);
const BLACK_FLAG = 0x1f3f4;

function codepoints(text: string): number[] {
  return Array.from(text, (ch) => ch.codePointAt(0) ?? 0);
}

function fmt(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function isTagChar(cp: number): boolean {
  return cp >= 0xe0000 && cp <= 0xe007f;
}

function isVariationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}

function decodeTagRun(run: number[]): string {
  // U+E0020-U+E007E mirror ASCII 0x20-0x7E; U+E0001 and U+E007F carry no glyph.
  return run
    .filter((cp) => cp >= 0xe0020 && cp <= 0xe007e)
    .map((cp) => String.fromCharCode(cp - 0xe0000))
    .join('');
}

function decodeVariationRun(run: number[]): string | undefined {
  const bytes = run.map((cp) => (cp <= 0xfe0f ? cp - 0xfe00 : cp - 0xe0100 + 16));
  try {
    const decoded = Buffer.from(bytes).toString('utf8');
    // Round-trip check: reject decodes that produce the replacement character,
    // which means the byte sequence was not valid UTF-8 (so probably not a payload).
    if (decoded.includes('�')) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

/**
 * Scans `text` for hidden/invisible Unicode. Returns one finding per
 * contiguous run of a given kind (adjacent tag characters and adjacent
 * variation selectors are grouped and decoded together).
 */
export function findHiddenUnicode(text: string): HiddenUnicodeFinding[] {
  if (!text) return [];
  const cps = codepoints(text);
  const findings: HiddenUnicodeFinding[] = [];

  let i = 0;
  while (i < cps.length) {
    const cp = cps[i] as number;

    if (ZERO_WIDTH.has(cp)) {
      findings.push({ kind: 'zero-width', codepoints: [fmt(cp)], count: 1 });
      i += 1;
      continue;
    }

    if (BIDI_CONTROL.has(cp)) {
      findings.push({ kind: 'bidi-control', codepoints: [fmt(cp)], count: 1 });
      i += 1;
      continue;
    }

    if (isTagChar(cp)) {
      const start = i;
      const run: number[] = [];
      while (i < cps.length && isTagChar(cps[i] as number)) {
        run.push(cps[i] as number);
        i += 1;
      }
      const precededByFlagBase = start > 0 && cps[start - 1] === BLACK_FLAG;
      const decoded = decodeTagRun(run);
      findings.push({
        kind: 'tag-characters',
        codepoints: run.map(fmt),
        count: run.length,
        decoded,
        benign: precededByFlagBase && /^[a-z]{2}[a-z0-9]{2,3}$/.test(decoded)
      });
      continue;
    }

    if (isVariationSelector(cp)) {
      const start = i;
      const run: number[] = [];
      while (i < cps.length && isVariationSelector(cps[i] as number)) {
        run.push(cps[i] as number);
        i += 1;
      }
      // A single trailing selector (emoji presentation, IVS) is normal typography.
      if (run.length === 1 && start > 0) continue;
      findings.push({
        kind: 'variation-selectors',
        codepoints: run.map(fmt),
        count: run.length,
        decoded: decodeVariationRun(run)
      });
      continue;
    }

    i += 1;
  }

  return findings;
}

export function hasHiddenUnicode(text: string | undefined): boolean {
  if (!text) return false;
  return findHiddenUnicode(text).some((f) => !f.benign);
}

const KIND_LABEL: Record<HiddenUnicodeKind, [singular: string, plural: string]> = {
  'zero-width': ['zero-width character', 'zero-width characters'],
  'bidi-control': ['bidi-control character', 'bidi-control characters'],
  'tag-characters': ['tag character', 'tag characters'],
  'variation-selectors': ['variation selector', 'variation selectors']
};

/** Human-readable "N <kind>" with correct singular/plural, e.g. "69 tag characters". */
export function describeHiddenUnicodeCount(kind: HiddenUnicodeKind, count: number): string {
  const [singular, plural] = KIND_LABEL[kind];
  return `${count} ${count === 1 ? singular : plural}`;
}
