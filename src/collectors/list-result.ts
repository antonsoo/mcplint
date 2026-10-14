/** Legacy results omit the discriminator. An explicit non-complete result
 * cannot establish discovery coverage, even if it also carries usable items.
 * Never echo opaque request state, input requests or arbitrary discriminator
 * values; this collector only reads metadata and does not resolve elicitation.
 */
export function listResultIssue(result: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(result, 'resultType') || result.resultType === 'complete') return undefined;
  if (result.resultType === 'input_required') {
    return 'Discovery response is marked input_required, which is not permitted for list requests. List completion is unverified.';
  }
  return 'Discovery response has an unsupported or malformed resultType. List completion is unverified.';
}
