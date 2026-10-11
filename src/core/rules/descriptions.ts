import type { CollectedTool, Finding, Rule, RuleContext } from '../types.js';
import { asSchema, isPlainObject, requiredNames, schemaProperties } from '../schema-utils.js';

const MIN_WORDS = 4;
const MIN_CHARS = 20;
const MAX_CHARS = 1200;

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export const missing: Rule = {
  id: 'description/missing',
  category: 'description',
  defaultSeverity: 'error',
  summary: 'Tool has no description at all.',
  rationale:
    'Without a description the model has only the tool name to decide when to call it — the single highest-impact ' +
    'field for tool selection accuracy, per the Claude API tool-use documentation\'s own guidance to write ' +
    '"extremely detailed descriptions."',
  check(ctx: RuleContext): Finding[] {
    return ctx.target.tools
      .filter((t) => !t.description || t.description.trim().length === 0)
      .map((t) => ({
        ruleId: this.id,
        severity: this.defaultSeverity,
        serverId: t.serverId,
        subject: { kind: 'tool' as const, name: t.name },
        message: 'No description provided.'
      }));
  }
};

export const tooShort: Rule = {
  id: 'description/too-short',
  category: 'description',
  defaultSeverity: 'warning',
  summary: `Description is shorter than ${MIN_CHARS} characters or fewer than ${MIN_WORDS} words.`,
  rationale:
    'A description like "Gets data." tells the model nothing about when to prefer this tool over a similar one, ' +
    'what the parameters mean, or what it returns.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      const d = t.description?.trim();
      if (!d) continue; // handled by `missing`
      if (d.length < MIN_CHARS || words(d) < MIN_WORDS) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: `Description is only ${d.length} characters / ${words(d)} words: "${d}"`
        });
      }
    }
    return findings;
  }
};

export const tooLong: Rule = {
  id: 'description/too-long',
  category: 'description',
  defaultSeverity: 'info',
  summary: `Description exceeds ${MAX_CHARS} characters.`,
  rationale:
    'Past a few sentences, additional prose has diminishing returns for tool selection and a direct token cost on ' +
    'every request; long usage guides belong in a resource the tool can point to, not the description.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      const d = t.description ?? '';
      if (d.length > MAX_CHARS) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: `Description is ${d.length} characters (over ${MAX_CHARS}).`
        });
      }
    }
    return findings;
  }
};

export const paramMissingDescription: Rule = {
  id: 'description/param-missing',
  category: 'description',
  defaultSeverity: 'warning',
  summary: 'An input parameter has no description.',
  rationale:
    'The model has only the parameter name and type to decide what value to pass; for anything but the most ' +
    'obvious parameter (e.g. a lone `query: string`) that is not enough to fill it in correctly.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      const props = schemaProperties(asSchema(t.inputSchema));
      const bare = props.filter(([, prop]) => !prop.description || prop.description.trim().length === 0).map(([name]) => name);
      if (bare.length === 0) continue;
      // One finding per tool: a tool with twelve bare parameters has one problem, not twelve.
      const shown = bare.slice(0, 6).map((name) => `"${name}"`).join(', ') + (bare.length > 6 ? ` and ${bare.length - 6} more` : '');
      findings.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        serverId: t.serverId,
        subject: { kind: 'tool', name: t.name },
        message:
          bare.length === 1
            ? `Parameter ${shown} has no description.`
            : `${bare.length} of ${props.length} parameters have no description: ${shown}.`
      });
    }
    return findings;
  }
};

type ScalarChoice = string | number | boolean | null;
function scalarChoice(value: unknown): value is ScalarChoice {
  return value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
}

// Whole numeric spellings: do not count the 1 in 10, -1, 1.5, 1e3 or v1 as
// documentation for the choice 1. Exponents and signed decimals may be written
// differently from JSON.stringify while still naming the same numeric value.
const NUMBER_MENTION = /(?<![\p{L}\p{N}_.,+-])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?(?![\p{L}\p{N}_]|[.,]\d)/giu;

