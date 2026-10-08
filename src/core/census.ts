/**
 * What tool definitions cost on real servers, for putting one server's numbers in context.
 *
 * From studies/registry-census: the 418 most-used and verified servers of a public registry
 * that publish their tool definitions, 11,545 tools, estimated with the same tokenizer the
 * budget rules use. Each pair is [percentile, tokens]: half of all tools cost 133 tokens or
 * fewer, nine in ten cost 549 or fewer.
 */
export const TOOL_TOKEN_PERCENTILES: readonly (readonly [number, number])[] = [
  [50, 133],
  [75, 261],
  [90, 549],
  [95, 809],
  [99, 1570]
];

/** The same for a whole server's tool list: the median server costs 2,403 tokens. */
export const SERVER_TOKEN_PERCENTILES: readonly (readonly [number, number])[] = [
  [50, 2403],
  [75, 6340],
  [90, 16336],
  [95, 28556],
  [99, 63126]
];

/** The highest listed percentile that `tokens` exceeds, or null below the median. */
export function percentileExceeded(tokens: number, table: readonly (readonly [number, number])[]): number | null {
  let exceeded: number | null = null;
  for (const [percentile, value] of table) if (tokens > value) exceeded = percentile;
  return exceeded;
}
