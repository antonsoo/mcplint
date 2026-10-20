import type { Finding, Rule, RuleContext } from '../types.js';
import { enumTypeConflicts } from '../schema-enum-types.js';
import { isPlainObject } from '../schema-utils.js';

export const enumTypes: Rule = {
  id: 'schema/enum-type',
  category: 'schema',
  defaultSeverity: 'warning',
  summary: 'Every enum choice is excluded by the declared JSON type at the same schema node.',
  rationale:
    'A schema can compile while no declared choice is usable: strings "true"/"false" are not booleans. ' +
    'Both type and enum apply, without coercion. This finding describes a local subschema; an optional ' +
    'parameter may still be omitted and another union branch may still match.',
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const tool of ctx.target.tools) {
      for (const field of ['inputSchema', 'outputSchema'] as const) {
        const schema = tool[field];
        if (!isPlainObject(schema)) continue;
        for (const conflict of enumTypeConflicts(schema)) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            serverId: tool.serverId,
            subject: { kind: 'tool', name: tool.name },
            message: `${JSON.stringify(field + conflict.pointer)}: none of the ${conflict.choices} enum ` +
              `choices (${conflict.valueTypes.join(', ')}) matches declared ` +
              (conflict.declaredTypes.length === 1 ? `type ${JSON.stringify(conflict.declaredTypes[0])}.`
                : `types ${JSON.stringify(conflict.declaredTypes)}.`),
            detail: 'No value satisfies both type and enum at this schema node. This contradiction can occur ' +
              'in valid JSON Schema, so compilation alone does not detect the unusable choices. The finding does not ' +
              'establish that the whole tool is unusable: optional properties may be omitted and other ' +
              'branches may still match. Negation and if conditions are not inspected as value choices.',
            suggestion: 'Align the enum values and declared type with the intended contract. Do not ' +
              'automatically coerce strings to numbers or booleans; the intended representation is unknown.'
          });
        }
      }
    }
    return findings;
  }
};
