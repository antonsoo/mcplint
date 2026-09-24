/** `budget/tool-tokens` -> `budget-tool-tokens`, matching `docs/rules/<slug>.md`. */
export function ruleSlug(ruleId: string): string {
  return ruleId.replace('/', '-');
}
