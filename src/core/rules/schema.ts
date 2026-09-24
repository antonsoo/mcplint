import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Finding, Rule, RuleContext } from '../types.js';
import { asSchema, isPlainObject, schemaProperties } from '../schema-utils.js';

// logger: false — Ajv warns to the console (not into any Finding) for things like an unrecognized
// `format` keyword (e.g. real-world schemas commonly declare `format: "uri"`, which Ajv's core
// doesn't validate without the separate ajv-formats package). That's not a finding mcplint reports,
// so it shouldn't print raw noise into a user's terminal on every run against a server that uses it.
const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });

export const validSchema: Rule = {
  id: 'schema/invalid',
  category: 'schema',
  defaultSeverity: 'error',
  summary: 'inputSchema is missing, not an object, not `type: "object"`, or fails JSON Schema compilation.',
  rationale:
    'The MCP spec requires inputSchema to be "a valid JSON Schema object (not null)" with a `type: "object"` root ' +
    '(https://modelcontextprotocol.io/specification/2026-07-28/server/tools#data-types). A tool whose schema does ' +
    'not compile cannot be validated by the client or the server, and most clients will simply drop the tool.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const t of ctx.target.tools) {
      const raw = t.inputSchema;
      if (raw === null || raw === undefined) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: 'inputSchema is missing or null.'
        });
        continue;
      }
      if (!isPlainObject(raw)) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: `inputSchema must be an object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`
        });
        continue;
      }
      const schema = asSchema(raw);
      if (schema?.type !== 'object') {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: `inputSchema.type must be "object", got ${JSON.stringify(schema?.type)}.`
        });
        continue;
      }
      try {
        // Compile against the 2020-12 meta-schema regardless of what draft the tool's own `$schema`
        // names (draft-07 is common in the wild, e.g. the reference "everything" server). Ajv would
        // otherwise fail to *resolve* an unregistered draft-07/06/04 meta-schema and report the whole
        // schema as invalid, when the actual keywords in use are perfectly valid, portable JSON Schema.
        // This rule checks structural well-formedness, not strict draft conformance.
        const withoutSchemaKeyword = { ...raw };
        delete withoutSchemaKeyword.$schema;
        ajv.compile(withoutSchemaKeyword);
      } catch (err) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: `inputSchema does not compile as JSON Schema: ${(err as Error).message}`
        });
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
    for (const t of ctx.target.tools) {
      const schema = asSchema(t.inputSchema);
      if (!schema) continue;

      const props = schemaProperties(schema);
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const hasOptional = props.some(([name]) => !required.has(name));
      if (hasOptional && props.length > 0 && schema.additionalProperties !== false) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message:
            'Has optional (non-required) properties and does not set `additionalProperties: false`. OpenAI ' +
            'Structured Outputs / strict function calling requires every property to be listed in `required` and ' +
            '`additionalProperties: false`; a schema that relies on truly-optional fields will need translation ' +
            'before it can be used there. (https://platform.openai.com/docs/guides/structured-outputs)'
        });
      }

      const externalRefs = collectRefs(schema).filter((ref) => !ref.startsWith('#'));
      if (externalRefs.length > 0) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          serverId: t.serverId,
          subject: { kind: 'tool', name: t.name },
          message: `References external $ref(s) (${externalRefs.join(', ')}); some clients only resolve local ` +
            '(#/...) pointers, so an external ref may silently fail to resolve.'
        });
      }
    }
    return findings;
  }
};

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out);
  } else if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') out.push(value);
      else collectRefs(value, out);
    }
  }
  return out;
}

export const rules: Rule[] = [validSchema, portability];
