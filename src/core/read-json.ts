/** Validate evidence before analysis can use overwritten fields or rounded numbers.
 * Syntax remains the native parser's job; this scan bounds nesting and tracks object keys.
 * It is iterative so even an input thousands of levels deep produces an actionable error. */
export const MAX_JSON_DEPTH = 128;

export class JsonIntegrityError extends Error {}

/** Decimal value independent of spelling, without converting its digits to a
 * floating-point number. This permits 1.0 / 1e0 while detecting changed IDs or
 * precise decimals after the parser's number is serialized into a snapshot. */
function decimalIdentity(literal: string): string {
  const [coefficient = "", exponent = "0"] = literal.toLowerCase().split("e");
  const dot = coefficient.indexOf(".");
  const fractionDigits = dot < 0 ? 0 : coefficient.length - dot - 1;
  const digits = coefficient.replace(/[-.]/g, "").replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  const power = Number(exponent) - fractionDigits + digits.length - significant.length;
  return `${coefficient.startsWith("-") ? "-" : ""}${significant}e${power}`;
}

export function readJson(text: string): unknown {
  // Validate syntax first so quotes and punctuation have unambiguous token roles.
  // The scan then checks evidence that the native decoded object has already lost.
  const value: unknown = JSON.parse(text);
  const containers: (Set<string> | undefined)[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === '"') break;
      }
      let next = i + 1;
      while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      const keys = containers[containers.length - 1];
      if (keys && text[next] === ":") {
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        if (keys.has(key)) throw new JsonIntegrityError(`Duplicate JSON object field at character ${start + 1}. Keep one explicit value per field before auditing or comparing metadata.`);
        keys.add(key);
      }
    } else if (char === "{" || char === "[") {
      containers.push(char === "{" ? new Set() : undefined);
      if (containers.length > MAX_JSON_DEPTH) throw new JsonIntegrityError(`JSON nesting exceeds ${MAX_JSON_DEPTH} levels. Flatten the metadata before auditing or comparing it.`);
    } else if (char === "}" || char === "]") {
      containers.pop();
    } else if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) {
      const start = i;
      while (i + 1 < text.length && /[\d.eE+-]/.test(text[i + 1]!)) i++;
      const literal = text.slice(start, i + 1);
      const number = Number(literal);
      if (!Number.isFinite(number)) throw new JsonIntegrityError("JSON number is outside the finite JavaScript number range. Use representable numeric metadata, or a string only if the schema permits one.");
      if (number === 0 && /[1-9]/.test(literal.split(/[eE]/, 1)[0]!)) {
        throw new JsonIntegrityError("Nonzero JSON number underflows to zero in JavaScript. Use representable numeric metadata, or a string only if the schema permits one.");
      }
      const serialized = String(number);
      if (literal !== serialized && decimalIdentity(literal) !== decimalIdentity(serialized)) {
        throw new JsonIntegrityError(`JSON number at character ${start + 1} would be rounded during analysis. mcplint cannot audit or compare this metadata without changing its numeric content.`);
      }
    }
  }
  return value;
}
