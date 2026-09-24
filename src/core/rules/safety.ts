import type { CollectedItem, Finding, Rule, RuleContext } from '../types.js';
import { describeHiddenUnicodeCount, findHiddenUnicode } from '../unicode.js';
import { schemaProperties, asSchema } from '../schema-utils.js';

function textFields(item: CollectedItem): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  if (item.description) out.push({ field: 'description', text: item.description });
  if (item.title) out.push({ field: 'title', text: item.title });
  if (item.kind === 'tool') {
    for (const [name, prop] of schemaProperties(asSchema(item.inputSchema))) {
      if (prop.description) out.push({ field: `inputSchema.properties.${name}.description`, text: prop.description });
    }
  }
  if (item.kind === 'prompt' && item.arguments) {
    for (const arg of item.arguments) {
      if (arg.description) out.push({ field: `arguments.${arg.name}.description`, text: arg.description });
    }
  }
  return out;
}

function allItems(ctx: RuleContext): CollectedItem[] {
  return [...ctx.target.tools, ...ctx.target.prompts, ...ctx.target.resources];
}

/**
 * `textFields` plus one synthetic field per decoded hidden-Unicode payload.
 * A payload smuggled via tag characters or variation selectors is plain
 * ASCII once decoded, and it deserves the same pattern scanning as visible
 * text — that is usually where the actual instruction lives.
 */
function textFieldsWithDecoded(item: CollectedItem): { field: string; text: string }[] {
  const out = textFields(item);
  const extra: { field: string; text: string }[] = [];
  for (const { field, text } of out) {
    for (const hit of findHiddenUnicode(text)) {
      if (!hit.benign && hit.decoded) extra.push({ field: `${field} [decoded hidden text]`, text: hit.decoded });
    }
  }
  return [...out, ...extra];
}

export const hiddenUnicode: Rule = {
  id: 'safety/hidden-unicode',
  category: 'safety',
  defaultSeverity: 'error',
  summary: 'Text contains zero-width, bidi-control, Unicode Tag, or variation-selector characters.',
  rationale:
    'These characters render invisibly or near-invisibly in most UIs but are tokenized and read by the model like ' +
    'any other character, so they can carry an instruction a human reviewer never sees. See ' +
    'docs/rules/safety-hidden-unicode.md for the specific techniques detected.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const item of allItems(ctx)) {
      for (const { field, text } of textFields(item)) {
        for (const hit of findHiddenUnicode(text)) {
          if (hit.benign) continue;
          const codepointList = hit.codepoints.slice(0, 12).join(' ') + (hit.codepoints.length > 12 ? ' ...' : '');
          const decodedPart = hit.decoded ? ` Decodes to: ${JSON.stringify(hit.decoded)}.` : '';
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: item.serverId,
            subject: { kind: item.kind, name: item.name },
            message: `${field}: ${describeHiddenUnicodeCount(hit.kind, hit.count)} found.${decodedPart}`,
            detail: codepointList
          });
        }
      }
    }
    return findings;
  }
};

interface Pattern {
  regex: RegExp;
  label: string;
}

