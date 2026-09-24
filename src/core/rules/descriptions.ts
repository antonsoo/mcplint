import type { CollectedTool, Finding, Rule, RuleContext } from '../types.js';
import { asSchema, requiredNames, schemaProperties } from '../schema-utils.js';

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
      const schema = asSchema(t.inputSchema);
      for (const [name, prop] of schemaProperties(schema)) {
        if (!prop.description || prop.description.trim().length === 0) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: t.serverId,
            subject: { kind: 'tool', name: t.name },
            message: `Parameter "${name}" has no description.`
          });
        }
      }
    }
    return findings;
  }
};

export const enumUnexplained: Rule = {
  id: 'description/enum-unexplained',
  category: 'description',
  defaultSeverity: 'info',
  summary: 'An enum parameter has more than one value but its description does not mention any of them.',
  rationale:
    'When enum members are not self-explanatory (single letters, codes, abbreviations) the model needs the ' +
    'description to spell out what each value means; an enum silently listed with no prose forces guessing.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      const schema = asSchema(t.inputSchema);
      for (const [name, prop] of schemaProperties(schema)) {
        if (!Array.isArray(prop.enum) || prop.enum.length < 2) continue;
        const desc = (prop.description ?? '').toLowerCase();
        const mentioned = prop.enum.filter(
          (v) => typeof v === 'string' && desc.includes(v.toLowerCase())
        ).length;
        if (mentioned === 0) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: t.serverId,
            subject: { kind: 'tool', name: t.name },
            message: `Parameter "${name}" has enum [${prop.enum.join(', ')}] but its description explains none of the values.`
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
  defaultSeverity: 'error',
  summary: 'inputSchema.required lists a parameter that is not declared in properties.',
  rationale:
    'A required parameter with no matching property definition cannot be validated or explained to the model; ' +
    'most clients will either drop the tool or send an incomplete call that the server has to reject.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      const schema = asSchema(t.inputSchema);
      const propNames = new Set(schemaProperties(schema).map(([n]) => n));
      for (const req of requiredNames(schema)) {
        if (!propNames.has(req)) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: t.serverId,
            subject: { kind: 'tool', name: t.name },
            message: `"${req}" is required but not declared under inputSchema.properties.`
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
    const findings: Finding[] = [];
    const wordSets = tools.map((t) => normalizedWords(t.description ?? ''));
    for (let i = 0; i < tools.length; i += 1) {
      for (let j = i + 1; j < tools.length; j += 1) {
        const a = tools[i] as CollectedTool;
        const b = tools[j] as CollectedTool;
        if (a.name === b.name) continue;
        const sim = jaccard(wordSets[i]!, wordSets[j]!);
        if (sim >= SIMILARITY_THRESHOLD) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: a.serverId,
            subject: { kind: 'tool', name: a.name },
            message: `"${a.name}" and "${b.name}" (${b.serverId}) have ${Math.round(sim * 100)}% word overlap in their descriptions.`
          });
        }
      }
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
