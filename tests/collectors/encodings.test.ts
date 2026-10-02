import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFile } from '../../src/collectors/file.js';
import { loadConfigFile } from '../../src/core/config.js';

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
});
