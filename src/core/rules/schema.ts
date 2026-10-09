import type { Finding, Rule, RuleContext } from '../types.js';
import { asSchema, isPlainObject, schemaProperties } from '../schema-utils.js';
import { checkSchema, schemaNodes } from '../schema-validation.js';
import { UNCHECKED_RULE_ID } from './safety.js';

export const validSchema: Rule = {
  id: 'schema/invalid',
  category: 'schema',
  defaultSeverity: 'error',
  summary: 'Tool input or output schema is malformed, or inputSchema does not have a `type: "object"` root.',
  rationale:
    'The MCP spec requires inputSchema to be "a valid JSON Schema object (not null)" with a `type: "object"` root ' +
    '(https://modelcontextprotocol.io/specification/2026-07-28/server/tools#data-types). Valid input and output ' +
    'schemas let clients validate arguments and structured results; incomplete checks must remain visible.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      for (const field of ['inputSchema', 'outputSchema'] as const) {
        const raw = t[field];
        if (field === 'outputSchema' && raw === undefined) continue;
        if (raw === null || raw === undefined) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: t.serverId,
            subject: { kind: 'tool', name: t.name },
            message: `${field} is missing or null.`
          });
          continue;
        }
        if (!isPlainObject(raw)) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: t.serverId,
            subject: { kind: 'tool', name: t.name },
            message: `${field} must be an object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`
          });
          continue;
        }
        if (field === 'inputSchema' && raw.type !== 'object') {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: t.serverId,
            subject: { kind: 'tool', name: t.name },
            message: `inputSchema.type must be "object", got ${typeof raw.type === 'string'
              ? JSON.stringify(raw.type.slice(0, 200)) : Array.isArray(raw.type) ? 'an array' : typeof raw.type}.`
          });
          continue;
        }
        const result = checkSchema(raw);
        if (result.status !== 'valid') {
          findings.push({
            ruleId: result.status === 'unchecked' ? UNCHECKED_RULE_ID : this.id,
            severity: this.defaultSeverity,
            serverId: t.serverId,
            subject: { kind: 'tool', name: t.name },
            message: result.status === 'unchecked'
              ? `${field} could not be fully checked: ${result.reason}`
              : `${field} does not compile as JSON Schema: ${result.reason}`
          });
        }
      }
    }
    return findings;
  }
};

export const portability: Rule = {
  id: 'schema/portability',
  category: 'schema',
  defaultSeverity: 'info',
  summary: 'Schema uses a construct that some clients handle inconsistently. Phrased as a suggestion, not an error.',
  rationale:
    'These are not spec violations. They are documented gaps in specific client implementations that make a ' +
    'schema less portable across the ecosystem than one using only the common subset.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    // Nine in ten tools in the registry census have optional properties and no
    // `additionalProperties: false` (studies/registry-census), so this is said once per server
    // with a count. One note per tool was 10,692 notes that all said the same thing.
    const notStrict = new Map<string, string[]>();
    for (const t of ctx.target.tools) {
      const schema = asSchema(t.inputSchema);
      if (!schema) continue;

      const props = schemaProperties(schema);
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const hasOptional = props.some(([name]) => !required.has(name));
      if (hasOptional && props.length > 0 && schema.additionalProperties !== false) {
        notStrict.set(t.serverId, [...(notStrict.get(t.serverId) ?? []), t.name]);
      }

      const externalRefs = collectRefs(schema).filter((ref) => !ref.startsWith('#'));
      if (externalRefs.length > 0) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: `Uses non-fragment $ref(s) (${externalRefs.join(', ')}); resolution may require bundled ` +
            'resource IDs or external schemas, which some clients do not support.'
        });
      }
    }
    for (const [serverId, names] of notStrict) {
      const total = ctx.target.tools.filter((t) => t.serverId === serverId).length;
      const shown = names.slice(0, 5).map((name) => `"${name}"`).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : '');
      findings.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        serverId,
        subject: { kind: 'server', name: serverId },
        message:
          `${names.length} of ${total} tools have optional properties and do not set \`additionalProperties: false\` ` +
          `(${shown}). OpenAI Structured Outputs / strict function calling requires every property to be listed ` +
          'in `required` and `additionalProperties: false`; these schemas need translation before they can be ' +
          'used there. (https://platform.openai.com/docs/guides/structured-outputs)'
      });
    }
    return findings;
  }
};

function collectRefs(schema: Record<string, unknown>): string[] {
  return schemaNodes(schema).nodes.flatMap(node => typeof node.$ref === 'string' ? [node.$ref] : []);
}

export const rules: Rule[] = [validSchema, portability];
