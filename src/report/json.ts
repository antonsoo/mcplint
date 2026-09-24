import type { LintResult } from '../core/types.js';

export function renderJson(result: LintResult): string {
  return JSON.stringify(
    {
      generatedAt: result.generatedAt,
      tokenizer: result.tokenizerName,
      servers: result.target.servers,
      summary: result.summary,
      findings: result.findings
    },
    null,
    2
  );
}
