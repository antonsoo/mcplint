import type { CollectedItem, Finding, Rule, RuleContext } from '../types.js';
import {
  describeHiddenUnicodeCount,
  findControlCharacters,
  findHiddenUnicode,
  type HiddenUnicodeFinding,
  type HiddenUnicodeKind
} from '../unicode.js';
import { scanSchemaStrings } from '../schema-utils.js';

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
  out.push({ field: 'name', text: item.name });
  if (item.description) out.push({ field: 'description', text: item.description });
  if (item.title) out.push({ field: 'title', text: item.title });
  if (item.kind === 'tool') {
    if (typeof item.annotations?.title === 'string' && item.annotations.title) out.push({ field: 'annotations.title', text: item.annotations.title });
    out.push(...scanSchemaStrings(item.inputSchema, 'inputSchema').fields);
    out.push(...scanSchemaStrings(item.outputSchema, 'outputSchema').fields);
  }
  if (item.kind === 'prompt' && item.arguments) {
    for (const arg of item.arguments) {
      out.push({ field: `arguments.${arg.name} (name)`, text: arg.name });
      if (arg.description) out.push({ field: `arguments.${arg.name}.description`, text: arg.description });
    }
  }
  if (item.kind === 'resource') {
    for (const field of ['uri', 'uriTemplate', 'mimeType'] as const) {
      if (item[field]) out.push({ field, text: item[field] });
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
      if (!hit.benign && hit.decoded) extra.push({ field: `${field}${DECODED_FIELD}`, text: hit.decoded });
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
      const fields = textFields(item);
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

function matching<L extends string>(regex: RegExp, label: L): Finder & { label: L } {
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

/**
 * What a known attack technique looks like in text. Each is weak evidence alone: on the 11,545
 * tool definitions of 418 servers of one public registry (studies/registry-census) a tool that scans
 * for prompt injection names these phrases, a link shortener tells the model not to show a
 * signed URL, and nothing was an attack. An attack needs several of them at once, so one
 * signal is a warning and two on the same tool, prompt or resource are an error.
 */
type Signal =
  | 'instruction override'
  | 'concealment from the user'
  | '<IMPORTANT> block'
  | 'exfiltration instruction'
  | 'credential store'
  | 'instructions about another server\'s tool'
  | 'hidden text';

const INJECTION_PATTERNS: (Finder & { label: Signal })[] = [
  matching(/ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+instructions?/i, 'instruction override'),
  matching(/disregard\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions?/i, 'instruction override'),
  // Verb first: "override your system prompt" is an instruction, "detects system prompt override" is a noun.
  matching(/\b(?:override|ignore|replace|disregard|bypass|forget)\b.{0,30}\b(?:system\s+prompt|system\s+instructions|developer\s+message)\b/i, 'instruction override'),
  matching(/do\s+not\s+tell\s+(the\s+)?user/i, 'concealment from the user'),
  matching(/without\s+(telling|informing|notifying)\s+the\s+user/i, 'concealment from the user'),
  matching(/don'?t\s+(let|allow)\s+the\s+user\s+(know|see)/i, 'concealment from the user'),
  matching(/\b(?:do\s+not|don'?t|never)\s+(?:mention|reveal|disclose)\b[^.]{0,60}\bto\s+the\s+user\b/i, 'concealment from the user'),
  matching(/\b(?:do\s+not|don'?t|never)\s+(?:mention|reveal|disclose|tell\s+(?:the\s+)?user)\s+that\s+you\b/i, 'concealment from the user'),
  { label: '<IMPORTANT> block', find: importantBlock }
];

/**
 * Telling the model which tool to call first is how well-documented servers describe a
 * workflow ("You MUST call resolve-library-id before query-docs"). It is reported as a note,
 * and does not count as an attack signal.
 */
const ORDERING_PATTERNS: Finder[] = [
  matching(/you\s+must\s+always\s+call\s+this\s+tool\s+first/i, 'forced tool ordering'),
  matching(/this\s+is\s+(a\s+)?(mandatory|required)\s+(first\s+)?step/i, 'forced tool ordering')
];

/** Places credentials live. A description that names one is unusual; alone it is not an instruction. */
const CREDENTIAL_STORES: Pattern[] = [
  { regex: /~\/\.ssh\b/i, label: '~/.ssh' },
  { regex: /\.ssh\/id_[a-z0-9]+/i, label: 'SSH private key' },
  { regex: /~\/\.aws\/credentials/i, label: 'AWS credentials file' },
  { regex: /\/etc\/(passwd|shadow)\b/i, label: '/etc/passwd or /etc/shadow' },
  { regex: /(?:~|\$HOME)\/\.(?:netrc|npmrc|pgpass|git-credentials)\b/i, label: 'credentials dotfile' },
  { regex: /(?:~|\$HOME)\/\.(?:kube\/config|docker\/config\.json|config\/gh\/hosts\.yml)\b/i, label: 'cluster/registry/GitHub credentials' },
  { regex: /application_default_credentials\.json/i, label: 'Google Cloud credentials' },
  // A client's configuration, by where clients keep it. A bare "mcp.json" is also what a
  // server calls its own manifest (/.well-known/mcp.json).
  { regex: /(?:\.cursor|\.vscode|\.codeium|\.claude|\.config)[\\/][^\s"'`]*mcp\.json\b|(?<!\w)\.mcp\.json\b|claude_desktop_config\.json/i, label: 'MCP client config (holds other servers\' credentials)' }
];

/**
 * The instruction a poisoned tool gives: get something that must not leave the machine, then
 * put it somewhere the server will receive it. Three parts in order within a short span: a verb
 * of obtaining, a local secret (a credential file, a dotenv file, the system prompt, the
 * conversation), a verb of passing it on. The parts alone are everywhere in honest descriptions
 * ("API key needed", "parses a .env file", "send the request"); the sequence is not.
 */
const OBTAIN = '(?:(?:read|open|cat|load|fetch|retrieve|copy|grab|collect|access)(?:e?s|ing)?|look(?:s|ing)?\\s+(?:at|in|up))';
const LOCAL_SECRET =
  '(?:~\\/\\.ssh|\\.ssh\\/id_[a-z0-9]+|\\bid_(?:rsa|ed25519|ecdsa)\\b|~\\/\\.aws\\/credentials|\\/etc\\/(?:passwd|shadow)' +
  '|(?:~|\\$HOME)\\/\\.(?:netrc|npmrc|pgpass|git-credentials|kube\\/config|docker\\/config\\.json|config\\/gh\\/hosts\\.yml)' +
  '|application_default_credentials\\.json|\\bmcp\\.json\\b|claude_desktop_config\\.json' +
  '|(?<![A-Za-z0-9_])\\.env\\b|\\benv(?:ironment)?\\s+file\\b|\\bsystem\\s+prompt\\b|\\b(?:conversation|chat)\\s+history\\b)';
const PASS_ON =
  '(?:pass|send|include|put|add|append|attach|forward|encode|embed|upload|post|paste|write|insert|place|e?mail|transmit|exfiltrate|share|submit)(?:e?s|ing)?';
const EXFILTRATION_RE = new RegExp(`\\b${OBTAIN}\\b[^\\n]{0,80}?${LOCAL_SECRET}[\\s\\S]{0,200}?\\b${PASS_ON}\\b`, 'i');

const DECODED_FIELD = ' [decoded hidden text]';

/**
 * "Tool shadowing": one server's text telling the model how to use a tool that belongs to
 * another. Seen from a single server, that is coercive wording about a tool the server does
 * not define: "the send_email tool must always...", "must always call send_email". A server
 * instructing the model about its own tools is documentation and is not matched.
 */
const COERCION = '(?:must\\s+always|must\\s+never|always\\s+call|never\\s+call|must\\s+call|required\\s+to\\s+call)';
const TOOL_NAME = '[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+';
const COERCION_RE = new RegExp(`\\b${COERCION}\\b`, 'i');
const NAMED_TOOL_RE = new RegExp(
  `\\bthe\\s+\`?(${TOOL_NAME})\`?\\s+tool\\b|\\btool\\s+\`?(${TOOL_NAME})\`?|\\b${COERCION}\\s+\`?(${TOOL_NAME})\`?`,
  'gi'
);

/** The tools each server defines, for telling a server's own tools from someone else's. */
function toolsByServer(ctx: RuleContext): Map<string, Set<string>> {
  const owned = new Map<string, Set<string>>();
  for (const tool of ctx.target.tools) owned.set(tool.serverId, (owned.get(tool.serverId) ?? new Set()).add(tool.name));
  return owned;
}

function foreignToolInstruction(text: string, own: Set<string>): string | undefined {
  for (const match of text.matchAll(NAMED_TOOL_RE)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name === undefined || own.has(name)) continue;
    const around = text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80);
    if (COERCION_RE.test(around)) return name;
  }
  return undefined;
}

/** Every attack signal present anywhere in one item's text, hidden text included. */
function attackSignals(item: ScannedItem, own: Set<string>): Set<Signal> {
  const signals = new Set<Signal>();
  for (const { field, text } of textFieldsWithDecoded(item)) {
    if (field.endsWith(DECODED_FIELD)) signals.add('hidden text');
    for (const pattern of INJECTION_PATTERNS) if (pattern.find(text) !== undefined) signals.add(pattern.label);
    if (EXFILTRATION_RE.test(text)) signals.add('exfiltration instruction');
    if (CREDENTIAL_STORES.some((store) => store.regex.test(text))) signals.add('credential store');
    if (foreignToolInstruction(text, own) !== undefined) signals.add('instructions about another server\'s tool');
  }
  return signals;
}

/** "Together with X and Y on the same tool" for a finding raised to an error by its company. */
function corroboration(signals: Set<Signal>, own: Signal, kind: string): string {
  const others = [...signals].filter((signal) => signal !== own);
  if (others.length === 0) return '';
  return ` Together with ${others.join(' and ')} on the same ${kind}, this is the shape of a tool-poisoning attack.`;
}

export const promptInjection: Rule = {
  id: 'safety/prompt-injection',
  category: 'safety',
  defaultSeverity: 'warning',
  summary:
    'Text contains a known prompt-injection pattern (instruction override, concealment, an <IMPORTANT> block). ' +
    'A warning alone; an error beside a second attack signal on the same item or inside hidden text.',
  rationale:
    'A tool/prompt/resource description is part of the model\'s context on every turn. Phrases that try to ' +
    'override the system prompt or hide actions from the user are the patterns used in documented ' +
    'prompt-injection and tool-poisoning attacks against MCP servers. One of them alone also occurs in honest ' +
    'descriptions, so it takes two signals on one item to be reported as an error.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const owned = toolsByServer(ctx);
    for (const item of allItems(ctx)) {
      const signals = attackSignals(item, owned.get(item.serverId) ?? new Set());
      for (const { field, text } of textFieldsWithDecoded(item)) {
        const reported = new Set<string>();
        const report = (label: string, matched: string, severity: Finding['severity'], note: string): void => {
          // Two phrasings of the same technique in one field are one finding.
          if (reported.has(label)) return;
          reported.add(label);
          findings.push({
            ruleId: this.id,
            severity,
            serverId: item.serverId,
            subject: { kind: item.kind, name: item.name },
            message: `${field} matches the "${label}" pattern: ${JSON.stringify(matched.slice(0, 200))}.${note}`,
            detail: matched.slice(0, 200)
          });
        };
        for (const pattern of INJECTION_PATTERNS) {
          const matched = pattern.find(text);
          if (matched === undefined) continue;
          const escalated = signals.size >= 2;
          report(pattern.label, matched, escalated ? 'error' : 'warning', escalated ? corroboration(signals, pattern.label, item.kind) : '');
        }
        for (const pattern of ORDERING_PATTERNS) {
          const matched = pattern.find(text);
          if (matched !== undefined) report(pattern.label, matched, 'info', '');
        }
      }
    }
    return findings;
  }
};

export const secretAccess: Rule = {
  id: 'safety/secret-access',
  category: 'safety',
  defaultSeverity: 'error',
  summary:
    'Text instructs reading a local secret and passing it on (an error), or names a credential store ' +
    '(a warning alone, an error beside another attack signal).',
  rationale:
    'A legitimate tool has no reason to tell the model to read SSH keys, dotenv files, another server\'s ' +
    'configuration or the system prompt and put the contents in a parameter; that is the signature of a tool ' +
    'trying to get an agent to leak secrets. Mentioning an API key or a `.env` file is not: hundreds of honest ' +
    'tools take one as input.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const owned = toolsByServer(ctx);
    for (const item of allItems(ctx)) {
      const signals = attackSignals(item, owned.get(item.serverId) ?? new Set());
      for (const { field, text } of textFieldsWithDecoded(item)) {
        const exfiltration = text.match(EXFILTRATION_RE);
        if (exfiltration) {
          findings.push({
            ruleId: this.id,
            severity: 'error',
            serverId: item.serverId,
            subject: { kind: item.kind, name: item.name },
            message:
              `${field} tells the model to obtain a local secret and pass it on: ` +
              `${JSON.stringify(exfiltration[0].slice(0, 200))}.${corroboration(signals, 'exfiltration instruction', item.kind)}`,
            detail: exfiltration[0].slice(0, 200)
          });
          // The instruction already names what it reads.
          continue;
        }
        for (const pattern of CREDENTIAL_STORES) {
          const match = text.match(pattern.regex);
          if (!match) continue;
          const escalated = signals.size >= 2;
          findings.push({
            ruleId: this.id,
            severity: escalated ? 'error' : 'warning',
            serverId: item.serverId,
            subject: { kind: item.kind, name: item.name },
            message:
              `${field} references ${pattern.label}: ${JSON.stringify(match[0].slice(0, 200))}.` +
              (escalated ? corroboration(signals, 'credential store', item.kind) : ''),
            detail: match[0].slice(0, 200)
          });
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
  summary:
    'Text gives instructions about a tool that belongs to a different server (a warning alone, an error beside ' +
    'another attack signal).',
  rationale:
    'Text that tells the model how to call a tool of *another server* is a documented tool-poisoning vector ' +
    '("tool shadowing"): it lets one server silently rewrite how the model uses a different, possibly trusted, ' +
    'one. With several servers linted together (`mcplint config`) the other server is known by name; for one ' +
    'server alone, coercive wording about a tool it does not define is reported. Instructions about a ' +
    'server\'s own tools are ordinary documentation ("call resolve-library-id before query-docs") and are not.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const owned = toolsByServer(ctx);
    const serversOf = new Map<string, Set<string>>();
    for (const tool of ctx.target.tools) {
      serversOf.set(tool.name, (serversOf.get(tool.name) ?? new Set()).add(tool.serverId));
    }
    for (const item of allItems(ctx)) {
      const own = owned.get(item.serverId) ?? new Set<string>();
      const signals = attackSignals(item, own);
      for (const { field, text } of textFields(item)) {
        const name = foreignToolInstruction(text, own);
        if (name === undefined) continue;
        const owners = serversOf.get(name);
        const whose = owners ? `a tool of another server (${[...owners].join(', ')})` : 'a tool this server does not define';
        const escalated = signals.size >= 2;
        findings.push({
          ruleId: this.id,
          severity: escalated ? 'error' : 'warning',
          serverId: item.serverId,
          subject: { kind: item.kind, name: item.name },
          message:
            `${field} gives instructions about "${name}", ${whose}.` +
            (escalated ? corroboration(signals, 'instructions about another server\'s tool', item.kind) : '')
        });
      }
    }
    return findings;
  }
};

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
        // A `$ref` is a path of schema keywords joined by slashes, which is base64's alphabet.
        const blobMatch = /\$(?:ref|id|schema|anchor)$/.test(field) ? null : text.match(BASE64_RE);
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

/**
 * Verbs that name a destructive action. Looked for in the tool's name, split into words: in
 * descriptions they are mostly something else ("returns formatted text", "removes markdown from
 * the input"), and on the registry census that reading flagged `strip_markdown` and `convert_to_md`.
 */
const DESTRUCTIVE_VERB = /^(?:delete|remove|destroy|drop|purge|wipe|erase|terminate|kill|uninstall|truncate|revoke)[ds]?$/i;

function nameWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
}

export const missingDestructiveAnnotation: Rule = {
  id: 'safety/missing-annotations',
  category: 'safety',
  defaultSeverity: 'warning',
  summary: 'Tool name contains a destructive verb but the tool declares no `destructiveHint`/`readOnlyHint` annotation.',
  rationale:
    'The MCP spec\'s tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint — ' +
    'https://modelcontextprotocol.io/specification/2026-07-28/server/tools) exist so a client can gate ' +
    'confirmation prompts on tool behavior. A tool that sounds destructive but declares neither hint gives the ' +
    'client nothing to gate on, defaulting (per spec) to readOnlyHint: false, destructiveHint: true — which is ' +
    'the safe default only if the client actually enforces it.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      if (!nameWords(t.name).some((word) => DESTRUCTIVE_VERB.test(word))) continue;
      const a = t.annotations;
      if (!a || (typeof a.destructiveHint !== 'boolean' && typeof a.readOnlyHint !== 'boolean')) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: 'The name says this tool destroys something, but neither annotations.destructiveHint nor annotations.readOnlyHint supplies a boolean value.'
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
  check(ctx): Finding[] {
    const findings: Finding[] = [];
    for (const tool of ctx.target.tools) {
      for (const field of ['inputSchema', 'outputSchema'] as const) {
        const scan = scanSchemaStrings(tool[field], field);
        if (scan.issue) findings.push({ ruleId: UNCHECKED_RULE_ID, severity: 'error', serverId: tool.serverId,
          subject: { kind: 'tool', name: tool.name }, message: `${field}: ${scan.issue}`,
          suggestion: 'Reduce the schema size or nesting and rerun. Retained text and other tools were still checked.' });
      }
    }
    return findings;
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