const INJECTION_PATTERNS: Pattern[] = [
  { regex: /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+instructions?/i, label: 'instruction override' },
  { regex: /disregard\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions?/i, label: 'instruction override' },
  { regex: /do\s+not\s+tell\s+(the\s+)?user/i, label: 'concealment from the user' },
  { regex: /without\s+(telling|informing|notifying)\s+the\s+user/i, label: 'concealment from the user' },
  { regex: /don'?t\s+(let|allow)\s+the\s+user\s+(know|see)/i, label: 'concealment from the user' },
  { regex: /<important>[\s\S]*?<\/important>/i, label: '<IMPORTANT> block' },
  { regex: /\bsystem\s+prompt\b.{0,40}\b(override|ignore|replace)/i, label: 'system prompt override' },
  { regex: /you\s+must\s+always\s+call\s+this\s+tool\s+first/i, label: 'forced tool ordering' },
  { regex: /this\s+is\s+(a\s+)?(mandatory|required)\s+(first\s+)?step/i, label: 'forced tool ordering' }
];

export const promptInjection: Rule = {
  id: 'safety/prompt-injection',
  category: 'safety',
  defaultSeverity: 'error',
  summary: 'Text contains a known prompt-injection pattern (instruction override, concealment, forced ordering).',
  rationale:
    'A tool/prompt/resource description is part of the model\'s context on every turn. Phrases that try to ' +
    'override the system prompt, hide actions from the user, or coerce a specific tool-call order are the same ' +
    'patterns used in documented prompt-injection and tool-poisoning attacks against MCP servers.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const item of allItems(ctx)) {
      for (const { field, text } of textFieldsWithDecoded(item)) {
        for (const pattern of INJECTION_PATTERNS) {
          const match = text.match(pattern.regex);
          if (match) {
            findings.push({
              ruleId: this.id,
              severity: this.defaultSeverity,
              serverId: item.serverId,
              subject: { kind: item.kind, name: item.name },
              message: `${field} matches the "${pattern.label}" pattern: ${JSON.stringify(match[0].slice(0, 200))}`,
              detail: match[0].slice(0, 200)
            });
          }
        }
      }
    }
    return findings;
  }
};

const SECRET_PATH_PATTERNS: Pattern[] = [
  { regex: /~\/\.ssh\b/i, label: '~/.ssh' },
  { regex: /\.ssh\/id_[a-z]+/i, label: 'SSH private key' },
  { regex: /\benv\s+file\b|\.env\b/i, label: '.env file' },
  { regex: /~\/\.aws\/credentials/i, label: 'AWS credentials file' },
  { regex: /\/etc\/(passwd|shadow)\b/i, label: '/etc/passwd or /etc/shadow' },
  { regex: /\bprivate\s+key\b.{0,30}\b(read|send|upload|cat|print|exfiltrate)/i, label: 'private key exfiltration' },
  { regex: /\b(api|secret)[_\s-]?keys?\b.{0,30}\b(read|send|upload|exfiltrate)/i, label: 'API key exfiltration' }
];

export const secretAccess: Rule = {
  id: 'safety/secret-access',
  category: 'safety',
  defaultSeverity: 'error',
  summary: 'Text instructs reading or exfiltrating credential material (~/.ssh, .env, cloud credentials).',
  rationale:
    'A legitimate tool has no reason to describe reading SSH keys, dotenv files, or cloud credential stores as ' +
    'part of its own behavior; this is the signature of a tool trying to get an agent to read and leak secrets.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const item of allItems(ctx)) {
      for (const { field, text } of textFieldsWithDecoded(item)) {
        for (const pattern of SECRET_PATH_PATTERNS) {
          const match = text.match(pattern.regex);
          if (match) {
            findings.push({
              ruleId: this.id,
              severity: this.defaultSeverity,
              serverId: item.serverId,
              subject: { kind: item.kind, name: item.name },
              message: `${field} references ${pattern.label}: ${JSON.stringify(match[0].slice(0, 200))}`,
              detail: match[0].slice(0, 200)
            });
          }
        }
      }
    }
    return findings;
  }
};

