import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

export interface ConnectionOptions {
  /** Per server: transport startup plus the complete MCP handshake, including HTTP fallback. */
  connectTimeoutMs?: number;
}

export class ConnectionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Connection and initialization exceeded ${timeoutMs} ms. Check server startup and availability, or increase --connect-timeout.`);
    this.name = 'ConnectionTimeoutError';
  }
}

export function connectionBudget(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): { deadline: number; timeoutMs: number } {
  // Node turns timers outside this range into 1 ms rather than honoring their value.
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError('connectTimeoutMs must be an integer from 1 to 2147483647 milliseconds.');
  }
  return { deadline: performance.now() + timeoutMs, timeoutMs };
}

/** SDK request timeouts start after transport.start() and end before the initialized
 * notification is sent. Bound all three phases, and share the budget across fallback.
 * The collector must close its client in finally, on timeout as on every other outcome.
 */
export async function connectWithinBudget(
  client: Client, transport: Transport, budget: ReturnType<typeof connectionBudget>
): Promise<void> {
  const remaining = Math.ceil(budget.deadline - performance.now());
  if (remaining <= 0) throw new ConnectionTimeoutError(budget.timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ConnectionTimeoutError(budget.timeoutMs)), remaining);
  });
  try {
    await Promise.race([
      client.connect(transport, { timeout: remaining, maxTotalTimeout: remaining }),
      expired
    ]);
  } finally {
    clearTimeout(timer);
  }
}
