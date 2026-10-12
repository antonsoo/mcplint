/** The line-oriented envFile syntax used by VS Code's MCP launcher.
 * Reference and differential replay: studies/envfile-syntax/README.md.
 * Values are data: no variable expansion, shell evaluation or execution.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const values = new Map<string, string>();
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const separator = outsideQuotes(line, '=:');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    let value = line.slice(separator + 1);
    const comment = outsideQuotes(value, '#');
    if (comment >= 0) value = value.slice(0, comment);
    value = value.trim();
    const quote = value[0];
    if (value.length >= 2 && quote !== undefined && "\"'`".includes(quote) && value.at(-1) === quote) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\([nr])/g, (_, escaped: string) => escaped === 'n' ? '\n' : '\r');
    }
    values.set(key, value);
  }
  return Object.fromEntries(values);
}

/** Delimiters inside matching quotes belong to the value, not the .env syntax. */
function outsideQuotes(text: string, delimiters: string): number {
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote !== undefined) {
      if (char === quote && text[index - 1] !== '\\') quote = undefined;
    } else if ("\"'`".includes(char)) quote = char;
    else if (delimiters.includes(char)) return index;
  }
  return -1;
}
