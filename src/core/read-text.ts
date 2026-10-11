import { readFile } from 'node:fs/promises';

export class TextDecodingError extends Error {
  constructor(encoding: string) {
    super(`Input contains invalid ${encoding.toUpperCase()} text. Save it as valid UTF-8 or UTF-16 with a byte-order mark, then retry.`);
    this.name = 'TextDecodingError';
  }
}

/**
 * A JSON or env file's text, as Windows tools save it too. `... > tools.json` in Windows
 * PowerShell writes UTF-16 with a byte-order mark, and a client config edited in Notepad may
 * carry a UTF-8 one. Read as plain UTF-8, the first was "not valid JSON: Unexpected token".
 * The mark decides the encoding and is dropped.
 */
export function decodeText(bytes: Uint8Array): string {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
  const encoding = utf16 ?? 'utf-8';
  try {
    // Replacing damaged bytes would silently change identifiers or instructions
    // before the audit sees them, and can also change a configuration credential.
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new TextDecodingError(encoding);
  }
}

export async function readTextFile(path: string): Promise<string> {
  return decodeText(await readFile(path));
}
