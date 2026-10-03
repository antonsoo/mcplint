import type { CollectedItem, Finding, Rule, RuleContext } from '../types.js';
import {
  describeHiddenUnicodeCount,
  findControlCharacters,
  findHiddenUnicode,
  type HiddenUnicodeFinding,
  type HiddenUnicodeKind
} from '../unicode.js';
import { schemaStrings } from '../schema-utils.js';

/** Server `instructions` go into the model's context too, so the text-matching rules read them as a subject of their own. */
interface InstructionsItem {
  kind: 'server';
  name: string;
  description: string;
  title?: undefined;
  serverId: string;
}

type ScannedItem = CollectedItem | InstructionsItem;

function textFields(item: ScannedItem): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  if (item.kind === 'server') return [{ field: 'instructions', text: item.description }];
  if (item.description) out.push({ field: 'description', text: item.description });
  if (item.title) out.push({ field: 'title', text: item.title });
  if (item.kind === 'tool') {
    if (typeof item.annotations?.title === 'string' && item.annotations.title) out.push({ field: 'annotations.title', text: item.annotations.title });
    out.push(...schemaStrings(item.inputSchema, 'inputSchema'));
    out.push(...schemaStrings(item.outputSchema, 'outputSchema'));
  }
  if (item.kind === 'prompt' && item.arguments) {
    for (const arg of item.arguments) {
      if (arg.description) out.push({ field: `arguments.${arg.name}.description`, text: arg.description });
    }
  }
  return out;
}

function allItems(ctx: RuleContext): ScannedItem[] {
  const instructions: InstructionsItem[] = ctx.target.servers
    .filter((s): s is typeof s & { instructions: string } => typeof s.instructions === 'string' && s.instructions.length > 0)
    .map((s) => ({ kind: 'server', name: s.id, description: s.instructions, serverId: s.id }));
  return [...ctx.target.tools, ...ctx.target.prompts, ...ctx.target.resources, ...instructions];
}

/**
 * `textFields` plus one synthetic field per decoded hidden-Unicode payload.
 * A payload smuggled via tag characters or variation selectors is plain
 * ASCII once decoded, and it deserves the same pattern scanning as visible
 * text — that is usually where the actual instruction lives.
 */
function textFieldsWithDecoded(item: ScannedItem): { field: string; text: string }[] {
  const out = textFields(item);
  const extra: { field: string; text: string }[] = [];
  for (const { field, text } of out) {
    for (const hit of findHiddenUnicode(text)) {
      if (!hit.benign && hit.decoded) extra.push({ field: `${field} [decoded hidden text]`, text: hit.decoded });
    }
  }
  return [...out, ...extra];
}

interface HiddenUnicodeGroup {
  kind: HiddenUnicodeKind;
  count: number;
  decoded?: string;
  /** The code points involved, most of them at least. */
  detail: string;
}

/** How many separate payload runs of one kind are reported for a field before the rest are summed up. */
const MAX_RUNS_PER_FIELD = 10;

/**
 * One finding per field for each family of single hidden characters, however many there are:
 * a description padded with 40,000 zero-width spaces is one problem, not 40,000 findings in a
 * report nobody can open. Runs that carry a payload (tag characters, variation selectors) stay
 * separate, since each decodes to its own text, up to a limit past which they are counted.
 */
function groupHiddenUnicode(hits: HiddenUnicodeFinding[]): HiddenUnicodeGroup[] {
  const groups: HiddenUnicodeGroup[] = [];
  const singles = new Map<HiddenUnicodeKind, { group: HiddenUnicodeGroup; seen: Map<string, number> }>();
  const runs = new Map<HiddenUnicodeKind, { shown: number; rest: HiddenUnicodeGroup | undefined }>();

  for (const hit of hits) {
    if (hit.benign) continue;
    if (hit.kind === 'tag-characters' || hit.kind === 'variation-selectors') {
      const state = runs.get(hit.kind) ?? { shown: 0, rest: undefined };
      runs.set(hit.kind, state);
      if (state.shown < MAX_RUNS_PER_FIELD) {
        state.shown += 1;
        const detail = hit.codepoints.slice(0, 12).join(' ') + (hit.codepoints.length > 12 ? ' ...' : '');
        groups.push({ kind: hit.kind, count: hit.count, ...(hit.decoded ? { decoded: hit.decoded } : {}), detail });
      } else if (state.rest) {
        state.rest.count += hit.count;
      } else {
        state.rest = { kind: hit.kind, count: hit.count, detail: `in further runs, beyond the first ${MAX_RUNS_PER_FIELD} reported` };
        groups.push(state.rest);
      }
      continue;
    }
    let entry = singles.get(hit.kind);
    if (!entry) {
      entry = { group: { kind: hit.kind, count: 0, detail: '' }, seen: new Map() };
      singles.set(hit.kind, entry);
      groups.push(entry.group);
    }
    entry.group.count += hit.count;
    for (const cp of hit.codepoints) entry.seen.set(cp, (entry.seen.get(cp) ?? 0) + 1);
  }

  for (const { group, seen } of singles.values()) {
    const parts = [...seen].map(([cp, n]) => (n > 1 ? `${cp} ×${n}` : cp));
    group.detail = parts.slice(0, 12).join(' ') + (parts.length > 12 ? ' ...' : '');
  }
  return groups;
}

