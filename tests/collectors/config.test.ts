import { describe, expect, it } from 'vitest';
import { parseServerEntries } from '../../src/collectors/config.js';

describe('parseServerEntries', () => {
  it('parses a stdio entry with command/args/env', () => {
    const entries = parseServerEntries({
      mcpServers: { main: { command: 'node', args: ['server.js'], env: { FOO: 'bar' } } }
    });
    expect(entries).toEqual([{ kind: 'stdio', key: 'main', command: 'node', args: ['server.js'], env: { FOO: 'bar' } }]);
  });

  it('parses an http entry with a url and headers', () => {
    const entries = parseServerEntries({
      mcpServers: { remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } } }
    });
    expect(entries).toEqual([
      { kind: 'http', key: 'remote', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } }
    ]);
  });

  it('parses multiple servers and skips malformed entries', () => {
    const entries = parseServerEntries({
      mcpServers: {
        a: { command: 'node', args: [] },
        b: { url: 'https://example.com' },
        c: { nonsense: true }
      }
    });
    expect(entries.map((e) => e.key)).toEqual(['a', 'b']);
  });

  it('throws when there is no mcpServers map', () => {
    expect(() => parseServerEntries({})).toThrow(/mcpServers/);
    expect(() => parseServerEntries(null)).toThrow(/mcpServers/);
  });
});
