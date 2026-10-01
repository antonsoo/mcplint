import type { LintResult, Severity } from '../core/types.js';
import { allRules } from '../core/rules/index.js';
import { ruleSlug } from '../core/rule-slug.js';
import { VERSION } from '../version.js';

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = { error: 'error', warning: 'warning', info: 'note' };

/** SARIF 2.1.0 (https://docs.oasis-open.org/sarif/sarif/v2.1.0/) log, one run. */
export function renderSarif(result: LintResult): string {
  const rulesUsed = new Set(result.findings.map((f) => f.ruleId));
  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'mcplint',
            informationUri: 'https://github.com/antonsoo/mcplint',
            version: VERSION,
            rules: allRules
              .filter((r) => rulesUsed.has(r.id))
              .map((r) => ({
                id: r.id,
                shortDescription: { text: r.summary },
                fullDescription: { text: r.rationale },
                helpUri: `https://github.com/antonsoo/mcplint/blob/main/docs/rules/${ruleSlug(r.id)}.md`,
                properties: { category: r.category }
              }))
          }
        },
        results: result.findings.map((f) => ({
          ruleId: f.ruleId,
          level: LEVEL[f.severity],
          message: { text: f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: `mcp://${uriPart(f.serverId)}/${f.subject.kind}/${uriPart(f.subject.name)}`
                }
              }
            }
          ]
        }))
      }
    ]
  };
  return JSON.stringify(sarif, null, 2);
}

/**
 * `encodeURIComponent` throws on a lone surrogate, and a name is whatever the server sent
 * (`"\ud83d"` is valid JSON). The unpaired half becomes U+FFFD first.
 */
function uriPart(text: string): string {
  return encodeURIComponent(text.replace(LONE_SURROGATE_RE, '\uFFFD'));
}

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