export const hiddenUnicode: Rule = {
  id: 'safety/hidden-unicode',
  category: 'safety',
  defaultSeverity: 'error',
  summary: 'Text contains zero-width, invisible, bidi-control, Unicode Tag, or variation-selector characters.',
  rationale:
    'These characters render invisibly or near-invisibly in most UIs but are tokenized and read by the model like ' +
    'any other character, so they can carry an instruction a human reviewer never sees. See ' +
    'docs/rules/safety-hidden-unicode.md for the specific techniques detected.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const item of allItems(ctx)) {
      for (const { field, text } of textFields(item)) {
        for (const hit of groupHiddenUnicode(findHiddenUnicode(text))) {
          const decodedPart = hit.decoded ? ` Decodes to: ${JSON.stringify(hit.decoded)}.` : '';
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: item.serverId,
            subject: { kind: item.kind, name: item.name },
            message: `${field}: ${describeHiddenUnicodeCount(hit.kind, hit.count)} found.${decodedPart}`,
            detail: hit.detail
          });
        }
      }
    }
    return findings;
  }
};

export const controlCharacters: Rule = {
  id: 'safety/control-characters',
  category: 'safety',
  defaultSeverity: 'error',
  summary: 'A name or text contains control characters, such as the ESC that starts a terminal escape sequence.',
  rationale:
    'Control characters have no place in tool metadata, and an escape sequence is an instruction to whatever ' +
    'terminal shows the text: it can clear the screen, move the cursor back over what was shown, hide text, ' +
    'retitle the window or write to the clipboard, so a person reviewing a tool list in a terminal sees ' +
    'something other than what the model reads. See docs/rules/safety-control-characters.md.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const item of allItems(ctx)) {
      const fields = item.kind === 'server' ? textFields(item) : [{ field: 'name', text: item.name }, ...textFields(item)];
      for (const { field, text } of fields) {
        const hit = findControlCharacters(text);
        if (!hit) continue;
        const noun = hit.count === 1 ? 'control character' : 'control characters';
        const sequences = hit.sequences.length
          ? `, including terminal escape sequences: ${hit.sequences.map((s) => `"${s}"`).join(', ')}`
          : '';
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: item.serverId,
          subject: { kind: item.kind, name: item.name },
          message: `${field}: ${hit.count} ${noun}${sequences}.`,
          detail: hit.codepoints.slice(0, 12).join(' ') + (hit.codepoints.length > 12 ? ' ...' : '')
        });
      }
    }
    return findings;
  }
};

interface Pattern {
  regex: RegExp;
  label: string;
}

/** A named technique and how to find it in a text: the matched passage, or undefined. */
interface Finder {
  label: string;
  find(text: string): string | undefined;
}

function matching(regex: RegExp, label: string): Finder {
  return { label, find: (text) => text.match(regex)?.[0] };
}

/**
 * The first `<important>...</important>` block in `text`, in any letter case. Found as an
 * opening tag and then the next closing tag: the lazy pattern `<important>[\s\S]*?</important>` rescans to the end of the text
 * from every opening tag that has no closing one, which is quadratic in a description built
 * to be slow.
 */
function importantBlock(text: string): string | undefined {
  const open = IMPORTANT_OPEN_RE.exec(text);
  if (open === null) return undefined;
  IMPORTANT_CLOSE_RE.lastIndex = open.index + open[0].length;
  const close = IMPORTANT_CLOSE_RE.exec(text);
  return close === null ? undefined : text.slice(open.index, close.index + close[0].length);
}