/** Compare decimal spellings without Number() rounding 1.00000000000000001
 * to 1, or underflowing 1e-999 to 0. Finite enum numbers use their JSON spelling.
 */
function numericSpelling(text: string): string | undefined {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/iu.exec(text);
  if (!match) return undefined;
  const fraction = match[3] ?? '';
  const digits = `${match[2]}${fraction}`.replace(/^0+/u, '');
  if (!digits) return '0';
  const significant = digits.replace(/0+$/u, '');
  const exponent = Number(match[4] ?? 0);
  // Such an exponent cannot match a finite enum number within the metadata
  // text budget; avoid large-integer parsing or unsafe exponent arithmetic.
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1e9) return undefined;
  return `${match[1] === '-' ? '-' : ''}${significant}e${exponent - fraction.length + digits.length - significant.length}`;
}

export const enumUnexplained: Rule = {
  id: 'description/enum-unexplained',
  category: 'description',
  defaultSeverity: 'info',
  summary: 'A scalar enum parameter has more than one value but its description does not mention any of them.',
  rationale:
    'A literal mention is a limited clue that a description documents an enum choice, not proof of a useful ' +
    'explanation. This heuristic covers string, finite number, boolean and null choices. Enums containing ' +
    'objects or arrays are outside its scope; their schema, description presence and safety checks still run.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      const schema = asSchema(t.inputSchema);
      for (const [name, prop] of schemaProperties(schema)) {
        if (!Array.isArray(prop.enum) || prop.enum.length < 2) continue;
        // Structured choices cannot be assessed by looking for a word in prose.
        // In particular, never coerce a JSON object's toString data property.
        if (!prop.enum.every(scalarChoice)) continue;
        const desc = (prop.description ?? '').toLowerCase();
        const words = new Set(desc.match(/[\p{L}\p{N}_]+/gu) ?? []);
        const numbers = new Set([...desc.matchAll(NUMBER_MENTION)].flatMap(match => {
          const spelling = numericSpelling(match[0]);
          return spelling === undefined ? [] : [spelling];
        }));
        const mentioned = prop.enum.some(value => {
          if (typeof value === 'number') return numbers.has(numericSpelling(String(value))!);
          if (typeof value !== 'string') return words.has(JSON.stringify(value));
          if (value === '') return desc.includes('""') || desc.includes("''") || /\bempty\s+string\b/u.test(desc);
          if (!value.trim()) return desc.includes(JSON.stringify(value));
          return desc.includes(value.toLowerCase());
        });
        if (!mentioned) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: t.serverId,
            subject: { kind: 'tool', name: t.name },
            message: `Parameter "${name}" has scalar enum ${JSON.stringify(prop.enum)} but its description mentions none of the values.`
          });
        }
      }
    }
    return findings;
  }
};

export const requiredUndeclared: Rule = {
  id: 'description/required-undeclared',
  category: 'description',
  defaultSeverity: 'warning',
  summary: 'A simple input schema requires a parameter without a named property definition.',
  rationale:
    'JSON Schema permits required names outside properties. In a simple open schema this is a documentation ' +
    'warning; with additionalProperties: false it is a contradiction. Composed, referenced and pattern-based ' +
    'schemas can define parameters elsewhere and are outside this local-name heuristic.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      const schema = asSchema(t.inputSchema);
      if (!schema) continue;
      // Do not mistake a root-only name lookup for JSON Schema evaluation. In
      // particular, a referenced or conditional schema may document this name.
      // Do not execute untrusted patternProperties regexes to guess otherwise.
      if (['$ref', '$dynamicRef', '$recursiveRef', 'allOf', 'anyOf', 'oneOf',
        'if', 'then', 'else', 'dependentSchemas', 'dependencies'].some(key => Object.hasOwn(schema, key)) ||
        (isPlainObject(schema.patternProperties) && Object.keys(schema.patternProperties).length > 0) ||
        isPlainObject(schema.additionalProperties) || isPlainObject(schema.unevaluatedProperties)) continue;
      const propNames = new Set(schemaProperties(schema).map(([n]) => n));
      for (const req of requiredNames(schema)) {
        if (!propNames.has(req)) {
          findings.push({
            ruleId: this.id,
            severity: schema.additionalProperties === false ? 'error' : this.defaultSeverity,
            serverId: t.serverId,
            subject: { kind: 'tool', name: t.name },
            message: schema.additionalProperties === false
              ? `"${req}" is required but additionalProperties: false forbids it; no matching inputSchema.properties entry exists.`
              : `"${req}" is required without a named property definition. This is valid in an open JSON Schema; check whether its type and usage need documenting.`
          });
        }
      }
    }
    return findings;
  }
};

function normalizedWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.75;

export const nearDuplicate: Rule = {
  id: 'description/near-duplicate',
  category: 'description',
  defaultSeverity: 'warning',
  summary: 'Two differently-named tools have near-identical descriptions.',
  rationale:
    'Word-overlap similarity above the threshold usually means the model cannot reliably tell the two tools ' +
    'apart from their descriptions alone and will pick between them close to at random.',
  check(ctx: RuleContext): Finding[] {
    const tools = ctx.target.tools.filter((t) => (t.description?.trim().length ?? 0) >= MIN_CHARS);
    const wordSets = tools.map((t) => normalizedWords(t.description ?? ''));

    // Tools are grouped by similarity, and each group is one finding. A finding per pair is
    // fine for the usual two tools, and useless for a generated server: 250 tools stamped
    // from one template are 31,125 pairs.
    const group = tools.map((_, i) => i);
    const root = (i: number): number => {
      while (group[i] !== i) {
        group[i] = group[group[i]!]!;
        i = group[i]!;
      }
      return i;
    };
    const overlap = new Map<number, number>(); // the first similar pair's overlap, by the lower index
    for (let i = 0; i < tools.length; i += 1) {
      for (let j = i + 1; j < tools.length; j += 1) {
        if (tools[i]!.name === tools[j]!.name) continue;
        const sim = jaccard(wordSets[i]!, wordSets[j]!);
        if (sim < SIMILARITY_THRESHOLD) continue;
        if (!overlap.has(i)) overlap.set(i, sim);
        // The lower index stays the root, so a group is reported on its first tool.
        const a = root(i);
        const b = root(j);
        if (a !== b) group[Math.max(a, b)] = Math.min(a, b);
      }
    }

    const members = new Map<number, number[]>();
    tools.forEach((_, i) => {
      const r = root(i);
      members.set(r, [...(members.get(r) ?? []), i]);
    });

    const findings: Finding[] = [];
    for (const [first, indexes] of members) {
      if (indexes.length < 2) continue;
      const a = tools[first] as CollectedTool;
      const others = indexes.slice(1).map((i) => tools[i] as CollectedTool);
      let message: string;
      if (others.length === 1) {
        const b = others[0]!;
        message = `"${a.name}" and "${b.name}" (${b.serverId}) have ${Math.round((overlap.get(first) ?? SIMILARITY_THRESHOLD) * 100)}% word overlap in their descriptions.`;
      } else {
        const named = others.slice(0, 3).map((t) => `"${t.name}"`).join(', ');
        const more = others.length > 3 ? ` and ${others.length - 3} more` : '';
        message =
          `"${a.name}" and ${others.length} other tools (${named}${more}) have near-identical descriptions: ` +
          `each has at least ${Math.round(SIMILARITY_THRESHOLD * 100)}% word overlap with another in the group.`;
      }
      findings.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        serverId: a.serverId,
        subject: { kind: 'tool', name: a.name },
        message
      });
    }
    return findings;
  }
};

export const rules: Rule[] = [
  missing,
  tooShort,
  tooLong,
  paramMissingDescription,
  enumUnexplained,
  requiredUndeclared,
  nearDuplicate
];
