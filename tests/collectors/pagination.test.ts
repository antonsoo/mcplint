import { describe, expect, it } from 'vitest';
import { listAll } from '../../src/collectors/collect.js';

type Page = { tools: unknown[]; nextCursor?: string };

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
  it('follows nextCursor through every page', async () => {
    const client = fakeClient({ '': { tools: [{ name: 'a' }], nextCursor: 'p2' }, p2: { tools: [{ name: 'b' }], nextCursor: 'p3' }, p3: { tools: [{ name: 'c' }] } });
    const items = await listAll(client as never, 'tools/list', 'tools');
    expect(items).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    expect(client.calls).toEqual([undefined, 'p2', 'p3']);
  });

  it('stops when a server repeats a cursor', async () => {
    const client = fakeClient({ '': { tools: [{ name: 'a' }], nextCursor: 'loop' }, loop: { tools: [{ name: 'b' }], nextCursor: 'loop' } });
    expect(await listAll(client as never, 'tools/list', 'tools')).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('returns undefined when the method is unsupported, and keeps earlier pages if a later one fails', async () => {
    expect(await listAll(fakeClient({ '': new Error('Method not found') }) as never, 'prompts/list', 'tools')).toBeUndefined();
    const flaky = fakeClient({ '': { tools: [{ name: 'a' }], nextCursor: 'p2' }, p2: new Error('boom') });
    expect(await listAll(flaky as never, 'tools/list', 'tools')).toEqual([{ name: 'a' }]);
  });
});