const IMPORTANT_OPEN_RE = /<important>/i;
const IMPORTANT_CLOSE_RE = /<\/important>/gi;

const INJECTION_PATTERNS: Finder[] = [
  matching(/ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+instructions?/i, 'instruction override'),
  matching(/disregard\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions?/i, 'instruction override'),
  matching(/do\s+not\s+tell\s+(the\s+)?user/i, 'concealment from the user'),
  matching(/without\s+(telling|informing|notifying)\s+the\s+user/i, 'concealment from the user'),
  matching(/don'?t\s+(let|allow)\s+the\s+user\s+(know|see)/i, 'concealment from the user'),
  matching(/\b(?:do\s+not|don'?t|never)\s+(?:mention|reveal|disclose)\b[^.]{0,60}\bto\s+the\s+user\b/i, 'concealment from the user'),
  matching(/\b(?:do\s+not|don'?t|never)\s+(?:mention|reveal|disclose|tell\s+(?:the\s+)?user)\s+that\s+you\b/i, 'concealment from the user'),
  { label: '<IMPORTANT> block', find: importantBlock },
  matching(/\bsystem\s+prompt\b.{0,40}\b(override|ignore|replace)/i, 'system prompt override'),
  matching(/you\s+must\s+always\s+call\s+this\s+tool\s+first/i, 'forced tool ordering'),
  matching(/this\s+is\s+(a\s+)?(mandatory|required)\s+(first\s+)?step/i, 'forced tool ordering')
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
        const reported = new Set<string>();
        const report = (label: string, matched: string): void => {
          // Two phrasings of the same technique in one field are one finding.
          if (reported.has(label)) return;
          reported.add(label);
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: item.serverId,
            subject: { kind: item.kind, name: item.name },
            message: `${field} matches the "${label}" pattern: ${JSON.stringify(matched.slice(0, 200))}`,
            detail: matched.slice(0, 200)
          });
        };
        for (const pattern of INJECTION_PATTERNS) {
          const matched = pattern.find(text);
          if (matched !== undefined) report(pattern.label, matched);
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
  { regex: /(?:~|\$HOME)\/\.(?:netrc|npmrc|pgpass|git-credentials)\b/i, label: 'credentials dotfile' },
  { regex: /(?:~|\$HOME)\/\.(?:kube\/config|docker\/config\.json|config\/gh\/hosts\.yml)\b/i, label: 'cluster/registry/GitHub credentials' },
  { regex: /application_default_credentials\.json/i, label: 'Google Cloud credentials' },
  { regex: /\bmcp\.json\b|claude_desktop_config\.json/i, label: 'MCP client config (holds other servers\' credentials)' },
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
// Loopback, unspecified and RFC 1918 addresses are how local services are addressed
// (a default of http://127.0.0.1:11434 is configuration, not exfiltration).
const LOCAL_IP_HOST = /^https?:\/\/(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?(?:[/?#]|$)/i;

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
        for (const match of text.match(URL_RE) ?? []) {
          // Sentence punctuation right after a URL isn't part of it.
          const url = match.replace(/[.,;:!?)\]]+$/, '');
          if (SUSPICIOUS_TLD_OR_HOST.test(url) && !LOCAL_IP_HOST.test(url)) {
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

/**
 * Not a check of its own: `lint()` reports this when another rule throws. A rule crashing must
 * not hide the other rules' findings, and must not read as "nothing found" either.
 */
export const UNCHECKED_RULE_ID = 'safety/unchecked';

export const unchecked: Rule = {
  id: UNCHECKED_RULE_ID,
  category: 'safety',
  defaultSeverity: 'error',
  summary: 'A rule could not run on this server\'s metadata, so that check was not made.',
  rationale:
    'Metadata malformed in a way a rule did not anticipate can make that rule fail. A linter that stops there, or ' +
    'carries on as if the rule had passed, can be evaded by adding one malformed field next to a poisoned ' +
    'description. The unfinished check is reported as an error instead: the server is unverified, not clean.',
  check(): Finding[] {
    return [];
  }
};

export const rules: Rule[] = [
  hiddenUnicode,
  controlCharacters,
  promptInjection,
  secretAccess,
  crossToolReference,
  encodedBlobOrSuspiciousUrl,
  missingDestructiveAnnotation,
  unchecked
];