export const crossToolReference: Rule = {
  id: 'safety/cross-tool-reference',
  category: 'safety',
  defaultSeverity: 'warning',
  summary: 'Description gives instructions about a different, named tool rather than describing itself.',
  rationale:
    'A tool description that tells the model how to call *another* tool (rather than describing its own behavior) ' +
    'is a documented tool-poisoning vector: it lets one server\'s tool silently rewrite how the model uses a tool ' +
    'from a completely different, possibly trusted, server.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const allNames = new Set(ctx.target.tools.map((t) => t.name));
    for (const item of allItems(ctx)) {
      for (const { field, text } of textFields(item)) {
        for (const name of allNames) {
          if (name === item.name || name.length < 4) continue;
          // Coercive compound phrases only — a lone "before"/"should" is normal "see also" cross-referencing
          // (e.g. "call get_invoice_detail before this" in a legitimate description) and would false-positive
          // on ordinary, helpful documentation. "must always call X" / "X must never" is not ordinary phrasing.
          const kw = '(?:must\\s+always|must\\s+never|always\\s+call|never\\s+call|must\\s+call|required\\s+to\\s+call)';
          const re = new RegExp(`(?:\\b${kw}\\b.{0,60}\\b${escapeRegExp(name)}\\b|\\b${escapeRegExp(name)}\\b.{0,60}\\b${kw}\\b)`, 'i');
          if (re.test(text)) {
            findings.push({
              ruleId: this.id,
              severity: this.defaultSeverity,
              serverId: item.serverId,
              subject: { kind: item.kind, name: item.name },
              message: `${field} gives instructions referencing another tool, "${name}".`
            });
          }
        }
      }
    }
    return findings;
  }
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BASE64_RE = /(?:[A-Za-z0-9+/]{4}){20,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const SUSPICIOUS_TLD_OR_HOST = /(?:\b\d{1,3}(?:\.\d{1,3}){3}\b|\.(?:xyz|top|zip|click|gq|tk)\b|bit\.ly|tinyurl\.com)/i;

export const encodedBlobOrSuspiciousUrl: Rule = {
  id: 'safety/encoded-blob',
  category: 'safety',
  defaultSeverity: 'warning',
  summary: 'Text contains a long opaque base64-looking blob, or a URL with a raw IP, shortener, or unusual TLD.',
  rationale:
    'Long opaque blobs in a description are not documentation for a human or a model; they are either dead ' +
    'weight or a payload. Raw-IP and link-shortener URLs in tool metadata are a common exfiltration or ' +
    'second-stage-payload pattern and deserve a manual look before the server is trusted.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const item of allItems(ctx)) {
      for (const { field, text } of textFields(item)) {
        const blobMatch = text.match(BASE64_RE);
        if (blobMatch && blobMatch[0].length >= 80) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: item.serverId,
            subject: { kind: item.kind, name: item.name },
            message: `${field} contains an opaque ${blobMatch[0].length}-character base64-like blob.`,
            detail: `${blobMatch[0].slice(0, 60)}...`
          });
        }
        for (const url of text.match(URL_RE) ?? []) {
          if (SUSPICIOUS_TLD_OR_HOST.test(url)) {
            findings.push({
              ruleId: this.id,
              severity: this.defaultSeverity,
              serverId: item.serverId,
              subject: { kind: item.kind, name: item.name },
              message: `${field} links to a suspicious URL: ${url}`
            });
          }
        }
      }
    }
    return findings;
  }
};

// Leading \b only (no trailing \b): matches "delete", "deletes", "deleting", "deleted", etc.,
// and still matches at the start of a snake_case name like "delete_customer" (the transition into
// "_" is not a \w/\W boundary, so a trailing \b would miss it).
const DESTRUCTIVE_WORDS = /\b(delete|remove|destroy|drop|purge|wipe|eras|terminat|kill|uninstall|format|truncat|revok)/i;

export const missingDestructiveAnnotation: Rule = {
  id: 'safety/missing-annotations',
  category: 'safety',
  defaultSeverity: 'warning',
  summary: 'Tool name/description sounds destructive but declares no `destructiveHint`/`readOnlyHint` annotation.',
  rationale:
    'The MCP spec\'s tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint — ' +
    'https://modelcontextprotocol.io/specification/2026-07-28/server/tools) exist so a client can gate ' +
    'confirmation prompts on tool behavior. A tool that sounds destructive but declares neither hint gives the ' +
    'client nothing to gate on, defaulting (per spec) to readOnlyHint: false, destructiveHint: true — which is ' +
    'the safe default only if the client actually enforces it.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      const soundsDestructive = DESTRUCTIVE_WORDS.test(t.name) || (t.description ? DESTRUCTIVE_WORDS.test(t.description) : false);
      if (!soundsDestructive) continue;
      const a = t.annotations;
      if (!a || (a.destructiveHint === undefined && a.readOnlyHint === undefined)) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: 'Name or description suggests a destructive action, but annotations.destructiveHint and annotations.readOnlyHint are both unset.'
        });
      }
    }
    return findings;
  }
};

export const rules: Rule[] = [
  hiddenUnicode,
  promptInjection,
  secretAccess,
  crossToolReference,
  encodedBlobOrSuspiciousUrl,
  missingDestructiveAnnotation
];
