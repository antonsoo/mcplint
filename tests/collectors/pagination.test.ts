import { describe, expect, it, vi } from 'vitest';
import { listAll, MAX_ITEMS, MAX_PAGES } from '../../src/collectors/collect.js';

type Page = { tools: unknown[]; nextCursor?: string; resultType?: unknown; requestState?: string };

function fakeClient(pages: Record<string, Page | Error>) {
  const calls: (string | undefined)[] = [];
  return {
    calls,
    request: (req: { method: string; params?: { cursor?: string } }): Promise<Page> => {
      const cursor = req.params?.cursor;
      calls.push(cursor);
      const page = pages[cursor ?? ''];
      if (page instanceof Error) return Promise.reject(page);
      if (!page) return Promise.reject(new Error(`unexpected cursor ${String(cursor)}`));
      return Promise.resolve(page);
    }
  };
}

describe('listAll', () => {
  it.each(['input_required', 'partial', '', null, true, 7, ['complete'], { resultType: 'complete' }])(
    'retains a non-complete page without following its cursor: %j', async resultType => {
      const client = fakeClient({
        '': { tools: [{ name: 'first' }], nextCursor: 'p2' },
        p2: { tools: [{ name: 'retained' }], resultType, nextCursor: 'p3', requestState: 'SYNTHETIC_PRIVATE_STATE' },
        p3: { tools: [{ name: 'not-collected' }] }
      });
      const result = await listAll(client as never, 'tools/list', 'tools');
      expect(result).toMatchObject({ status: 'incomplete', pages: 2, received: 2,
        items: [{ name: 'first' }, { name: 'retained' }] });
      expect(client.calls).toEqual([undefined, 'p2']);
      expect(result.detail).toContain('completion');
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_STATE');
    }
  );

  it('accepts explicit complete results and ignores nested discriminator text', async () => {
    const values = [{ name: 'literal', inputSchema: { type: 'object', properties: {
      payload: { const: { resultType: 'input_required' } } } } }];
    const client = fakeClient({ '': { tools: values, resultType: 'complete' } });
    expect(await listAll(client as never, 'tools/list', 'tools')).toMatchObject({
      status: 'complete', pages: 1, received: 1, items: values
    });
  });

  it('does not echo arbitrary discriminator values or mislabel missing items as a successful list', async () => {
    const secret = 'SYNTHETIC_SECRET_DISCRIMINATOR';
    const result = await listAll({ request: () => Promise.resolve({ tools: [], resultType: secret }) } as never, 'tools/list', 'tools');
    expect(result.status).toBe('incomplete');
    expect(JSON.stringify(result)).not.toContain(secret);
    const missing = await listAll({ request: () => Promise.resolve({ resultType: 'input_required', requestState: secret }) } as never, 'tools/list', 'tools');
    expect(missing.status).toBe('incomplete');
    expect(missing.detail).toContain('input_required');
  });
  it('follows nextCursor through every page', async () => {
    const client = fakeClient({ '': { tools: [{ name: 'a' }], nextCursor: 'p2' }, p2: { tools: [{ name: 'b' }], nextCursor: 'p3' }, p3: { tools: [{ name: 'c' }] } });
    const items = await listAll(client as never, 'tools/list', 'tools');
    expect(items).toEqual({ items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], status: 'complete', pages: 3, received: 3 });
    expect(client.calls).toEqual([undefined, 'p2', 'p3']);
  });

  it('stops when a server repeats a cursor', async () => {
    const client = fakeClient({ '': { tools: [{ name: 'a' }], nextCursor: 'loop' }, loop: { tools: [{ name: 'b' }], nextCursor: 'loop' } });
    expect(await listAll(client as never, 'tools/list', 'tools')).toMatchObject({ items: [{ name: 'a' }, { name: 'b' }], status: 'incomplete', pages: 2 });
  });

  it('distinguishes method-not-found from a failed request, and keeps earlier pages', async () => {
    const unsupported = Object.assign(new Error('Method not found'), { code: -32601 });
    expect(await listAll(fakeClient({ '': unsupported }) as never, 'prompts/list', 'tools', true)).toMatchObject({ status: 'unsupported', items: [] });
    expect(await listAll(fakeClient({ '': unsupported }) as never, 'tools/list', 'tools')).toMatchObject({ status: 'incomplete' });
    expect(await listAll(fakeClient({ '': new Error('Method not found') }) as never, 'prompts/list', 'tools', true)).toMatchObject({ status: 'incomplete' });
    const flaky = fakeClient({ '': { tools: [{ name: 'a' }], nextCursor: 'p2' }, p2: new Error('boom') });
    expect(await listAll(flaky as never, 'tools/list', 'tools')).toMatchObject({ items: [{ name: 'a' }], status: 'incomplete', pages: 1, detail: expect.stringContaining('page 2 failed') as unknown });
  });
});


describe('list limits and malformed envelopes', () => {
  it('treats an empty string cursor as a real cursor and reports its loop', async () => {
    const client = fakeClient({ '': { tools: [], nextCursor: '' } });
    expect(await listAll(client as never, 'tools/list', 'tools')).toMatchObject({ status: 'incomplete', pages: 2 });
    expect(client.calls).toEqual([undefined, '']);
  });
  it('retains a page with an invalid cursor, and reports a missing array', async () => {
    const badCursor = { request: () => Promise.resolve({ tools: [{ name: 'kept' }], nextCursor: 42 }) };
    expect(await listAll(badCursor as never, 'tools/list', 'tools')).toMatchObject({ status: 'incomplete', items: [{ name: 'kept' }] });
    const missing = { request: () => Promise.resolve({ prompts: [] }) };
    expect(await listAll(missing as never, 'tools/list', 'tools')).toMatchObject({ status: 'incomplete', items: [] });
  });
  it('reports the page limit without looping forever', async () => {
    let n = 0;
    const client = { request: () => Promise.resolve({ tools: [], nextCursor: String(++n) }) };
    expect(await listAll(client as never, 'tools/list', 'tools')).toMatchObject({ status: 'incomplete', pages: MAX_PAGES, detail: expect.stringContaining('page limit') as unknown });
    expect(n).toBe(MAX_PAGES);
  });
  it('bounds large pages without overflowing a spread call', async () => {
    const client = { request: () => Promise.resolve({ tools: Array.from({ length: MAX_ITEMS + 1 }, (_, i) => i) }) };
    const result = await listAll(client as never, 'tools/list', 'tools');
    expect(result.items).toHaveLength(MAX_ITEMS);
    expect(result).toMatchObject({ status: 'incomplete', received: MAX_ITEMS + 1 });
  });
});


it('bounds total pagination time in addition to individual requests', async () => {
  const time = vi.spyOn(performance, 'now');
  time.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(60_001);
  try {
    let calls = 0;
    const client = { request: () => { calls++; return Promise.resolve({ tools: [], nextCursor: String(calls) }); } };
    const result = await listAll(client as never, 'tools/list', 'tools');
    expect(result.status).toBe('incomplete');
    expect(result.detail).toContain('deadline');
    expect(calls).toBe(1);
  } finally { time.mockRestore(); }
});
