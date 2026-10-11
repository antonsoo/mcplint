import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFile } from '../../src/collectors/file.js';
import { loadConfigFile } from '../../src/core/config.js';
import { decodeText, TextDecodingError } from '../../src/core/read-text.js';

function utf16(source: string, bigEndian: boolean): Buffer {
  const bytes = Buffer.alloc(2 + source.length * 2);
  for (let i = -1; i < source.length; i++) {
    const unit = i < 0 ? 0xfeff : source.charCodeAt(i);
    if (bigEndian) bytes.writeUInt16BE(unit, 2 + i * 2);
    else bytes.writeUInt16LE(unit, 2 + i * 2);
  }
  return bytes;
}

// `... > tools.json` in Windows PowerShell writes UTF-16 with a byte-order mark and CRLF.
describe('files saved by a Windows shell', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcplint-encodings-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ['little-endian', false],
    ['big-endian', true],
  ])('a UTF-16 %s tools file lints like the UTF-8 one', async (_label, bigEndian) => {
    const text = await readFile(new URL('../../examples/tools.json', import.meta.url), 'utf8');
    const plain = join(dir, 'tools.json');
    const wide = join(dir, 'tools-utf16.json');
    await writeFile(plain, text);
    await writeFile(wide, utf16(text.replace(/\n/g, '\r\n'), bigEndian));
    const expected = await collectFile(plain);
    const got = await collectFile(wide);
    expect(expected.tools.length).toBeGreaterThan(1);
    expect(got.tools).toEqual(expected.tools);
  });

  it('a UTF-16 .mcplintrc.json is read', async () => {
    await writeFile(join(dir, '.mcplintrc.json'), utf16('{ "budget": 250 }\r\n', false));
    expect(await loadConfigFile(dir)).toEqual({ budget: 250 });
  });

  it('a tools file that is not text still says so in one line', async () => {
    const path = join(dir, 'tools.json');
    await writeFile(path, Buffer.from([0x00, 0x01, 0x02, 0x7b]));
    await expect(collectFile(path)).rejects.toThrow(/tools\.json is not valid JSON/);
  });

  it.each([
    ['UTF-8', Buffer.from([0x61, 0xc3, 0x62])],
    ['UTF-8', Buffer.from([0x61, 0x80, 0x62])],
    ['UTF-16LE', Buffer.from([0xff, 0xfe, 0x00, 0xd8, 0x62, 0x00])],
    ['UTF-16BE', Buffer.from([0xfe, 0xff, 0xd8, 0x00, 0x00, 0x62])],
    ['UTF-16LE', Buffer.from([0xff, 0xfe, 0x61])],
    ['UTF-16BE', Buffer.from([0xfe, 0xff, 0x00])]
  ])('rejects damaged %s instead of manufacturing replacement characters', (encoding, bytes) => {
    expect(() => decodeText(bytes as Buffer)).toThrow(TextDecodingError);
    expect(() => decodeText(bytes as Buffer)).toThrow(`invalid ${String(encoding)} text`);
  });

  it.each([false, true])('preserves intentional replacement characters and astral characters in UTF-16 (BE=%s)', bigEndian => {
    expect(decodeText(utf16('café \ufffd \u{1f642}', bigEndian))).toBe('café \ufffd \u{1f642}');
  });

  it('preserves an intentional replacement character in valid UTF-8', () => {
    expect(decodeText(Buffer.from('café \ufffd \u{1f642}'))).toBe('café \ufffd \u{1f642}');
  });

  it('refuses malformed description bytes before a saved tool list can be audited', async () => {
    const path = join(dir, 'damaged-tools.json');
    const prefix = Buffer.from('[{"name":"read_invoice","description":"Read ');
    await writeFile(path, Buffer.concat([prefix, Buffer.from([0xc3]), Buffer.from(' invoice.","inputSchema":{"type":"object"}}]')]));
    await expect(collectFile(path)).rejects.toThrow(TextDecodingError);
  });
});
