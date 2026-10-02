import { readFile } from 'node:fs/promises';

/**
 * A JSON or env file's text, as Windows tools save it too. `... > tools.json` in Windows
 * PowerShell writes UTF-16 with a byte-order mark, and a client config edited in Notepad may
 * carry a UTF-8 one. Read as plain UTF-8, the first was "not valid JSON: Unexpected token".
 * The mark decides the encoding and is dropped.
 */
export function decodeText(bytes: Uint8Array): string {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
  return new TextDecoder(utf16 ?? 'utf-8').decode(bytes);
}

export async function readTextFile(path: string): Promise<string> {
  return decodeText(await readFile(path));
}
