/**
 * What tool definitions cost on real servers, for putting one server's numbers in context.
 *
 * From studies/registry-census: 418 servers of one public registry that publish their tool
 * definitions, 11,545 tools, counted as the budget rules count (name, description and input
 * schema; o200k_base). Each pair is [percentile, tokens]: half of all tools cost 113 tokens or
 * fewer, nine in ten cost 374 or fewer. These servers are the registry's first 500 listed rows
 * and its verified ones, not a sample of all servers.
 */
export const TOOL_TOKEN_PERCENTILES: readonly (readonly [number, number])[] = [
  [50, 113],
  [75, 210],
  [90, 374],
  [95, 548],
  [99, 1050]
];

/** The same for a whole server's tool list: the median server costs 1,700 tokens. */
export const SERVER_TOKEN_PERCENTILES: readonly (readonly [number, number])[] = [
  [50, 1700],
  [75, 4322],
  [90, 11870],
  [95, 21801],
  [99, 49109]
];

/** The highest listed percentile that `tokens` exceeds, or null below the median. */
export function percentileExceeded(tokens: number, table: readonly (readonly [number, number])[]): number | null {
  let exceeded: number | null = null;
  for (const [percentile, value] of table) if (tokens > value) exceeded = percentile;
  return exceeded;
}
