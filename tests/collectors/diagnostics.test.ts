import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { connectionFailureMessage } from '../../src/collectors/diagnostics.js';
import { ConnectionTimeoutError } from '../../src/collectors/connect.js';

describe('connection diagnostics', () => {
  it('keeps useful HTTP, MCP, and local timeout information without arbitrary messages', () => {
    expect(connectionFailureMessage(new StreamableHTTPError(503, 'PRIVATE_RESPONSE'))).toContain('HTTP 503');
    expect(connectionFailureMessage(new McpError(-32000, 'PRIVATE_RESPONSE'))).toContain('MCP error -32000');
    expect(connectionFailureMessage(new ConnectionTimeoutError(300))).toContain('300 ms');
  });

  it('uses only an allowlisted system code, including a fetch cause', () => {
    const cause = Object.assign(new Error('PRIVATE_CAUSE'), { code: 'ECONNREFUSED' });
    const error = new Error('PRIVATE_MESSAGE', { cause });
    expect(connectionFailureMessage(error)).toContain('ECONNREFUSED');
    expect(connectionFailureMessage(error)).not.toContain('PRIVATE');
  });

  it.each([
    new Error('PRIVATE_MESSAGE'),
    Object.assign(new Error('PRIVATE_MESSAGE'), { code: 'PRIVATE_CODE' }),
    new StreamableHTTPError(9000, 'PRIVATE_RESPONSE'),
    new McpError(NaN, 'PRIVATE_RESPONSE'),
    'PRIVATE_THROWN_STRING'
  ])('does not echo unsupported error shapes', error => {
    expect(connectionFailureMessage(error)).not.toContain('PRIVATE');
    expect(connectionFailureMessage(error)).toContain('Check the command');
  });
});
