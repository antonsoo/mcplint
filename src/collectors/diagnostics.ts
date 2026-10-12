import { SseError } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ConnectionTimeoutError } from './connect.js';
import { TextDecodingError } from '../core/read-text.js';
import { HttpRedirectError } from './http-redirects.js';

const guidance = 'Check the command, URL, environment and authorization, then retry.';
const systemCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ECONNREFUSED', 'ECONNRESET',
  'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ERR_INVALID_URL']);

/** SDK error messages can embed response bodies, echoed auth headers, URLs, or
 * initialization metadata. Emit only recognized codes and our own wording.
 * Raw errors remain available to library callers for deliberate local inspection.
 */
export function connectionFailureMessage(error: unknown): string {
  if (error instanceof ConnectionTimeoutError || error instanceof TextDecodingError ||
      error instanceof HttpRedirectError) return error.message;
  let code: string | undefined;
  if ((error instanceof StreamableHTTPError || error instanceof SseError) &&
      Number.isInteger(error.code) && error.code! >= 100 && error.code! <= 599) {
    code = `HTTP ${error.code}`;
  } else if (error instanceof McpError && Number.isSafeInteger(error.code)) {
    code = `MCP error ${error.code}`;
  } else {
    // fetch wraps a connection failure in cause. Never print arbitrary error.code,
    // message, stack, or cause text, including strings supplied by a server.
    for (const candidate of [error, error instanceof Error ? error.cause : undefined]) {
      if (candidate !== null && typeof candidate === 'object' && 'code' in candidate &&
          typeof candidate.code === 'string' && systemCodes.has(candidate.code)) {
        code = candidate.code;
        break;
      }
    }
  }
  return `Could not connect or initialize${code ? ` (${code})` : ''}. ${guidance}`;
}
